import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Credentials stay in the local server. Windows DPAPI binds encryption to the
// current Windows user; other platforms use an owner-only directory and file.
function dpapi(value, decrypt = false) {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $outputBytes=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Local credential protection timed out.')); }, 15000);
    child.stdout.setEncoding('utf8').on('data', part => { output += part; });
    // Never forward PowerShell errors, which might include sensitive input.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Could not open Windows credential protection.')); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(output.trim()) : reject(new Error('Windows could not protect or unlock the ChatGPT connection. Use the same Windows account that saved it.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}

export async function createCredentialVault(directory) {
  const folder = path.join(directory, 'chatgpt');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(folder, 0o700);
  const file = path.join(folder, process.platform === 'win32' ? 'connections.dpapi' : 'connections.json');
  return {
    async read() {
      let value;
      try { value = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (process.platform === 'win32') value = Buffer.from(await dpapi(value, true), 'base64').toString('utf8');
      return JSON.parse(value);
    },
    async write(value) {
      let contents = JSON.stringify(value);
      if (process.platform === 'win32') contents = await dpapi(Buffer.from(contents).toString('base64'));
      const temporary = `${file}.tmp`;
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, file);
      if (process.platform !== 'win32') await chmod(file, 0o600);
    },
  };
}
