const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const helperStart = html.indexOf('function stripCodeStringsAndComments');
const helperEnd = html.indexOf('function renderInputPromptGuidance', helperStart);
assert.notEqual(helperStart, -1, 'input detector should exist in the page');
assert.notEqual(helperEnd, -1, 'input detector helpers should have a stable boundary');

const context = { extractPromptTexts: () => [] };
vm.runInNewContext(`${html.slice(helperStart, helperEnd)}
globalThis.detectInputCount=inputCount;
globalThis.detectEstimatedInputCount=estimatedInputCount;
globalThis.detectArrayInputPrompts=buildInputPromptSteps;
globalThis.formatCollectedInputValues=formatCollectedInputValues;`, context);

const outputStart = html.indexOf('function cleanOutput');
const outputEnd = html.indexOf('function runJS', outputStart);
assert.notEqual(outputStart, -1, 'compiler output formatter should exist');
assert.notEqual(outputEnd, -1, 'compiler output formatter should have a stable boundary');
const outputContext = { extractPromptTexts: () => ['Enter 5 integers:'] };
vm.runInNewContext(`${html.slice(outputStart, outputEnd)}\nglobalThis.cleanCompilerOutput=cleanOutput;`, outputContext);

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
  assert.equal(context.detectInputCount('go', 'reader.ReadString(\'\n\')'), 1);
  assert.equal(context.detectInputCount('go', 'reader.ReadBytes(\'\n\')'), 1);
  assert.equal(context.detectInputCount('php', 'fscanf(STDIN, "%d", $number);'), 1);
  assert.equal(context.detectInputCount('php', 'file_get_contents("php://stdin")'), 1);
  assert.equal(context.detectInputCount('perl', 'my $line = readline STDIN;'), 1);
});

test('prompts one indexed array element at a time for all supported input-loop syntaxes', () => {
  const examples = {
    python: 'n = int(input())\narr = []\nfor i in range(n):\n    arr.append(int(input()))',
    javascript: 'const n = Number(prompt()); const arr = []; for (let i = 0; i < n; i++) { arr[i] = Number(prompt()); }',
    typescript: 'const n: number = Number(prompt()); const arr: number[] = []; for (let i = 0; i < n; i++) { arr[i] = Number(prompt()); }',
    c: 'int n, arr[100]; scanf("%d", &n); for (int i = 0; i < n; i++) { scanf("%d", &arr[i]); }',
    cpp: 'int n, arr[100]; cin >> n; for (int i = 0; i < n; i++) { cin >> arr[i]; }',
    java: 'int n = scanner.nextInt(); int[] arr = new int[n]; for (int i = 0; i < n; i++) { arr[i] = scanner.nextInt(); }',
    go: 'var n int; fmt.Scan(&n); arr := make([]int, n); for i := 0; i < n; i++ { fmt.Scan(&arr[i]) }',
    kotlin: 'val n = readLine()!!.toInt(); val arr = IntArray(n); for (i in 0 until n) { arr[i] = readLine()!!.toInt() }',
    swift: 'let n = Int(readLine()!)!; var arr = [Int](repeating: 0, count: n); for i in 0..<n { arr[i] = Int(readLine()!)! }',
    ruby: 'n = gets.to_i\narr = []\nn.times do |i|\n  arr[i] = gets.to_i\nend',
    php: '$n = intval(trim(fgets(STDIN))); $arr = array(); for ($i = 0; $i < $n; $i++) { $arr[$i] = intval(trim(fgets(STDIN))); }',
    perl: 'my $n = <STDIN>; my @arr; for (my $i = 0; $i < $n; $i++) { $arr[$i] = <STDIN>; }',
    bash: 'read -r n\narr=()\nfor ((i=0; i<n; i++)); do\n  read -r arr[i]\ndone'
  };

  for (const [language, code] of Object.entries(examples)) {
    const initial = context.detectArrayInputPrompts(language, code, []);
    assert.equal(initial.length, 2, `${language} should initially ask for size and one array read`);
    assert.match(initial[0], /array size/i, `${language} should label the size prompt`);

    const prompts = context.detectArrayInputPrompts(language, code, ['3']);
    assert.equal(prompts.length, 4, `${language} should ask for three elements individually`);
    assert.deepEqual(Array.from(prompts.slice(1)), ['Enter arr[0]', 'Enter arr[1]', 'Enter arr[2]']);

    assert.deepEqual(
      Array.from(context.formatCollectedInputValues(language, code, ['3', '7', '11', '13'])),
      ['3', '7', '11', '13'],
      `${language} token-based array input should be sent in order`
    );
  }
});

