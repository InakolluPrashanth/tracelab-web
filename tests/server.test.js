const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_MODEL = 'test-model';
process.env.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const { app } = require('../server');

const originalFetch = global.fetch;
let server;
let baseUrl;
let compileRequest;
let aiRequest;
let aiRequestUrl;
let aiHeaders;
let aiStatus = 200;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

global.fetch = async (url, options = {}) => {
  const address = String(url);
  if (address.endsWith('/list.json')) {
    return jsonResponse([
      { name: 'gcc-head-c', language: 'C' },
      { name: 'gcc-head', language: 'C++' },
      { name: 'openjdk-head', language: 'Java' }
    ]);
  }
  if (address.endsWith('/compile.json')) {
    compileRequest = JSON.parse(options.body);
    if (compileRequest.code.includes('syntaxerror')) {
      return jsonResponse({ status: '1', compiler_error: 'syntax error near token' });
    }
    return jsonResponse({ status: '0', program_output: compileRequest.stdin ? `input=${compileRequest.stdin}` : 'PASS' });
  }
  if (address.endsWith(':generateContent')) {
    aiRequest = JSON.parse(options.body);
    aiRequestUrl = address;
    aiHeaders = options.headers;
    if (aiStatus !== 200) return jsonResponse({ error: { message: 'mock provider error' } }, aiStatus);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Here is the explanation.\n```java\nclass Demo {}\n```' }] } }] });
  }
  return originalFetch(url, options);
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise(resolve => server.close(resolve));
});

async function request(path, body, method = 'POST') {
  const response = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, data: await response.json() };
}

test('serves the IDE page and reports provider configuration without exposing a key', async () => {
  const page = await fetch(baseUrl + '/');
  assert.equal(page.status, 200);
  const pageText = await page.text();
  assert.match(pageText, /AI coding tutor/);
  const status = await request('/api/assistant/status', undefined, 'GET');
  assert.equal(status.data.configured, true);
  assert.equal(status.data.model, 'test-model');
  assert.equal(status.data.provider, 'Google Gemini');
  assert.equal(status.data.customEndpointConfigured, true);
  assert.equal(JSON.stringify(status.data).includes('test-gemini-key'), false);
  assert.match(pageText, /Google Gemini/);
  assert.doesNotMatch(pageText, /OpenAI|OPENAI_API_KEY/);
});

test('rejects invalid execution requests clearly', async () => {
  let result = await request('/api/execute', { language: '', code: 'x' });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /language/i);

  result = await request('/api/execute', { language: 'java', code: '' });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /empty/i);

  result = await request('/api/execute', { language: 'java', code: 'x'.repeat(18001) });
  assert.equal(result.response.status, 413);
});

test('runs code with stdin through the Wandbox adapter', async () => {
  const result = await request('/api/execute', { language: 'c++', code: 'int main() {}', stdin: '17' });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.output, 'input=17');
  assert.equal(compileRequest.stdin, '17');
  assert.equal(compileRequest.compiler, 'gcc-head');
});

test('returns compiler diagnostics instead of disguising compile errors as success', async () => {
  const result = await request('/api/execute', { language: 'c', code: 'syntaxerror' });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, false);
  assert.match(result.data.output, /Compilation failed/);
  assert.match(result.data.output, /syntax error/);
});

test('normalizes Java entry class names without rewriting comments or string literals', async () => {
  const code = 'public class Core {\n  public static void main(String[] args) {\n    // Core remains in this comment\n    System.out.println("Core");\n  }\n}';
  const result = await request('/api/execute', { language: 'java', code });
  assert.equal(result.data.ok, true);
  assert.match(compileRequest.code, /class prog/);
  assert.match(compileRequest.code, /\/\/ Core remains in this comment/);
  assert.match(compileRequest.code, /println\("Core"\)/);
});

test('validates assistant requests and sends Gemini chat history without exposing the key', async () => {
  let result = await request('/api/assistant', { language: 'java', code: 'class Main {}', prompt: '' });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /question/i);

  result = await request('/api/assistant', { language: 'java', code: 'class Main {}', prompt: 'Explain this', history: [{ role: 'system', content: 'ignored' }, { role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Previous answer' }] });
  assert.equal(result.response.status, 200);
  assert.match(result.data.reply, /explanation/);
  assert.equal(result.data.model, 'test-model');
  assert.equal(result.data.provider, 'Google Gemini');
  assert.equal(aiRequest.contents[0].role, 'user');
  assert.equal(aiRequest.contents[1].role, 'model');
  assert.equal(aiRequest.contents[1].parts[0].text, 'Previous answer');
  assert.equal(aiRequest.contents.length, 3);
  assert.match(aiRequest.contents[2].parts[0].text, /Current code/);
  assert.match(aiRequest.systemInstruction.parts[0].text, /programming tutor/);
  assert.equal(aiRequest.generationConfig.maxOutputTokens, 1200);
  assert.equal(aiRequest.url, undefined);
  assert.equal(JSON.stringify(aiRequest).includes('test-gemini-key'), false);
  assert.equal(aiHeaders['x-goog-api-key'], 'test-gemini-key');
  assert.equal(aiHeaders.Authorization, undefined);
  assert.match(aiRequestUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/test-model:generateContent/);
  assert.doesNotMatch(aiRequestUrl, /key=/i);
});

test('surfaces assistant provider failures as a bounded service error', async () => {
  aiStatus = 429;
  const result = await request('/api/assistant', { language: 'python', code: 'print(1)', prompt: 'Explain' });
  aiStatus = 200;
  assert.equal(result.response.status, 502);
  assert.match(result.data.error, /quota/i);
});

test('validates and accepts feedback with only the allowed category and rating', async () => {
  let result = await request('/api/feedback', { category: 'spam', message: 'A message' });
  assert.equal(result.response.status, 400);
  result = await request('/api/feedback', { category: 'idea', message: 'Please add a dark theme.', rating: 5 });
  assert.equal(result.response.status, 200);
  assert.match(result.data.message, /Thanks/);
  result = await request('/api/feedback', { category: 'bug', message: 'tiny' });
  assert.equal(result.response.status, 400);
});

test('returns helpful errors for malformed JSON and unknown API routes', async () => {
  const malformed = await fetch(baseUrl + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /JSON/i);
  const missing = await request('/api/not-a-route', undefined, 'GET');
  assert.equal(missing.response.status, 404);
});
