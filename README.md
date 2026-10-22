# Prompt Studio

An AI prompt optimizer built with React, TypeScript, Vite+, and Express. A pretrained model hosted by **Groq** rewrites the user's prompt into detailed, task-specific instructions. It adds relevant deliverables, response structure, and quality criteria while preserving the user's intent and constraints. It edits the prompt; it does not carry out the task inside it. No local model training or GPU is required.

## Enable free AI

1. Create a key in the [Groq Console](https://console.groq.com/keys). Use the **Free** plan; a paid upgrade is not needed for this project. The free plan has [request and token limits](https://console.groq.com/docs/rate-limits).
2. Put the key in **`apps/api/.env`**. A blank local file and `.env.example` are provided:

   ```dotenv
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=openai/gpt-oss-20b
   ```

3. Start the application:

   ```bash
   npm install
   npm run dev
   ```

4. Open **http://localhost:5173**. If the app was already open, choose **Refresh setup** after saving the key. Development watches `.env` and restarts the backend when it changes; production needs a restart.

Keep the key in the backend file. Do not use a `VITE_` variable, put it in frontend code, or add it to browser storage. `.env` is ignored by Git. The browser receives only whether a key is configured and the model name. Configuration presence does not verify that the key is valid; the first rewrite checks provider access.

Use Node.js 22.18+ (22.x), 24.11+ (24.x), or 26+, and npm. Express runs on port 3001; Vite+ proxies `/api` to it.

## How it works

- Type a rough AI prompt, choose a technique, and optionally add audience, length, format, context, or an output example.
- The backend makes one Groq request for the selected technique and returns one real model-generated rewrite. A completed response with empty final content gets **one recovery attempt**, within the same timeout; other failures are not retried.
- The app streams public response text as Groq generates it, with an immediate activity indicator and a writing cursor. There are no artificial typing delays. Reduced-motion preferences disable visual animations. Only completed rewrites are saved to history; navigation cancels an in-progress request.
- Results display Markdown headings, bold text, and lists. Copy and reuse preserve the original prompt text. **Prompt details** shows the requested technique, model, word counts, and a transparent instruction checklist.
- The app never silently substitutes local templates when the AI request fails. Missing keys, rejected credentials, rate limits, timeouts, and malformed responses produce clear errors.

Prompt text and supplied options are sent to Groq for rewriting. The system guidance tells the model to preserve the task and constraints, avoid invented facts or examples, and return only a compact improved prompt. As with other LLMs, output should be reviewed; instruction preservation cannot be guaranteed by rules or mocked tests.

The default `openai/gpt-oss-20b` model is listed in Groq's [supported models](https://console.groq.com/docs/models) and free-plan limits. The app cannot determine your Groq billing plan. Stay on the Free plan if you require no API charges; limits and account availability are controlled by Groq. No account upgrades or automatic paid fallback are implemented.

## Project structure

```text
apps/web/src/
  components/      Reusable chat UI, AI setup notice, prompt details
  hooks/           Request, session, configuration, and theme state
  lib/             API client and browser storage
  styles/          White/charcoal themes, blue accents, readable typography
apps/api/src/
  lib/             Groq client, validation, and text-signal analysis
  __tests__/       API and provider tests with mocked network responses
packages/shared/   Shared request/response and configuration types
scripts/dev.mjs    Starts and stops both development processes
```

Poppins and Space Grotesk are self-hosted. Styling uses neutral card shadows without colored glow effects. Browser-local history retains up to 30 sessions. Older sessions made by the previous local-rule version remain available and are labeled accordingly.

## VPS deployment using an IP and port

`deploy.sh` deploys this app as its own `prompt-studio.service`, under a dedicated `prompt-studio` system user and `/opt/prompt-studio` directory. The default target is `187.77.86.146:3080`. It uses the server's existing Node installation and does not change Nginx, PM2, other services, firewall rules, or other applications.

```bash
./deploy.sh --identity "$HOME/.ssh/hostinger_yene_shop_store" --check
./deploy.sh --identity "$HOME/.ssh/hostinger_yene_shop_store"
```

Use `--host`, `--port`, or `--ssh-port` to change the target, and `--help` for details. SSH access and an already verified host key are required. The script refuses occupied ports or deployment paths owned by another application. It builds locally, uploads a production release, installs dependencies as the dedicated app user using an app-private copy of the pinned npm version, and restarts only this app's service. The server's global npm remains unchanged. Previous releases are retained for rollback.

The Groq configuration is transferred separately from `apps/api/.env` into a private server environment file; it is never included in the release archive or frontend bundle. Production limits both rewrite endpoints to 6 requests per IP per minute, 12 requests globally per minute, and 2 concurrent rewrites. These limits protect a small public demo; Groq's own token and request limits still apply.

## API

- `GET /api/health` — service status, AI mode, and whether a key is configured.
- `GET /api/config` — `{ configured, provider, model }`; never returns the key.
- `POST /api/optimize` — returns the original, one selected rewrite, analysis, and `generation` provider/model metadata.
- `POST /api/optimize/stream` — the same request, with newline-delimited JSON `delta`, `complete`, or `error` events. The browser uses this route for live text. Streaming recovery is allowed only before any public text has been sent.

```json
{
  "prompt": "write an email to my professor asking for a deadline extension",
  "technique": "structured",
  "options": {
    "audience": "",
    "length": "",
    "format": "auto",
    "context": "",
    "example": ""
  }
}
```

Techniques: `structured`, `few-shot`, `role-based`. Few-shot uses only an example you provide; it does not invent one. Formats: `auto`, `bullet-points`, `paragraph`, `numbered-list`. All option fields must be present; empty strings are valid. Input limits: prompt 8,000 characters, audience 120, length 80, context and example 2,000 each. Invalid types, unsupported fields, and malformed JSON are rejected before any provider request.

The instruction checklist checks wording, not model answer quality. Comparing techniques requires submitting the same original prompt with each technique; each submission consumes provider quota. The retained local rule engine is a test baseline and is not used as the runtime AI optimizer.

## Verify and build

```bash
npm test
npm run build
npm start
```

Tests use injected provider configuration and mocked fetch responses; they do not call Groq or consume quota. A live model check requires your valid key. The build type-checks both apps and compiles the frontend. Production serves the app and API together at **http://localhost:3001**. The backend uses `tsx` as a runtime dependency. Set `API_PORT` to change the backend port and update the Vite development proxy accordingly.
