# Lingua — personal language workspace

A local-first app for learning multiple languages. Dutch and Turkish are included as empty starting workspaces; add any other language from the home screen.

## Run on Windows

Install Node.js 24 or later. In PowerShell:

```powershell
cd C:\Users\shmallick\Github\languages
npm.cmd install
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:3000**. Keep the terminal running; press **Ctrl+C** to stop. Dependencies and the first build are already installed in this checkout, so **`npm.cmd start` is enough to run it now**. If a server is already running, use its browser tab instead of starting a second copy.

For development with automatic reload:

```powershell
npm.cmd run dev
```

After source changes, run `npm.cmd run build` before using `npm.cmd start` again. To change the port, copy `.env.example` to `.env` and set `PORT=3001` (or another free port).

## Use an iPad from anywhere with Tailscale

The Windows computer runs the app, keeps all saved data, and connects to Anki and the tutor. The iPad uses Safari over a private **Tailscale Serve HTTPS connection**. Both devices need internet access, and the computer must remain on, awake, and running the app. This is not an offline iPad app.

### One-time setup

1. Install [Tailscale on Windows](https://tailscale.com/download/windows) and the Tailscale app on your iPad. Sign in to both with the same personal account and connect both devices. An untagged, personally owned iPad is required so Serve can identify your account.
2. On the computer, run the app with `npm.cmd start`. Keep using **http://127.0.0.1:3000** on that computer. If needed, connect ChatGPT there before moving to the iPad; its sign-in flow cannot complete from the iPad.
3. In a **second PowerShell window**, run:

   ```powershell
   tailscale serve --bg http://127.0.0.1:3000
   ```

   Follow any Tailscale prompt to enable HTTPS certificates. The command prints a private address such as `https://your-computer.your-tailnet.ts.net`. Use **Serve**, not **Funnel**: Funnel is for public internet access. You do not need router port forwarding or an inbound firewall rule for the app's port.
4. If you do not already have a `.env` file, copy the example:

   ```powershell
   Copy-Item .env.example .env
   ```

   **Do not overwrite an existing `.env`.** Edit it and add both values, replacing these examples with the actual Serve address and your exact Tailscale login name (shown in the Tailscale admin console):

   ```dotenv
   TAILSCALE_ORIGIN=https://your-computer.your-tailnet.ts.net
   TAILSCALE_LOGIN=your-tailscale-login@example.com
   ```

   The address must be HTTPS on your `.ts.net` hostname, with no path. Use the login name, not your display name or Windows username. Only that Tailscale account is permitted to access the app remotely.
5. Stop the app with **Ctrl+C**, then restart it with `npm.cmd start` so it reads `.env`. On the iPad, leave Tailscale connected and open the exact HTTPS address in Safari. Optionally use Safari's **Add to Home Screen** action as a shortcut; this does not add offline support.

If `PORT` is not `3000`, use your configured port in both the local browser address and the Serve command. The HTTPS address still normally uses port 443. Do not change the app's bind address to `0.0.0.0`; it intentionally stays on `127.0.0.1` and trusts Serve only over loopback.

### Daily use and integrations

- Keep the app running on the computer and Tailscale connected on both devices. Configure Windows sleep settings for the time you need remote access; the app does not change power settings for you.
- Anki review requires **Anki desktop with AnkiConnect open on the computer**. Do not change AnkiConnect to the iPad's address or expose its port. Ollama also runs on the computer with its existing local address.
- ChatGPT tutoring uses the computer's saved connection. Connecting, reconnecting, adding accounts, and granting plan permission must be done in Settings on the computer at its localhost address. On the iPad those sign-in actions are disabled with an explanation; reopen Settings after signing in on the computer. Model selection and tutor conversations still work remotely.
- All authorized devices share the same database, settings, and Anki review session. This is still a personal app, not separate accounts or isolated workspaces for different people. The configured Tailscale login has full app access, including settings and deletions.
- Keep the tailnet private and avoid sharing this computer with other accounts. Tailscale access-control rules also apply. The app additionally checks the exact Serve hostname and the `Tailscale-User-Login` identity header that Serve supplies. Public Funnel requests and other Tailscale accounts do not satisfy that check. Local programs on the computer remain trusted.
- Tailscale HTTPS setup publishes the certificate hostname in public certificate-transparency logs; choose a computer name that does not reveal sensitive information. This does not make the app itself public.

### Check or disable access

```powershell
tailscale serve status
```

Confirm it says the address is available **within your tailnet**, with `/` proxying to `http://127.0.0.1:3000`. To stop serving this HTTPS endpoint:

