const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const helperStart = html.indexOf('function stripCodeStringsAndComments');
const helperEnd = html.indexOf('function buildInputPromptSteps', helperStart);
assert.notEqual(helperStart, -1, 'input detector should exist in the page');
assert.notEqual(helperEnd, -1, 'input detector helpers should have a stable boundary');

const context = {};
vm.runInNewContext(`${html.slice(helperStart, helperEnd)}
globalThis.detectInputCount=inputCount;
globalThis.detectEstimatedInputCount=estimatedInputCount;`, context);

test('detects stdin patterns for every language with interactive input', () => {
  const examples = {
    python: 'name = input("Name: ")',
    javascript: 'const name = prompt("Name:");',
    typescript: 'const data = fs.readFileSync(0, "utf8");',
    c: 'scanf("%d", &number);',
    cpp: 'std::cin >> number;',
    java: 'int number = scanner.nextInt();',
    go: 'fmt.Scan(&number)',
    kotlin: 'val name = readln()',
    swift: 'let name = readLine()',
    ruby: 'name = gets',
    php: '$name = trim(fgets(STDIN));',
    perl: 'my $name = <STDIN>;',
    bash: 'read name'
  };
  for (const [language, code] of Object.entries(examples)) {
    assert.equal(context.detectInputCount(language, code), 1, `${language} input should be detected`);
  }
  assert.equal(context.detectInputCount('sql', 'SELECT 5 + 4;'), 0, 'SQL values belong in the query');
  assert.equal(context.detectInputCount('html', '<input value="prompt()">'), 0, 'HTML preview does not collect stdin');
  assert.equal(context.detectInputCount('css', '.prompt { color: red; }'), 0, 'CSS preview does not collect stdin');
});

test('ignores input-looking text in strings and comments', () => {
  const examples = [
    ['javascript', 'console.log("prompt() readline()"); // question("name")'],
    ['typescript', "const note = `process.stdin.on('data')`; /* question('name') */"],
    ['cpp', 'std::cout << "cin >> value"; // getline(cin, value)'],
    ['python', `example = """input('name')"""\n# input("ignored")`],
    ['java', 'System.out.println("scanner.nextLine()"); /* scanner.nextInt() */'],
    ['go', 'fmt.Println("fmt.Scan(&value)") // scanner.Scan()'],
    ['php', 'echo "fgets(STDIN)"; // readline()\n# file_get_contents("php://stdin")'],
    ['bash', 'echo "read value" # read ignored'],
    ['sql', "SELECT 'readline()'; -- input is not interactive stdin"]
  ];
  for (const [language, code] of examples) {
    assert.equal(context.detectInputCount(language, code), 0, `${language} comments and literals are not input calls`);
  }
});

test('does not ask twice for Java nextInt followed by the newline cleanup call', () => {
  const code = [
    'int choice = scanner.nextInt();',
    'scanner.nextLine();',
    'String value = scanner.nextLine();'
  ].join('\n');
  assert.equal(context.detectEstimatedInputCount('java', code), 2);
});

test('recognizes common stdin APIs that are not input() or prompt()', () => {
  assert.equal(context.detectInputCount('python', 'sys.stdin.readline()'), 1);
  assert.equal(context.detectInputCount('python', 'sys.stdin.buffer.readline()'), 1);
  assert.equal(context.detectInputCount('javascript', 'process.stdin.on("data", handler)'), 1);
  assert.equal(context.detectInputCount('javascript', 'process.stdin.on("data", handleData); process.stdin.on("end", finish);'), 1);
  assert.equal(context.detectInputCount('javascript', 'process.stdin.on("end", finish);'), 0);
  assert.equal(context.detectInputCount('javascript', 'rl.question("Name: ", answer => {})'), 1);
  assert.equal(context.detectInputCount('typescript', 'process.stdin.on("data", handler)'), 1);
  assert.equal(context.detectInputCount('typescript', 'process.stdin.on("data", handleData); process.stdin.on("end", finish);'), 1);
  assert.equal(context.detectInputCount('typescript', 'process.stdin.on("end", finish);'), 0);
  assert.equal(context.detectInputCount('cpp', 'std::cin.get()'), 1);
  assert.equal(context.detectInputCount('java', 'System.in.read()'), 1);
  assert.equal(context.detectInputCount('kotlin', 'readlnOrNull()'), 1);
  assert.equal(context.detectInputCount('go', 'reader.ReadString(\'\\n\')'), 1);
  assert.equal(context.detectInputCount('go', 'reader.ReadBytes(\'\\n\')'), 1);
  assert.equal(context.detectInputCount('php', 'fscanf(STDIN, "%d", $number);'), 1);
  assert.equal(context.detectInputCount('php', 'file_get_contents("php://stdin")'), 1);
  assert.equal(context.detectInputCount('perl', 'my $line = readline STDIN;'), 1);
});
