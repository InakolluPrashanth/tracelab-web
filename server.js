const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const WANDBOX_API_URL = (process.env.WANDBOX_API_URL || 'https://wandbox.org/api').replace(/\/+$/, '');
const FRONTEND_ORIGINS = new Set(
  (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || 'https://tracelab-web.pages.dev,https://tracelab-free.netlify.app,https://tracelabcompiler.netlify.app')
    .split(',').map(s => s.trim()).filter(Boolean)
);

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
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
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many execution requests. Please wait a minute and try again.' }
}));

// Languages exposed by the existing TraceLab interface. Wandbox's live compiler
// catalog is checked at runtime; a language not listed there returns HTTP 501.
const SUPPORTED = {
  typescript: { id: 'typescript', name: 'TypeScript' },
  c: { id: 'c', name: 'C' },
  cpp: { id: 'cpp', name: 'C++' },
  java: { id: 'java', name: 'Java' },
  go: { id: 'go', name: 'Go' },
  kotlin: { id: 'kotlin', name: 'Kotlin' },
  swift: { id: 'swift', name: 'Swift' },
  ruby: { id: 'ruby', name: 'Ruby' },
  php: { id: 'php', name: 'PHP' },
  perl: { id: 'perl', name: 'Perl' },
  bash: { id: 'bash', name: 'Bash' },
  sql: { id: 'sql', name: 'SQL / SQLite' }
};

const WANDBOX_LANGUAGES = {
  typescript: 'TypeScript', c: 'C', cpp: 'C++', java: 'Java', go: 'Go',
  kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', php: 'PHP', perl: 'Perl',
  bash: 'Bash', sql: 'SQL'
};
const COMPILER_NAME_PREFERENCES = {
  typescript: [/^wandbox-tsc$/i, /^tsc-head$/i, /^tsc-/i, /typescript/i],
  c: [/^gcc-head-c$/i, /^clang-head-c$/i, /^gcc-.*-c$/i, /^clang-.*-c$/i],
  cpp: [/^gcc-head$/i, /^clang-head$/i, /^g\+\+-head$/i, /^gcc-/i, /^clang-/i, /^g\+\+-/i],
  java: [/^openjdk-head$/i, /^java-head$/i, /^openjdk-/i, /^java-/i],
  kotlin: [/^kotlinc-head$/i, /^kotlin-/i, /kotlin/i],
  go: [/^go-head$/i, /^go-/i],
  swift: [/^swift-head$/i, /^swift-/i],
  ruby: [/^ruby-head$/i, /^ruby-/i],
  php: [/^php-head$/i, /^php-/i],
  perl: [/^perl-head$/i, /^perl-/i],
  bash: [/^wandbox-bash$/i, /^bash$/i, /bash/i],
  sql: [/^wandbox-sqlite3$/i, /^sqlite3-/i, /^sqlite-/i, /sqlite/i]
};

let compilersCache = null;
let compilersCacheAt = 0;
let compilersInFlight = null;
const COMPILERS_CACHE_MS = 5 * 60 * 1000;

function normalizeLanguage(value) {
  let language = '';
  if (typeof value === 'string') language = value.trim().toLowerCase();
  else if (value && typeof value === 'object') {
    const candidate = value.id ?? value.value ?? value.language ?? value.name;
    if (typeof candidate === 'string') language = candidate.trim().toLowerCase();
  }
  const aliases = { 'c++': 'cpp', 'sql / sqlite': 'sql', 'typescript': 'typescript' };
  return aliases[language] || language;
}

async function readJson(response) {
  const text = await response.text();
  try { return { text, data: text ? JSON.parse(text) : {} }; }
  catch { return { text, data: { message: text || `HTTP ${response.status}` } }; }
}

