# TraceLab — Render Deployment

## Service type
Deploy this repository as a **Render Web Service**, not a Static Site. The Node server serves `public/index.html` and provides `/api/health`, `/api/runtimes`, `/api/diagnostics`, and `/api/execute`.

## Render settings

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Root directory: leave blank

The included `render.yaml` can also be used with Render Blueprints. No Wandbox API key is required; the backend calls Wandbox's public API. `WANDBOX_API_URL` is optional and defaults to `https://wandbox.org/api`.

## AI tutor setup

The AI Agent tab calls Google Gemini from the server, so the API key is never sent to the browser. In the Render service's **Environment** settings, set `GEMINI_API_KEY` to your Gemini API key. `GOOGLE_API_KEY`, `GEMINI_KEY`, and `GOOGLE_GEMINI_API_KEY` are accepted aliases. `GEMINI_API_URL` (also accepts `GEMINI_URL`, `GEMINI_BASE_URL`, or `GOOGLE_GEMINI_URL`) and `GEMINI_MODEL` are optional; the defaults are Google's `generateContent` API and `gemini-3.8-flash`. A full HTTPS `generateContent` URL or a base URL ending in `/v1beta/models` is supported. `/api/assistant/status` reports whether the server has a key and a custom URL configured without returning either value.

Google currently lists a free tier for selected Gemini models, subject to model availability and rate limits. Verify the project's tier and quota in Google AI Studio before using the tutor; usage with a paid-tier key can incur charges. See [Google's Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Feedback

The Feedback tab sends short feedback to the backend, which writes it to the Render service logs for the developer to review. Do not include passwords, API keys, or personal information. Feedback is not stored in a database.

## Verify

After deployment, open `https://YOUR-SERVICE.onrender.com/api/health`. The response should have `ok: true` and identify Wandbox as the provider. Check `/api/assistant/status` to confirm the tutor is configured. Then open TraceLab, choose a language, enter code that reads from standard input, and follow the prompts shown in **I/O**. The page collects all answers first, then sends them to Wandbox as stdin in one execution request.

You can also run `bash smoke_test.sh https://YOUR-SERVICE.onrender.com` from a shell with `curl` available. The C++ response should contain output `21` and `ok: true`.

## Input behavior

Wandbox executes programs in batch mode: it cannot pause to ask a browser user for input while the program is running. TraceLab detects common input calls, collects their answers one at a time in the page, and sends the completed lines to Wandbox before execution. When code reads multiple values in one call (for example, `scanf("%d %d", ...)`), enter those values separated by spaces in the answer field.

## Free-tier behavior

Render Free services may sleep while inactive, so the first request after inactivity can take longer. Wandbox is a public service; availability, compiler catalog, and throttling are controlled by Wandbox.
