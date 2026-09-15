# Json-stream [![NPM Package](https://img.shields.io/npm/v/@sapientpro/json-stream.svg)](https://www.npmjs.org/package/@sapientpro/json-stream) 

[@sapientpro/json-stream](https://www.npmjs.com/package/@sapientpro/json-stream) is a streaming JSON parser for Node.js. It extends the Node.js Writable stream, enabling you to incrementally process JSON data as it is being written into the stream. In addition, it allows you to extract individual parsed JSON values using promises and stream specific JSON string values with Readable streams.

> **Warning:** This package uses advanced asynchronous stream processing. Ensure your use-case requires streaming incremental JSON parsing before integrating.

## Installation

```bash
npm install @sapientpro/json-stream
```
or
```bash
yarn add @sapientpro/json-stream
```

## Features
- Incremental JSON parsing while data is written to the stream.
- Extract individual JSON value paths via promises.
- Optionally stream parts of JSON string values as they’re parsed.

## Basic Usage

Below is an example of using JsonStream to parse a large JSON object incrementally.

### Example 1: Parsing a JSON File Incrementally

```typescript
import * as fs from 'fs';
import { JsonStream } from '@sapientpro/json-stream';

// Suppose our JSON file contains a large JSON object:
const jsonFile = 'path/to/large.json';

// Create a read stream from a JSON file
const fileStream = fs.createReadStream(jsonFile, { encoding: 'utf-8' });

// Create an instance of JsonStream. Optionally, pass a "start" token if you need to start parsing from a particular substring.
const jsonStream = new JsonStream();

// Listen to the parsed complete JSON value event
jsonStream.on('value', (value) => {
    console.log('Parsed JSON value:', value);
});

// Use the value method to wait for the parsed complete JSON value event
jsonStream.value().then((json) => {
  console.log('Json:', json);
});

// Listen to error events
jsonStream.on('error', (err) => {
    console.error('Parsing error:', err);
});

// Pipe the file stream into our JSON stream parser
fileStream.pipe(jsonStream);
```

Instead of piping you can write to the stream yourself - but do one or the
other, not both, or the document arrives twice:

```typescript
fileStream.on('data', (chunk: string) => {
    jsonStream.write(chunk, 'utf-8', () => {
        // chunk processed
    });
});
```

### Example 2: Extracting a Specific JSON Value

You can extract a particular value by its property path. The value method returns a promise that resolves when the corresponding JSON value has been parsed.

Assume your incoming JSON is:
```json
{
  "user": {
    "name": "Alice",
    "email": "alice@example.com"
  },
  "status": "active"
}
```

You can extract the user object as follows:

```typescript
import * as fs from 'fs';
import { JsonStream } from '@sapientpro/json-stream';

const jsonStream = new JsonStream();

// Use the value method to wait for the "user" property to be parsed.
jsonStream.value('user').then((user) => {
    console.log('User:', user);
});

// Write JSON data (for example, from a file or network stream)
fs.createReadStream('path/to/users.json', { encoding: 'utf-8' })
  .pipe(jsonStream);
```

### Example 3: Streaming a JSON String Value

If you need to process a large JSON string in chunks as it is being parsed, you can get a dedicated Readable stream for that value via the stream method.

For example, if your JSON structure is:
```json
{
  "log": "a very long log string..."
}
```

You can stream the "log" value like this:

```typescript
import * as fs from 'fs';
import { JsonStream } from '@sapientpro/json-stream';

const jsonStream = new JsonStream();

// Get a Readable stream for the "log" property.
// A string path is split on dots, so 'a.b' addresses the "b" key inside "a";
// pass an array when a key contains a dot itself.
const logStream = jsonStream.stream('log');

// Listen to data events on the logStream
logStream.on('data', (chunk) => {
    console.log('Log chunk:', chunk);
});

logStream.on('end', () => {
    console.log('End of log stream');
});

fs.createReadStream('path/to/log.json', { encoding: 'utf-8' })
  .pipe(jsonStream);
```

### Example 4: Observing Nested Values Using observe

Beyond promise and stream-based extraction, you can observe individual updates for specific JSON paths using the observe method. This is particularly useful when you need to react to updates of nested parts of a large JSON document incrementally.

Assume the JSON input is:
```json
{
  "order": {
    "id": 123,
    "items": [
      { "name": "Widget", "qty": 4 },
      { "name": "Gadget", "qty": 2 }
    ]
  }
}
```

You can observe whenever an item is parsed from the order.items array:
```typescript
import { JsonStream, Any } from '@sapientpro/json-stream';

const jsonStream = new JsonStream();

// Use the wildcard symbol `Any` to observe each item in the items array.
jsonStream.observe(['order', 'items', Any]).subscribe({
  next: (data) => {
    console.log(`Parsed item at path ${JSON.stringify(data.path)}:`, data.value);
  },
  error: (err) => console.error('Observation error:', err)
});

jsonStream.end(JSON.stringify({
  order: {
    id: 123,
    items: [
      { name: "Widget", qty: 4 },
      { name: "Gadget", qty: 2 }
    ]
  }
}), 'utf-8');
```

### Example 5: Observing with Rest Pattern (Rest)

The Rest symbol observes every value *below* a path, at any depth. It does not emit the node the path points at - only its descendants. Given the following JSON:

```json
{
  "data": {
    "metrics": [10, 20, 30],
    "status": "ok"
  }
}
```

The following code observes each element of the data.metrics array. Note that the complete array is not emitted - for that, observe `['data', 'metrics']` as well:

```typescript
import { JsonStream, Rest } from '@sapientpro/json-stream';

const jsonStream = new JsonStream();

// Observe all values in the "data.metrics" and also the final complete array.
jsonStream.observe(['data', 'metrics', Rest]).subscribe({
  next: (data) => {
    console.log(`Observed at path ${JSON.stringify(data.path)}:`, data.value);
  }
});

jsonStream.end(JSON.stringify({
  data: {
    metrics: [10, 20, 30],
    status: "ok"
  }
}), 'utf-8');
```

### Example 6: Parsing with a Start Marker

If your JSON content is embedded within a larger text file, you can specify a marker token so that parsing only begins after the token is found. Consider a file where a JSON block follows a markdown code fence:

````markdown
Some introductory text...
```json
{"message": "Hello, world!"}
```
````

You can configure the `JsonStream` to start parsing after the marker:

```typescript
import { JsonStream } from '@sapientpro/json-stream';

const marker = '```json';
const jsonStream = new JsonStream(marker);

jsonStream.value().then((json) => {
  console.log('Parsed JSON after marker:', json);
});

jsonStream.end(`
Some introductory text...
\`\`\`json
{"message": "Hello, world!"}
\`\`\`
Some trailing text...`, 'utf-8');
```

## API

`new JsonStream([start: string], [collectJson: boolean])`

Creates a new instance of the JSON stream parser.
- `start` (optional): A substring that marks where to begin parsing. Everything before it is discarded. If the stream ends without containing it, the parser emits a `SyntaxError`.
- `collectJson` (optional): Keep a copy of everything written, readable through `json`. Off by default, because it retains the whole document in memory.

Properties
- `json: string` - the raw text written to the stream, or `''` unless `collectJson` was set.

Types
- `Path = string | (string | number | typeof Any)[] | [...(string | number | typeof Any)[], typeof Rest]`
- `PathSegment = string | number`
- `Emitted<T> = { path: PathSegment[], value: T }`

Methods
- `value<T = any>(path?: Path): Promise<T>`

  Returns a promise that resolves with the JSON value located at the given path, and rejects with the `SyntaxError` if parsing fails. Call it before the value is parsed - a path that has already gone by never resolves.


- `stream(path: Path): Readable`

  Creates and returns a Node.js Readable stream carrying the JSON string value at that path as it is parsed. Throws if a stream for the same path already exists.


- `observe<T = any>(path?: Path): Observable<Emitted<T>>`

  Returns an RxJS Observable that emits every value parsed at the given path. Array indices arrive in `path` as numbers, not strings.

### Error Handling

A syntax error destroys the stream: the `'error'` event fires, every observable created with `observe` receives that error, and every promise from `value` rejects with it. Always attach an error listener, or Node will treat it as an uncaught exception:

```typescript
jsonStream.on('error', (err) => {
    console.error('Error encountered:', err);
});
```

## Contributing

Contributions and improvements are welcome! Please open an issue or submit a pull request if you encounter any bugs or have suggestions for new features.

## License

MIT

### Limits

- Nesting deeper than 1000 levels is rejected with a `SyntaxError`. Every level costs an async frame, so an unbounded document would exhaust the heap.
- The parser is deliberately lenient about trailing commas, missing commas and leading zeros. Do not rely on it to validate a document.
- Anything written after the root value is discarded, unless `collectJson` is set.
