import {Readable, Writable} from 'node:stream';
import {firstValueFrom, Observable, Subject} from "rxjs";

export const Any = Symbol('Any');
export const Rest = Symbol('Rest');

type ObserverDesc = {
  observer?: Subject<any>,
  stream?: Readable,
  children: {
    [key: string]: ObserverDesc,
    [Any]?: ObserverDesc,
    [Rest]?: ObserverDesc
  },
}

type Path = string | (string | number | typeof Any)[] | [...(string | number | typeof Any)[], typeof Rest];

export class JsonStream extends Writable {
  readonly #observers: ObserverDesc = {children: {}};

  constructor(start: string = '', collectJson: boolean = false) {
    let started = false
    if (!start) {
      started = true
    }
    let buffer: string = ''
    let pos: number = 0;
    let continuation = Promise.withResolvers<void>();
    let process = Promise.withResolvers<void>();

    const next = async (shift = 0, callback?: () => void,) => {
      while (pos + shift >= buffer.length) {
        callback?.();
        const {resolve} = continuation;
        continuation = Promise.withResolvers<void>();
        resolve();

        await process.promise;
      }

      //Cleanup buffer if it's too big
      if (!collectJson && pos > 512) {
        buffer = buffer.substring(pos);
        pos = 0;
      }

      return this.writable || pos < buffer.length;
    }

    const skipSpaces = async () => {
      while (await next()) {
        if (buffer.at(pos)!.trim() === '') {
          ++pos;
          continue;
        }
        break;
      }
    }

    const parse = async (path: Array<string | number> = []) => {
      await skipSpaces();
      let value: any;
      switch (buffer.at(pos)) {
        case '{': {
          pos++;
          value = {}
          while (await next()) {
            await skipSpaces();
            if (buffer.at(pos) === '}') {
              ++pos;
              break;
            }

            const name = await parseString();

            await skipSpaces();

            if (buffer.at(pos) !== ':') {
              throw new SyntaxError('Json syntax error at ' + pos);
            }

            ++pos

            value[name] = await parse([...path, name]);
            await skipSpaces();

            if (buffer.at(pos) === ',') {
              ++pos;
            }
          }
          break;
        }
        case '[': {
          ++pos;
          let index = 0;
          value = [];
          while (await next()) {
            await skipSpaces();
            if (buffer.at(pos) === ']') {
              ++pos;
              break;
            }
            value.push(await parse([...path, index]));
            ++index;
            await skipSpaces();
            if (buffer.at(pos) === ',') {
              ++pos;
            }
          }
          break;
        }
        case '"':
          value = await parseString(path);
          break;
        case "t":
          await next(3);
          if (buffer.substring(pos, pos + 4) !== 'true') {
            throw new SyntaxError('Json syntax error at ' + pos);
          }
          value = true;
          pos += 4;
          break;
        case "f":
          await next(4);
          if (buffer.substring(pos, pos + 5) !== 'false') {
            throw new SyntaxError('Json syntax error at ' + pos);
          }
          value = false;
          pos += 5;
          break;
        case "n":
          await next(3);
          if (buffer.substring(pos, pos + 4) !== 'null') {
            throw new SyntaxError('Json syntax error at ' + pos);
          }
          value = null;
          pos += 4;
          break;
        default:
          do {
            const str = buffer.substring(pos);
            const match = str.match(/^(-?\d+(\.\d+)?([eE][+-]?\d+)?)([^.eE])?/);
            if ((this.writable || this.writableLength > 0) && match && match[4] === void 0) {
              await next(str.length + 1);
              continue;
            }

            if (!match) {
              throw new SyntaxError('Json syntax error at ' + pos);
            }

            value = Number(match[1]);
            pos += match[1].length;
          } while (false);
      }

      pushValue(this.#observers, path, value);

      return value;
    }

    const parseString = async (path?: Array<string | number>) => {
      let value = '';
      let chunk = '';
      ++pos;
      const stream = path && this.#resolveDesc(path, false)?.stream;
      loop: while (await next(0, () => {
        value += chunk;
        stream?.push(chunk);
        chunk = '';
      })) {
        switch (buffer.at(pos)) {
          case '"':
            ++pos;
            break loop;
          case '\\':
            ++pos;
            await next();
            switch (buffer.at(pos)) {
              case 't':
                chunk += '\t';
                ++pos;
                break;
              case 'r':
                chunk += '\r';
                ++pos;
                break;
              case 'n':
                chunk += '\n';
                ++pos;
                break;
              case 'b':
                chunk += '\b';
                ++pos;
                break;
              case 'f':
                chunk += '\f';
                ++pos;
                break;
              case 'u':
                await next(4);
                chunk += String.fromCharCode(parseInt(buffer.substring(pos + 1, pos + 5), 16));
                pos += 5;
                break;
              default:
                chunk += buffer.at(pos);
                ++pos;
                break;
            }
            break;
          default:
            chunk += buffer.at(pos)!;
            ++pos;
            break;
        }
      }
      if (chunk) {
        value += chunk;
        stream?.push(chunk);
      }
      stream?.push(null);

      return value;
    }

    const pushValue = (observers: ObserverDesc, path: Array<string | number>, value: any, originalPath: Array<string | number> = [...path]) => {
      if (path.length === 0) {
        observers.observer?.next({
          path: originalPath,
          value
        });
        return;
      }
      const key = path.shift()!;
      if (observers.children[key]) {
        pushValue(observers.children[key], path, value, originalPath);
      }
      if (observers.children[Any]) {
        pushValue(observers.children[Any], path, value, originalPath);
      }
      if (observers.children[Rest]) {
        pushValue(observers.children[Rest], [], value, originalPath);
      }
    }

    const cleanup = (observer: ObserverDesc) => {
      observer.stream?.push(null);
      observer.observer?.complete();
      for (const child of Object.values(observer.children)) {
        cleanup(child);
      }
    }

    super({
      defaultEncoding: 'utf-8',
      construct(this: JsonStream, callback: (error?: (Error | null)) => void) {
        skipSpaces()
          .then(() => {
            buffer = buffer.substring(pos);
            pos = 0;
            return parse();
          })
          .then(async (value) => {
            this.emit('value', value)
            continuation.resolve();
          })
          .catch((e) => {
            this.emit('error', e);
          });
        callback();
      },
      async write(this: JsonStream, chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
        buffer += chunk.toString('utf-8');
        if (!started) {
          //cut buffer to start
          const startPos = buffer.indexOf(start);
          if (startPos >= 0) {
            buffer = buffer.substring(startPos + start.length);
            pos = 0;
            started = true;
          } else {
            buffer = '';
            callback();
            return;
          }
        }

        continuation.promise.then(() => {
          callback()
        });

        const {resolve} = process;
        process = Promise.withResolvers<void>();
        resolve();
      },
      final(this: JsonStream, callback: (error?: (Error | null)) => void) {
        continuation.promise.then(() => {
          callback()
        }, callback)
      },
      destroy(this: JsonStream, error: Error | null, callback: (error?: (Error | null)) => void) {
        cleanup(this.#observers);
        callback(error);
      }
    });
  }

  #resolveDesc(path: Path, create: false): ObserverDesc | null
  #resolveDesc(path: Path, create?: true): ObserverDesc
  #resolveDesc(path: Path, create = true) {
    if (typeof path === 'string') {
      path = path.split('.');
    }

    let observer = this.#observers;
    for (const key of path) {
      if (Object.hasOwn(observer.children, key)) {
        observer = observer.children[key]!;
      } else if (create) {
        observer = observer.children[key] = {children: {}};
      } else {
        return null;
      }
    }
    return observer;
  }

  public observe<T = any>(path: Path = []): Observable<{ path: string[], value: T }> {
    return (this.#resolveDesc(path).observer ??= new Subject<{ path: string[], value: T }>());
  }

  public stream(path: string | string[]) {
    if (this.#resolveDesc(path).stream) {
      throw new Error('Stream already exists');
    }
    return (this.#resolveDesc(path).stream = new Readable({
      encoding: 'utf-8',
      read() {
      }
    }))
  }

  public async value<T = any>(path: string | string[] = []) {
    const {value} = await firstValueFrom(this.observe<T>(path));
    return value;
  }
}