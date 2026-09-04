# TraceLab Launch Checklist

- [ ] GitHub repository contains `public/index.html`, `server.js`, `package.json`, `render.yaml`
- [ ] Render service type is **Web Service**
- [ ] Build command is `npm install`
- [ ] Start command is `npm start`
- [ ] Health check path is `/api/health`
- [ ] Plan is Free
- [ ] `ONECOMPILER_API_KEY` is configured as a secret environment variable
- [ ] `/api/health` returns `ok: true`
- [ ] TraceLab shows `Backend online · compiler ready`
- [ ] **Test backend** returns C++ output `21`
- [ ] C++ program returns output
- [ ] C compiler returns output
- [ ] JavaScript/Python still run locally
- [ ] HTML/CSS preview still works
- [ ] Pause button is blue
- [ ] No API key appears in browser source

## Quick production smoke test

`bash smoke_test.sh https://YOUR-SERVICE.onrender.com`
