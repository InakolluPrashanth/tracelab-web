# TraceLab Launch Checklist

- [ ] Git repository contains `public/index.html`, `server.js`, `package.json`, and `render.yaml`
- [ ] Render service type is **Web Service**
- [ ] Build command is `npm install`
- [ ] Start command is `npm start`
- [ ] Health check path is `/api/health`
- [ ] `/api/health` identifies Wandbox as the execution provider
- [ ] `/api/diagnostics` can load the current Wandbox compiler catalog
- [ ] A program using stdin shows sequential input prompts and runs after the final answer
- [ ] C++ program returns output
- [ ] C program returns output
- [ ] JavaScript and Python still run locally
- [ ] HTML/CSS preview still works
- [ ] Search and category filters show the expected language cards
- [ ] Editor completion popup can insert a suggestion
- [ ] AI Agent uses Google Gemini, explains code, and reports clear setup errors when no key is configured
- [ ] Feedback form accepts and reports a successful submission
- [ ] No API key is present in browser source

## Quick production smoke test

`bash smoke_test.sh https://YOUR-SERVICE.onrender.com`
