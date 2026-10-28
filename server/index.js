import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { createChatGPT } from './chatgpt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(path.join(root, 'data'));
const chatgpt = await createChatGPT(path.join(root, 'data'));
const access = { tailscaleOrigin: process.env.TAILSCALE_ORIGIN || '', tailscaleLogin: process.env.TAILSCALE_LOGIN || '' };
const app = createApp(store, undefined, chatgpt, access);
const dev = process.argv.includes('--dev');
let vite;
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('Build the interface first with npm run build, or run npm run dev.');
    process.exit(1);
  }
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}
const port = Number(process.env.PORT || 3000);
// Keep this loopback-only: Tailscale Serve is the authenticated HTTPS boundary.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`\n  Mallick Diller is ready at http://127.0.0.1:${port}\n  Your data is saved in ${path.join(root, 'data')}\n`);
  if (access.tailscaleOrigin) console.log(`  Tailscale access configured: ${access.tailscaleOrigin}\n  Start Tailscale Serve separately; see README.md.\n`);
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT in .env to another port.` : error); process.exit(1); });
async function close() { chatgpt.close(); await vite?.close(); server.close(() => { store.db.close(); process.exit(0); }); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
