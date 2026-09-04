const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const ONECOMPILER_URL = process.env.ONECOMPILER_URL || 'https://api.onecompiler.org/v1/run';
const ONECOMPILER_API_KEY = process.env.ONECOMPILER_API_KEY || '';

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many execution requests. Please wait a minute and try again.' }
}));

const SUPPORTED = {
  typescript: { id: 'typescript', ext: 'ts', name: 'TypeScript' },
  c:          { id: 'c', ext: 'c', name: 'C' },
  cpp:        { id: 'cpp', ext: 'cpp', name: 'C++' },
  java:       { id: 'java', ext: 'java', name: 'Java' },
  go:         { id: 'go', ext: 'go', name: 'Go' },
  kotlin:     { id: 'kotlin', ext: 'kt', name: 'Kotlin' },
  swift:      { id: 'swift', ext: 'swift', name: 'Swift' },
  ruby:       { id: 'ruby', ext: 'rb', name: 'Ruby' },
  php:        { id: 'php', ext: 'php', name: 'PHP' },
  perl:       { id: 'perl', ext: 'pl', name: 'Perl' },
  bash:       { id: 'bash', ext: 'sh', name: 'Bash' },
  sql:        { id: 'sqlite', ext: 'sql', name: 'SQL / SQLite' }
};

function health() {
  return { ok: true, service: 'TraceLab free execution backend', executorConfigured: Boolean(ONECOMPILER_API_KEY) };
}

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/api/health', (_req, res) => {
  res.json({ ...health(), timestamp: new Date().toISOString() });
});
app.get('/api/runtimes', (_req, res) => {
  res.json(Object.entries(SUPPORTED).map(([id, item]) => ({ id, name: item.name })));
});

// Manual provider diagnostic. This intentionally runs only when requested,
// so normal health checks never consume execution credits.
app.post('/api/diagnostics', async (_req, res) => {
  if (!ONECOMPILER_API_KEY) {
    return res.status(503).json({ ok: false, backend: true, provider: false, error: 'ONECOMPILER_API_KEY is not configured in the deployment environment.' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(ONECOMPILER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ONECOMPILER_API_KEY },
      body: JSON.stringify({ language: 'cpp', stdin: '', files: [{ name: 'main.cpp', content: '#include <iostream>\nint main(){std::cout << 21;}' }] }),
      signal: controller.signal
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!response.ok) {
      return res.status(502).json({ ok: false, backend: true, provider: false, httpStatus: response.status, error: data.error || data.message || `Provider HTTP ${response.status}` });
    }
    const output = String(data.stdout || '').trim();
    const failed = Boolean(data.error || data.exception) || data.status === 'failed';
    return res.json({ ok: !failed && output === '21', backend: true, provider: !failed, cpp: { expected: '21', received: output, status: data.status || null, exception: data.exception || null, stderr: data.stderr || null } });
  } catch (error) {
    return res.status(503).json({ ok: false, backend: true, provider: false, error: error?.name === 'AbortError' ? 'Provider diagnostic timed out.' : (error.message || 'Provider connection failed.') });
  } finally {
    clearTimeout(timer);
  }
});

app.post('/api/execute', async (req, res) => {
  const { language, code, stdin = '' } = req.body || {};
  if (!language || typeof code !== 'string') {
    return res.status(400).json({ ok: false, error: 'language and code are required' });
  }
  if (code.length > 18000) {
    return res.status(413).json({ ok: false, error: 'Code is limited to 18,000 characters.' });
  }
  if (typeof stdin !== 'string' || stdin.length > 8000) {
    return res.status(413).json({ ok: false, error: 'Input is limited to 8,000 characters.' });
  }
  if (!SUPPORTED[language]) {
    return res.status(400).json({ ok: false, error: `Unsupported language: ${language}` });
  }
  if (!ONECOMPILER_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'The free execution provider is not configured yet. Add ONECOMPILER_API_KEY in Render environment variables.'
    });
  }

  const runtime = SUPPORTED[language];
  const payload = {
    language: runtime.id,
    stdin,
    files: [{ name: `main.${runtime.ext}`, content: code }]
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(ONECOMPILER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': ONECOMPILER_API_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    if (!response.ok) {
      return res.status(502).json({ ok: false, error: data.error || data.message || `Provider HTTP ${response.status}` });
    }

    const outputParts = [];
    if (data.stdout) outputParts.push(String(data.stdout).trimEnd());
    if (data.stderr) outputParts.push(`✕ ${String(data.stderr).trimEnd()}`);
    if (data.exception) outputParts.push(`✕ ${String(data.exception).trimEnd()}`);
    if (data.error) outputParts.push(`✕ ${String(data.error).trimEnd()}`);

    // OneCompiler may return HTTP 200 even when execution itself failed.
    const providerFailed = data.status === 'failed' || Boolean(data.exception || data.error);
    const failed = providerFailed || Boolean(data.stderr);
    const output = outputParts.join('\n') || '(No output — add an output statement such as cout, printf, println, or Console.WriteLine.)';
    return res.json({
      ok: !failed,
      output,
      runtime: runtime.name,
      executionTime: data.executionTime ?? null,
      memoryUsed: data.memoryUsed ?? null
    });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Execution timed out. Try a shorter program.'
      : error.message || 'Execution provider is unavailable.';
    return res.status(503).json({ ok: false, error: message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TraceLab free backend listening on ${PORT}`);
});
