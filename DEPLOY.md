# TraceLab — Free Render Deployment

## Important
Deploy this repository as a **Render Web Service**, NOT a Static Site. The Node server serves the frontend and provides `/api/health`, `/api/runtimes`, `/api/diagnostics`, and `/api/execute`.

## 1. GitHub
Upload the contents of this folder to a GitHub repository. Do not upload the ZIP as the only file.

## 2. Render
Create **New → Web Service**, connect the GitHub repository, and use:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Plan: Free
- Health check path: `/api/health`
- Root directory: leave blank

The included `render.yaml` can also be used with Render Blueprints.

## 3. Environment variable
Add this in Render → Environment:

`ONECOMPILER_API_KEY` = your OneCompiler API key

Never put this key in `public/index.html`.

OneCompiler's current Code Execution API uses `POST https://api.onecompiler.org/v1/run`, the `X-API-Key` header, and a payload containing `language`, `stdin`, and `files`. The backend in this project follows that format.

## 4. Verify
After deployment, open:

`https://YOUR-SERVICE.onrender.com/api/health`

Expected when configured:

```json
{"ok":true,"service":"TraceLab free execution backend","executorConfigured":true}
```

Then open TraceLab and click **Test backend**. It runs one tiny C++ test and expects `21`.

You can also run:

`bash smoke_test.sh https://YOUR-SERVICE.onrender.com`

## 5. If you see HTTP 405
That almost always means the frontend was deployed as a Static Site or another static host. Move the repository to a Render **Web Service** so `POST /api/execute` is handled by Node.

## 6. If you see 'Backend online · add API key'
The Node server is running. Add `ONECOMPILER_API_KEY` in Render Environment and redeploy/restart.

## 7. Free-tier limitation
Render Free services can sleep when inactive, so the first request after inactivity can be slow. OneCompiler's API currently gives new accounts 100 free credits to start; execution is not an unlimited free production service.
