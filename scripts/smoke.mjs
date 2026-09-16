// Runtime-agnostic check that the built package works on Node, Bun and Deno.
// Defaults to the local dist; pass a package name to check an installed tarball.
const args = globalThis.process?.argv?.slice(2) ?? globalThis.Deno?.args ?? [];
const core = args[0] ?? new URL('../dist/esm/index.js', import.meta.url).href;
const node = args[0] ? args[0] + '/node' : new URL('../dist/esm/node.js', import.meta.url).href;

const {JsonParser, Any} = await import(core);
const {JsonStream} = await import(node);

const failures = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const parsed = (json, size) => {
  const parser = new JsonParser();
  for (let i = 0; i < json.length; i += size) parser.write(json.slice(i, i + size));
  parser.end();
  return parser.root;
};

check('chunked write', parsed('{"a":-1.5e2,"b":[1,2],"c":null}', 1), {a: -150, b: [1, 2], c: null});
check('whole document', parsed('{"s":"\\ud83d\\ude00","t":true}', 1e9), {s: '😀', t: true});

{
  const parser = new JsonParser();
  const seen = (async () => {
    const out = [];
    for await (const {value} of parser.observe(['items', Any])) out.push(value);
    return out;
  })();
  parser.write('{"items":[1,2,3]}');
  parser.end();
  check('observe + for await', await seen, [1, 2, 3]);
}

{
  const parser = new JsonParser();
  const read = (async () => {
    const parts = [];
    for await (const part of parser.stream(['t'])) parts.push(part);
    return parts.join('');
  })();
  parser.write('{"t":"hel');
  parser.write('lo"}');
  parser.end();
  check('stream() fragments', await read, 'hello');
}

{
  const parser = new JsonParser();
  const bytes = new TextEncoder().encode('{"s":"日本語🌍"}');
  const source = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  await source.pipeTo(parser.writable);
  check('pipeTo(writable), byte at a time', parser.root, {s: '日本語🌍'});
}

{
  let thrown = null;
  try {
    const parser = new JsonParser();
    parser.write('{bad}');
  } catch (error) {
    thrown = error.constructor.name;
  }
  check('syntax error', thrown, 'SyntaxError');
}

{
  const stream = new JsonStream();
  const value = new Promise((resolve, reject) => {
    stream.on('value', resolve);
    stream.on('error', reject);
  });
  stream.write('{"hello":');
  stream.end('"world"}');
  check('JsonStream (node entry)', await value, {hello: 'world'});
}

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n' + failures.join('\n'));
  throw new Error('smoke test failed');
}
console.log('\nall smoke checks passed');
