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

// Alternatively, you can write to jsonStream directly:
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
// The property name should be provided without the dot, the package handles prefixing internally.
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

## API

`new JsonStream([start: string])`

Creates a new instance of the JSON stream parser.
- start (optional): A substring that indicates where to begin parsing. If provided, the parser will trim the initial data to start with this token.

Properties
- json: Returns the part of the JSON that has been parsed so far (a string).

Methods
- value<T = any>(name?: string): Promise<T>
  
  Returns a promise that resolves with the JSON value located at the given property path.


-	stream(name: string): Readable
  Creates and returns a Node.js Readable stream that streams out the JSON string value for a specific property as it is parsed.

### Error Handling

Any syntax errors or stream errors during parsing will be emitted via the stream’s 'error' event. Always attach an error listener to handle possible errors gracefully:

```typescript
jsonStream.on('error', (err) => {
    console.error('Error encountered:', err);
});
```

## Contributing

Contributions and improvements are welcome! Please open an issue or submit a pull request if you encounter any bugs or have suggestions for new features.

## License

MIT