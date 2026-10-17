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
  // Core` work without requ