const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../server');

const originalFetch = global.fetch;
let server;
let baseUrl;
let compileRequest;
let requestId = 0;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

global.fetch = async (url, options = {}) => {
  const address = String(url);
  if (address.endsWith('/list.json')) {
    return jsonResponse([
      { name: 'tsc-head', language: 'TypeScript' },
      { name: 'gcc-head-c', language: 'C' },
      { name: 'gcc-head', language: 'C++' },
      { name: 'openjdk-head', language: 'Java' },
      { name: 'go-head', language: 'Go' },
      { name: 'swift-head', language: 'Swift' },
      { name: 'ruby-head', language: 'Ruby' },
      { name: 'php-head', language: 'PHP' },
      { name: 'perl-head', language: 'Perl' },
      { name: 'wandbox-bash', language: 'Bash script' },
      { name: 'wandbox-sqlite3', language: 'SQL' }
    ]);
  }
  if (address.endsWith('/compile.json')) {
    compileRequest = JSON.parse(options.body);
    if (compileRequest.code.includes('swift-runner-unavailable')) {
      return jsonResponse({ status: '1', compiler_error: 'ERROR (catatonit:2): failed to exec pid1: No such file or directory' });
    }
    if (compileRequest.code.includes('syntaxerror')) {
      return jsonResponse({ status: '1', compiler_error: 'syntax error near token' });
    }
    return jsonResponse({ status: '0', program_output: compileRequest.stdin ? `input=${compileRequest.stdin}` : 'PASS' });
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
  requestId += 1;
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'X-Forwarded-For': `198.51.100.${requestId}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, data: await response.json() };
}

test('serves the IDE without AI controls or AI health metadata', async () => {
  const page = await fetch(baseUrl + '/');
  assert.equal(page.status, 200);
  const pageText = await page.text();
  assert.doesNotMatch(pageText, /AI Agent|AI coding tutor|Gemini|assistantPanel/i);
  assert.match(pageText, /Feedback/);
  assert.match(pageText, /Main code explanation/);
  const health = await request('/api/health', undefined, 'GET');
  assert.equal(health.data.provider, 'Wandbox public API');
  assert.equal(Object.hasOwn(health.data, 'assistantConfigured'), false);
});

test('serves search metadata, structured app details, and crawler files', async () => {
  const page = await fetch(baseUrl + '/');
  assert.equal(page.status, 200);
  const markup = await page.text();
  assert.match(markup, /<title>TraceLab Compiler: Free Online Code Compiler<\/title>/);
  assert.match(markup, /name="description" content="Free online compiler and code visualizer/);
  assert.match(markup, /application\/ld\+json/);
  const robots = await fetch(baseUrl + '/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/tracelab-web\.pages\.dev\/sitemap\.xml/);
  const sitemap = await fetch(baseUrl + '/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /https:\/\/tracelab-web\.pages\.dev\//);
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

test('advertises the available hosted runtimes and excludes unavailable Kotlin', async () => {
  const result = await request('/api/runtimes', undefined, 'GET');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data.map(runtime => runtime.id).sort(), [
    'bash', 'c', 'cpp', 'go', 'java', 'perl', 'php', 'ruby', 'sql', 'swift', 'typescript'
  ]);
});

test('forwards multiline input unchanged for every hosted runtime', async () => {
  const languages = ['typescript', 'c', 'cpp', 'java', 'go', 'swift', 'ruby', 'php', 'perl', 'bash', 'sql'];
  for (const language of languages) {
    const stdin = '42\nhello world\n';
    const result = await request('/api/execute', { language, code: 'test program', stdin });
    assert.equal(result.response.status, 200, `${language} should execute`);
    assert.equal(result.data.ok, true, `${language} should succeed`);
    assert.equal(compileRequest.compiler, {
      typescript: 'tsc-head', c: 'gcc-head-c', cpp: 'gcc-head', java: 'openjdk-head',
      go: 'go-head', swift: 'swift-head', ruby: 'ruby-head', php: 'php-head',
      perl: 'perl-head', bash: 'wandbox-bash', sql: 'wandbox-sqlite3'
    }[language]);
    assert.equal(compileRequest.stdin, stdin, `${language} must preserve line breaks and spaces`);
    assert.equal(result.data.output, 'input=42\nhello world');
  }
});

test('reports Wandbox container startup failures as a provider outage', async () => {
  const result = await request('/api/execute', { language: 'swift', code: 'swift-runner-unavailable', stdin: 'TraceLab' });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.errorCode, 'provider_runner_unavailable');
  assert.equal(result.data.retryable, true);
  assert.match(result.data.output, /Swift is temporarily unavailable on Wandbox/);
  assert.match(result.data.output, /code and input were not executed/);
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
  requestId += 1;
  const malformed = await fetch(baseUrl + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${requestId}` }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /JSON/i);
  const missing = await request('/api/not-a-route', undefined, 'GET');
  assert.equal(missing.response.status, 404);
  const removedAssistantGet = await request('/api/assistant/status', undefined, 'GET');
  assert.equal(removedAssistantGet.response.status, 404);
  const removedAssistantPost = await request('/api/assistant', { prompt: 'hello' });
  assert.equal(removedAssistantPost.response.status, 404);
});