```powershell
tailscale serve --https=443 off
```

To disable remote access in the app too, remove **both** `TAILSCALE_ORIGIN` and `TAILSCALE_LOGIN` from `.env` and restart the app. Local access continues to work. Serve's `--bg` configuration persists, but the app itself still needs starting after a computer restart.

If Safari cannot connect, check that the computer is awake, the app is running, both Tailscale clients are connected, and the Serve target matches `PORT`. For an **Access requires localhost or the configured Tailscale Serve connection and account** error, check the exact HTTPS hostname, the configured login, that the iPad is signed into that account and not tagged, and that you restarted the app after editing `.env`. Do not use the computer's LAN or `100.x` address in Safari.

Reference: [Tailscale Serve setup and identity headers](https://tailscale.com/kb/1312/serve).

## Connect your tutor

Open **Settings** in the app. Choose one provider:

- **ChatGPT (default):** click **Continue with ChatGPT**, sign in with your Plus/Pro account, and authorize Lingua to use your ChatGPT plan. After returning to Settings, choose an available model or leave **Account default**, then save. No AI API key is needed. Availability is determined by OpenAI for the selected account/workspace; a successful tutor reply is the final live verification.
- **Ollama:** install and start Ollama, run `ollama pull llama3.2` (or another model), select Ollama in Settings, and enter the installed model name. The default address is `http://127.0.0.1:11434`. Tutor requests stay on your computer.

**Billing:** the API-key option has been removed, including its server-side request path. Old API-key settings migrate to ChatGPT and are never used. Lingua does not buy credits or fall back to another billing method. ChatGPT itself controls whether a connected app can use an existing credit balance as well as the subscription. Open **Manage usage** ([ChatGPT usage settings](https://chatgpt.com/settings/usage)) and review Lingua’s app/credit permissions if you want subscription-only use. The integration does not expose a request parameter to enforce a zero-credit allowance from Lingua.

When ChatGPT returns a usage-limit error, Lingua pauses further plan requests. After reviewing the limit in ChatGPT, use **I’ve checked my limits — allow retry** in Lingua Settings. Unfinished or failed streamed responses are not saved as successful tutor messages. There are no automatic inference retries.

**Connection storage:** ChatGPT credentials stay in the local server, in `data/chatgpt/connections.dpapi` encrypted for your Windows user. On non-Windows systems, they are stored in an owner-only directory/file instead. They are not sent to frontend JavaScript or stored in the conversation database. The app validates OAuth state, PKCE, the signed identity token, and granted plan permission; refresh tokens rotate automatically. Sign-out attempts remote revocation, clears tokens locally, and retains the registration so reconnecting does not create an unnecessary new client. Settings support multiple separate account/workspace connections. Run only one Lingua server per data directory.

The optional **AnkiConnect** key is unrelated to AI billing. It remains stored without encryption in `data/lingua.sqlite`. Alternatively set `ANKI_CONNECT_KEY`, `OLLAMA_URL`, and `OLLAMA_MODEL` in `.env`. Saved settings take precedence over environment defaults. `OPENAI_API_KEY` and `OPENAI_MODEL` are no longer used. Do not share `.env` or your data directory.

If Lingua was already running before this update, stop it with **Ctrl+C** and restart with `npm.cmd start`, then refresh the browser. Use `http://127.0.0.1:3000`; authorization returns to the same loopback host and port at `/auth/callback`. Keep the server running while signing in. Your password and consent are handled on OpenAI’s page, not by Lingua.

## Link and review Anki decks

1. Install the Anki desktop app if needed.
2. In Anki, open **Tools → Add-ons → Get Add-ons**, enter **2055492159** for [AnkiConnect](https://ankiweb.net/shared/info/2055492159), and restart Anki.
3. Keep Anki open with your desired profile selected. If you configured an AnkiConnect API key, enter the same key in Lingua Settings.
4. Select a language in Lingua, open **Vocabulary → Link Anki deck**, and choose one or more decks.
5. Select **Review**, recall the card, reveal the answer, and rate it. Ratings immediately update the real Anki collection.

The server calls AnkiConnect at `http://127.0.0.1:8765`, so you do not need to relax AnkiConnect’s browser CORS settings. The app uses Anki’s actual reviewer and scheduler, including daily limits and learning queues. It detects when the current card changes in Anki and asks you to restart the review instead of rating a stale card. Only one Anki review can be active across the app’s tabs at a time.

Unlinking a deck only removes the local association; it does not delete cards. Import shared decks or `.apkg` files through Anki first. Standard HTML, cloze text, common images, and audio files are supported. Custom card JavaScript, custom styling, SVG, and MathJax are not executed; use Anki itself for templates that require them.

## Build your grammar library

1. Select a language and open **Grammar**.
2. Upload a PDF (maximum 30 MB / 600 pages).
3. Open the reference. Embedded PDF bookmarks become the chapter/section outline, including nested headings.
4. If there are no bookmarks, the app creates explicitly labeled groups of five pages. Use **Edit outline** to name chapters/sections, set page ranges, and choose nesting depth. Page numbers refer to the PDF’s physical pages, not the printed page labels.
5. Select a section, inspect **Reference text**, or open the original PDF. Ask for a summary, explanation, or representative exercises. The tutor receives only that section’s extracted text with page numbers.
6. Mark sections complete as you progress. Their conversations are saved independently.

Scanned PDFs without a text layer require OCR before upload. Password-protected PDFs must be unlocked. Automatic heading inference and OCR are not part of this first version. Changing a section’s page range resets its discussion so old and new source contexts do not get mixed. Deleting a reference removes its section conversations too.

## General practice

Open **Practice → New conversation**. Start from a suggested prompt or type your own. Enter sends; Shift+Enter inserts a line break. The tutor adapts to your responses and requests; there is no preset proficiency level. Conversations are saved per language and can be reopened from the history list.

The full transcript stays local. Each request includes up to 24,000 characters of recent messages and, for grammar, up to 32,000 characters from the selected section. The interface discloses truncation. Smaller sections give better coverage of long chapters. Tutor replies are returned as complete messages, not streamed, in this version.

## Test it

Run the automated suite and production build:

```powershell
npm.cmd test
npm.cmd run build
```

Tests use disposable databases, locally signed test tokens, and mocked Anki/LLM services. They do **not** use your ChatGPT account, consume plan allowance/credits, or alter your Anki collection. They cover PDF extraction, local persistence, language separation, section context, Anki scheduling safeguards, OAuth state/cookies/PKCE, signed identity validation, permission checks, refresh rotation, account switching, revocation, encrypted Windows credential storage, fragmented response streams, usage-limit pausing, and the absence of API-key fallback.

Manual smoke test:

1. Open Dutch, then Turkish. Verify their linked decks, references, and conversations are separate.
2. Add another language. Refresh the browser and verify it is retained.
3. Upload a small text-based PDF. Check its outline, select a section, and compare extracted text with the original pages. Edit a page range and confirm it is respected.
4. In Settings, choose **Continue with ChatGPT** and complete authorization. Confirm the model list loads, review **Manage usage**, save settings, and send a short practice message. Then request a grammar summary, ask a follow-up, request exercises, and submit an answer for feedback. Reopen the section to check its history.
5. Start a general conversation. Refresh and reopen it from the list.
6. Use a disposable or test Anki deck for the first review. Reveal and rate one card, then verify Anki’s schedule/history updated. Close Anki and verify the app explains the disconnected state.
7. Stop and restart the app; confirm references, progress, and conversations remain.

Browser visual verification depends on your local browser. Live Anki and LLM verification requires your running Anki installation and configured provider.

## Data and project structure

```text
src/                    React interface
server/app.js           Local API, validation, workflow coordination
server/store.js         SQLite schema and persistence
server/pdf.js           PDF extraction and section context
server/integrations.js  AnkiConnect and tutor provider routing
server/chatgpt.js       ChatGPT OAuth, account sessions, and streamed plan requests
server/credential-vault.js  Protected local ChatGPT credential storage
tests/                  Automated integration tests
data/lingua.sqlite      Your languages, settings, progress, and conversations
data/uploads/           Original reference PDFs
data/chatgpt/           Protected ChatGPT connections and installation identity
```

Back up the whole `data` directory **with the app stopped**. It may include credentials; Windows-encrypted connections need the same Windows user to unlock, so sign in again when moving to another computer. Dependencies, local data, builds, and `.env` are ignored by Git. The server binds to `127.0.0.1` and rejects cross-origin API access, with a state-validated OAuth callback for top-level browser navigation. Optional remote access is restricted to a configured Tailscale Serve HTTPS hostname and login (see the iPad setup above); arbitrary forwarded headers are not trusted. This is a personal web app, not a public multi-user service; do not expose its port to the internet.

The UI, storage, and provider adapters are separated so features such as audio practice, structured exercise tracking, and additional providers can be added later.

Integration references: [Sign in with ChatGPT](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [Ollama chat](https://docs.ollama.com/api/chat), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/api.js.html), [AnkiConnect](https://ankiweb.net/shared/info/2055492159).
