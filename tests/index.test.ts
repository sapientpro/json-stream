/// <reference types="jest" />
import {finished} from "node:stream/promises";
import {Any, JsonStream, Rest} from '../src'; // або де знаходиться ваш код

describe('JsonStream', () => {
  test('Should emit value with parsed JSON', (done) => {
    const jsonStream = new JsonStream();
    jsonStream.on('value', (value) => {
      try {
        expect(value).toEqual({hello: 'world'});
        done();
      } catch (err) {
        done(err);
      }
    });
    jsonStream.write('{"hello":"world"}', 'utf-8');
    jsonStream.end();
  });

  test('Should emit error if JSON is invalid', (done) => {
    const jsonStream = new JsonStream();
    jsonStream.on('error', (error) => {
      try {
        expect(error).toBeInstanceOf(Error);
        done();
      } catch (err) {
        done(err);
      }
    });
    jsonStream.write('{hello:"world"}', 'utf-8');
    jsonStream.end();
  })

  test('Should emit value with parsed JSON', (done) => {
    const jsonStream = new JsonStream();
    jsonStream.on('value', (value) => {
      try {
        expect(value).toEqual({hello: 'world'});
        done();
      } catch (err) {
        done(err);
      }
    });
    jsonStream.write('{"hello":"wor', 'utf-8');
    jsonStream.write('ld"}', 'utf-8');
    jsonStream.end();
  });

  test('Should emit value with specified value', (done) => {
    const jsonStream = new JsonStream();
    jsonStream.value('hello').then((value) => {
      expect(value).toEqual('world');
      done();
    });

    jsonStream.end('{"hello":"world"}', 'utf-8');
  });

  //expect stream value to be 'world'
  test('Should stream value with specified value', (done) => {
    const jsonStream = new JsonStream();
    const text = jsonStream.stream('text');
    const string = "some long chunked string";
    let written = 0;
    let read = 0;
    const write = () => {
      if (jsonStream.writable) {
        jsonStream.write(string.substring(written, written += Math.min(string.length - written, Math.ceil(Math.random() * 5))));
        if (written === string.length) {
          jsonStream.end('"}');
        }
      }
    }
    text.on("data", (data) => {
      expect(data).toEqual(string.substring(read, read += data.length));
      write();
    })

    text.on('end', () => {
      expect(read).toEqual(string.length);
    })

    jsonStream.write('{"text":"');
    write();

    jsonStream.on('finish', () => {
      try {
        expect(written).toEqual(string.length);
        expect(read).toEqual(string.length);
        done()
      } catch (e) {
        done(e);
      }
    })
  });

  test('Should parse with marker', (done) => {
    const jsonStream = new JsonStream('```json');
    jsonStream.value().then((value) => {
      expect(value).toEqual({hello: 'world'});
    });
    jsonStream.write('some text before\n ```', 'utf-8');
    jsonStream.end('json\n{"hello":"world"}```\n some text after', 'utf-8');

    jsonStream.on('finish', done);
  });

  describe('observe', () => {
    test('Should observe value with specified key', (done) => {
      const jsonStream = new JsonStream();
      jsonStream.observe(['hello']).subscribe({
        next: (value) => {
          try {
            expect(value).toEqual({path: ['hello'], value: 'world'});
            done();
          } catch (e) {
            done(e);
          }
        }
      });

      jsonStream.end('{"hello":"world"}', 'utf-8');
    });

    test('Should observe root value', (done) => {
      const jsonStream = new JsonStream();
      jsonStream.observe().subscribe({
        next: (value) => {
          try {
            expect(value).toEqual({path: [], value: {hello: 'world'}});
            done();
          } catch (e) {
            done(e);
          }
        }
      });

      jsonStream.end('{"hello":"world"}', 'utf-8');
    });

    test('Should observe Any value', async () => {
      const jsonStream = new JsonStream();
      const values: any = [];
      jsonStream.observe(['a', Any]).subscribe({
        next: (value) => {
          values.push(value)
        }
      });

      jsonStream.end('{"a":[1,2,3]}', 'utf-8');
      await finished(jsonStream);
      expect(values).toEqual([
        {path: ['a', 0], value: 1},
        {path: ['a', 1], value: 2},
        {path: ['a', 2], value: 3}
      ]);
    });

    test('Should observe Any value with nested path', async () => {
      const jsonStream = new JsonStream();
      const values: any = [];
      jsonStream.observe([Any, "a"]).subscribe({
        next: (value) => {
          values.push(value)
        }
      });

      jsonStream.end('[{"a":1},{"a":2},{"a":3}]', 'utf-8');
      await finished(jsonStream);
      expect(values).toEqual([
        {path: [0, 'a'], value: 1},
        {path: [1, 'a'], value: 2},
        {path: [2, 'a'], value: 3},
      ]);
    });

    test('Should observe Rest value', async () => {
      const jsonStream = new JsonStream();
      const values: any = [];
      jsonStream.observe([Rest]).subscribe({
        next: (value) => {
          values.push(value)
        }
      });

      jsonStream.end('{"a":[1,2,3]}', 'utf-8');
      await finished(jsonStream);
      expect(values).toEqual([
        {path: ['a', 0], value: 1},
        {path: ['a', 1], value: 2},
        {path: ['a', 2], value: 3},
        {path: ['a'], value: [1, 2, 3]}
      ]);
    });

  });
});