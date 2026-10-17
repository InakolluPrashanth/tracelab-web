'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const JDOODLE_CLIENT_ID = process.env.JDOODLE_CLIENT_ID || '';
const JDOODLE_CLIENT_SECRET = process.env.JDOODLE_CLIENT_SECRET || '';
const JDoodleConfigured = Boolean(JDOODLE_CLIENT_ID && JDOODLE_CLIENT_SECRET);

const FRONTEND_ORIGINS = new Set(
  (
    process.env.FRONTEND_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    'https://tracelab-web.pages.dev,https://tracelab-free.netlify.app,https://tracelabcompiler.netlify.app'
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

// Keep the versionIndex values aligned with JDoodle's published API language list.
// Source: https://www.jdoodle.com/docs/api/languages
const SUPPORTED = {
  typescript: { id: 'typescript', name: 'TypeScript', language: 'typescript', versionIndex: 1 },
  c:          { id: 'c',          name: 'C',          language: 'c',          versionIndex: 7 },
  cpp:        { id: 'cpp',        name: 'C++',        language: 'cpp',        versionIndex: 7 },
  java:       { id: 'java',       name: 'Java',       language: 'java',       versionIndex: 6 },
  go:         { id: 'go',         name: 'Go',         language: 'go',         versionIndex: 6 },
  kotlin:     { id: 'kotlin',     name: 'Kotlin',     language: 'kotlin',     versionIndex: 5 },
  swift:      { id: 'swift',      name: 'Swift',      language: 'swift',      versionIndex: 6 },
  ruby:       { id: 'ruby',       name: 'Ruby',       language: 'ruby',       versionIndex: 6 },
  php:        { id: 'php',        name: 'PHP',        language: 'php',        versionIndex: 6 },
  perl:       { id: 'perl',       name: 'Perl',       language: 'perl',       versionIndex: 6 },
  bash:       { id: 'bash',       name: 'Bash',       language: 'bash',       versionIndex: 6 },
  sql:        { id: 'sql',        name: 'SQL / SQLite', language: 'sql',      versionIndex: 6 }
};

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS: allow the TraceLab frontend domains only.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && FRONTEND_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '32kb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many API requests. Please wait a minute and try again.' }
}));

function normalizeLanguage(value) {
  if (typeof value !== 'string') return '';
  const language = value.trim().toLowerCase();
  if (SUPPORTED[language]) return language;
  const aliases = { 'c++': 'cpp', 'typescript': 'typescript', 'sql / sqlite': 'sql' };
  return aliases[language] || '';
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { text, data: text ? JSON.parse(text) : {} };
  } catch {
    return { text, data: { message: text || `HTTP ${response.status}` } };
  }
}

function requireJdoodleCredentials(res) {
  if (JDoodleConfigured) return true;
  res.status(503).json({
    ok: false,
    error: 'JDoodle is not configured. Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET to the Render backend environment variables.'
  });
  return false;
}

async function executeOnJdoodle(language, code, stdin = '') {
  if (!JDoodleConfigured) {
    const error = new Error('JDoodle credentials are missing from the Render backend environment variables.');
    error.statusCode = 503;
    throw error;
  }
  const runtime = SUPPORTED[language];
  if (!runtime) {
    const error = new Error(`Unsupported hosted language: ${language}`);
    error.statusCode = 400;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('https://api.jdoodle.com/v1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientId: JDOODLE_CLIENT_ID,
        clientSecret: JDOODLE_CLIENT_SECRET,
        script: code,
        stdin,
        language: runtime.language,
        versionIndex: runtime.versionIndex
      }),
      signal: controller.signal
    });
    const { data, text } = await readJson(response);
    if (!response.ok) {
      const error = new Error(data.error || data.message || text || `JDoodle request failed (HTTP ${response.status}).`);
      error.statusCode = response.status === 429 ? 429 : response.status === 401 ? 401 : 502;
      throw error;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('JDoodle returned an unexpected execution response.');
      error.statusCode = 502;
      throw error;
    }
    return { data, runtime };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('JDoodle took too long to respond. Try a shorter program or run it again.');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'TraceLab code execution backend',
    provider: 'JDoodle Compiler API',
    executorConfigured: JDoodleConfigured,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/runtimes', (_req, res) => {
  res.json(Object.values(SUPPORTED).map(({ id, name }) => ({ id, name })));
});