test('collects split-based array values one at a time and repacks them onto the line the program reads', () => {
  const code = 'n = int(input())\narr = list(map(int, input().split()))\nprint(sum(arr))';
  const prompts = context.detectArrayInputPrompts('python', code, ['3']);

  assert.deepEqual(Array.from(prompts), [
    'Enter array size (n)',
    'Enter array element 1 (index 0)',
    'Enter array element 2 (index 1)',
    'Enter array element 3 (index 2)'
  ]);
  assert.deepEqual(
    Array.from(context.formatCollectedInputValues('python', code, ['3', '7', '11', '13'])),
    ['3', '7 11 13']
  );
});

test('prompts TypeScript token-stream arrays by index and repacks the answers for stdin', () => {
  const code = [
    'declare const require: (name: string) => any;',
    'const fs = require("fs");',
    'const data: number[] = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);',
    'const n = data[0] || 0;',
    'const values: number[] = data.slice(1, n + 1);',
    'console.log("Values:", values.join(" "));'
  ].join('\n');

  assert.deepEqual(
    Array.from(context.detectArrayInputPrompts('typescript', code, [])),
    ['Enter array size (n)']
  );
  assert.deepEqual(
    Array.from(context.detectArrayInputPrompts('typescript', code, ['3'])),
    ['Enter array size (n)', 'Enter values[0]', 'Enter values[1]', 'Enter values[2]']
  );
  assert.deepEqual(
    Array.from(context.formatCollectedInputValues('typescript', code, ['3', '7', '11', '13'])),
    ['3 7 11 13']
  );
});

test('prompts fixed-size arrays without requesting a size the program does not read', () => {
  const code = 'int arr[3]; for (int i = 0; i < 3; i++) { cin >> arr[i]; }';
  assert.deepEqual(
    Array.from(context.detectArrayInputPrompts('cpp', code, [])),
    ['Enter arr[0]', 'Enter arr[1]', 'Enter arr[2]']
  );

  
  const pythonCode = 'values = [0] * 3\nfor i in range(3):\n    values[i] = int(input())\nprint(sum(values))';
  assert.deepEqual(
    Array.from(context.detectArrayInputPrompts('python', pythonCode, [])),
    ['Enter values[0]', 'Enter values[1]', 'Enter values[2]']
  );
  assert.deepEqual(
    Array.from(context.formatCollectedInputValues('python', pythonCode, ['7', '11', '13'])),
    ['7', '11', '13']
  );
});

test('asks for each element in the five-integer C sample before its display loop', () => {
  const code = [
    '#include <stdio.h>',
    'int main() {',
    '    int values[5];',
    '    printf("Enter 5 integers: ");',
    '    for (int i = 0; i < 5; ++i) {',
    '        scanf("%d", &values[i]);',
    '    }',
    '    printf("Displaying integers:\n");',
    '    for (int i = 0; i < 5; ++i) {',
    '        printf("%d\n", values[i]);',
    '    }',
    '    return 0;',
    '}'
  ].join('\n');
  assert.deepEqual(
    Array.from(context.detectArrayInputPrompts('c', code, [])),
    ['Enter values[0]', 'Enter values[1]', 'Enter values[2]', 'Enter values[3]', 'Enter values[4]']
  );
});

test('keeps prompts printed by the actual compiled program in console output', () => {
  const raw = 'Enter 5 integers: \r\nDisplaying integers:\r\n10\r\n20\r\n30\r\n40\r\n50\r\n';
  assert.equal(
    outputContext.cleanCompilerOutput(raw, 'printf("Enter 5 integers: ");'),
    'Enter 5 integers: \nDisplaying integers:\n10\n20\n30\n40\n50\n'
  );
});