async function getWandboxCompilers() {
  if (Array.isArray(compilersCache) && Date.now() - compilersCacheAt < COMPILERS_CACHE_MS) {
    return compilersCache;
  }
  if (compilersInFlight) return compilersInFlight;
  compilersInFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${WANDBOX_API_URL}/list.json`, {
        headers: { Accept: 'application/json' }, signal: controller.signal
      });
      const { data } = await readJson(response);
      if (!response.ok) throw new Error(data.message || data.error || `Wandbox compiler-list request failed (HTTP ${response.status}).`);
      if (!Array.isArray(data)) throw new Error('Wandbox returned an unexpected compiler-list response.');
      compilersCache = data.filter(x => x && typeof x.name === 'string' && typeof x.language === 'string');
      compilersCacheAt = Date.now();
      return compilersCache;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Timed out while asking Wandbox for its available compilers. Please retry.');
      throw error;
    } finally {
      clearTimeout(timer);
      compilersInFlight = null;
    }
  })();
  return compilersInFlight;
}

function compilerPreferenceScore(language, name) {
  const patterns = COMPILER_NAME_PREFERENCES[language] || [];
  const score = patterns.findIndex(pattern => pattern.test(name));
  return score === -1 ? patterns.length + 10 : score;
}

async function selectWandboxCompiler(language) {
  const wantedLanguage = WANDBOX_LANGUAGES[language];
  if (!wantedLanguage) {
    const error = new Error(`Wandbox is not configured for ${language}.`);
    error.statusCode = 501;
    throw error;
  }
  const compilers = await getWandboxCompilers();
  const wanted = wantedLanguage.toLowerCase();
  const candidates = compilers.filter(item => String(item.language).trim().toLowerCase() === wanted);
  if (!candidates.length) {
    const error = new Error(language === 'kotlin'
      ? 'Wandbox does not currently list a Kotlin compiler. Kotlin needs a separate execution provider.'
      : `Wandbox does not currently list a compiler for ${wantedLanguage}.`);
    error.statusCode = 501;
    throw error;
  }
  candidates.sort((a, b) => {
    const diff = compilerPreferenceScore(language, a.name) - compilerPreferenceScore(language, b.name);
    if (diff) return diff;
    const aHead = /head/i.test(a.name), bHead = /head/i.test(b.name);
    if (aHead !== bHead) return aHead ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return candidates[0];
}

async function executeOnWandbox(language, code, stdin) {
  // Wandbox compiles Java from prog.java and launches the prog class. Rename
  // the class that owns main so ordinary submissions such as `public class
  // Core` work without requiring users to know Wandbox's internal filename.
  if (language === 'java') code = normalizeJavaEntryClass(code);
  const compiler = await selectWandboxCompiler(language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${WANDBOX_API_URL}/compile.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ compiler: compiler.name, code, stdin, save: false }),
      signal: controller.signal
    });
    const { data } = await readJson(response);
    if (!response.ok) {
      const error = new Error(data.message || data.error || data.compiler_error || `Wandbox execution failed (HTTP ${response.status}).`);
      error.statusCode = 502;
      throw error;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('Wandbox returned an unexpected execution response.');
      error.statusCode = 502;
      throw error;
    }
    return { data, compiler };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Wandbox took too long to respond. Please try a shorter program or retry later.');
      timeoutError.statusCode = 503;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeJavaEntryClass(source) {
  const declarations = [...source.matchAll(/\b(?:public\s+)?class\s+([A-Za-z_$][\w$]*)\b/g)];
  for (let i = 0; i < declarations.length; i++) {
    const match = declarations[i];
    const start = match.index;
    const end = declarations[i + 1]?.index ?? source.length;
    const segment = source.slice(start, end);
    if (!/\bstatic\s+void\s+main\s*\(/.test(segment)) continue;
    const oldName = match[1];
    if (oldName === 'prog') return source;
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return source.replace(new RegExp(`\\b${escaped}\\b`, 'g'), 'prog');
  }
  return source;
}

function health() {
  return { ok: true, service: 'TraceLab code execution backend', provider: 'Wandbox public API', executorConfigured: true, note: 'Public API; availability and throttling are controlled by Wandbox.' };
}

app.get('/api/health', (_req, res) => res.json({ ...health(), timestamp: new Date().toISOString() }));
app.get('/api/runtimes', (_req, res) => res.json(Object.entries(SUPPORTED).map(([id, item]) => ({ id, name: item.name }))));

app.get('/api/diagnostics', async (_req, res) => {
  try {
    const compilers = await getWandboxCompilers();
    const availableLanguages = [...new Set(compilers.map(item => item.language))].sort();
    return res.json({
      ok: true, backend: true, provider: true, providerName: 'Wandbox public API',
      credentialsConfigured: true, compilerCount: compilers.length, availableLanguages,
      note: 'Wandbox is configured. Public service availability and request throttling are controlled by Wandbox.'
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      ok: false, backend: true, provider: false, providerName: 'Wandbox public API',
      error: error.message || 'Could not reach Wandbox.'
    });
  }
});

app.post('/api/execute', async (req, res) => {
  const body = req.body || {};
  let { language, code, stdin = '' } = body;
  // Accept common aliases so integrations with `lang` / `source` still run.
  language ??= body.lang ?? body.languageId;
  code ??= body.source ?? body.program;
  language = normalizeLanguage(language);
  if (!language || typeof code !== 'string') return res.status(400).json({ ok: false, error: 'language and code are required' });
  if (code.length > 18000) return res.status(413).json({ ok: false, error: 'Code is limited to 18,000 characters.' });
  if (typeof stdin !== 'string' || stdin.length > 8000) return res.status(413).json({ ok: false, error: 'Input is limited to 8,000 characters.' });
  if (!SUPPORTED[language]) return res.status(400).json({ ok: false, error: `Unsupported language: ${language}` });

  try {
    const { data, compiler } = await executeOnWandbox(language, code, stdin);
    const programOutput = String(data.program_output || '').trimEnd();
    const programError = String(data.program_error || '').trimEnd();
    const compilerOutput = String(data.compiler_output || '').trimEnd();
    const compilerError = String(data.compiler_error || '').trimEnd();
    const compilerMessage = String(data.compiler_message || '').trimEnd();
    const status = data.status == null ? null : String(data.status);
    const signal = data.signal ? String(data.signal) : '';
    const compileMessage = compilerMessage || [compilerOutput, compilerError].filter(Boolean).join('\n');
    const compileFailed = status == null && Boolean(compilerError || compilerMessage) && !programOutput;
    const runtimeFailed = status == null && Boolean(programError) && !programOutput;
    const failed = Boolean(signal) || (status !== null && status !== '0') || compileFailed || runtimeFailed;
    const parts = [];
    if (programOutput) parts.push(programOutput);
    if (programError) parts.push(`stderr:\n${programError}`);
    if (failed && compileMessage) parts.unshift(`Compilation failed:\n${compileMessage}`);
    if (signal) parts.push(`Signal: ${signal}`);
    const output = parts.join('\n') || '(No output — add an output statement such as cout, printf, println, or Console.WriteLine.)';
    return res.json({ ok: !failed, output, runtime: SUPPORTED[language].name, compiler: compiler.name, executionTime: null, memoryUsed: null });
  } catch (error) {
    return res.status(error.statusCode || 503).json({ ok: false, error: error.message || 'Wandbox execution service is temporarily unavailable.', retryable: error.statusCode !== 501 });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TraceLab backend listening on ${PORT}`);
  console.log('Execution provider: Wandbox public API');
});