// JDoodle issues plain-text, short-lived WebSocket tokens. The client secret stays on Render.
app.use('/api/interactive/token', rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many interactive sessions started. Please wait a minute before trying again.' }
}));

app.post('/api/interactive/token', async (_req, res) => {
  if (!requireJdoodleCredentials(res)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://api.jdoodle.com/v1/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
      body: JSON.stringify({ clientId: JDOODLE_CLIENT_ID, clientSecret: JDOODLE_CLIENT_SECRET }),
      signal: controller.signal
    });
    const token = (await response.text()).trim();
    if (!response.ok || !token || token.startsWith('{')) {
      let message = token || `JDoodle token request failed (HTTP ${response.status}).`;
      try { const parsed = JSON.parse(token); message = parsed.error || parsed.message || message; } catch (_) {}
      return res.status(response.status >= 400 ? response.status : 502).json({ ok: false, error: message });
    }
    return res.json({ ok: true, token, expiresInSeconds: 180 });
  } catch (error) {
    return res.status(error.name === 'AbortError' ? 504 : 502).json({
      ok: false,
      error: error.name === 'AbortError'
        ? 'JDoodle token request timed out. Please retry.'
        : 'Could not contact JDoodle to start an interactive session.'
    });
  } finally {
    clearTimeout(timeout);
  }
});

// REST/batch execution endpoint retained for compatibility with existing TraceLab callers.
// Interactive executions from the updated page use /api/interactive/token plus JDoodle's STOMP socket.
app.post('/api/execute', async (req, res) => {
  const language = normalizeLanguage(req.body && req.body.language);
  const code = req.body && req.body.code;
  const stdin = req.body && req.body.stdin !== undefined ? req.body.stdin : '';

  if (!language || typeof code !== 'string') {
    return res.status(400).json({ ok: false, error: 'A supported language and code string are required.' });
  }
  if (code.length > 18000) {
    return res.status(413).json({ ok: false, error: 'Code is limited to 18,000 characters.' });
  }
  if (typeof stdin !== 'string' || stdin.length > 8000) {
    return res.status(413).json({ ok: false, error: 'Input is limited to 8,000 characters.' });
  }

  try {
    const { data, runtime } = await executeOnJdoodle(language, code, stdin);
    const output = String(data.output ?? data.error ?? '(No output — add an output statement to see the result.)').trimEnd();
    const failed = Boolean(data.error) || (data.statusCode !== undefined && Number(data.statusCode) >= 400);
    return res.json({
      ok: !failed,
      output,
      runtime: runtime.name,
      compiler: 'JDoodle',
      executionTime: data.cpuTime ?? null,
      memoryUsed: data.memory ?? null,
      statusCode: data.statusCode ?? null
    });
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      ok: false,
      error: error.message || 'JDoodle execution failed.',
      retryable: ![400, 401, 429].includes(error.statusCode)
    });
  }
});

// This endpoint reports configuration without burning a compiler-run credit.
app.get('/api/diagnostics', (_req, res) => {
  res.json({
    ok: true,
    backend: true,
    providerName: 'JDoodle',
    credentialsConfigured: JDoodleConfigured,
    note: JDoodleConfigured
      ? 'Credentials are present. Run a small test program to verify execution.'
      : 'Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in Render.'
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'API endpoint not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TraceLab backend listening on port ${PORT}`);
  console.log(`JDoodle credentials ${JDoodleConfigured ? 'configured' : 'missing'}; client secret is never sent to the browser.`);
});
