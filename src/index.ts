import {Readable, Writable} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {firstValueFrom, Observable, Subject} from "rxjs";
import {Suspendable} from "./suspendable";

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

type Callback = (error?: Error | null) => void;

type Path = string | (string | number | typeof Any)[] | [...(string | number | typeof Any)[], typeof Rest];

export class JsonStream extends Writable {
  readonly #observers: ObserverDesc = {children: {}};

  constructor(start: string = '', collectJson: boolean = false) {
    let buffer: string = ''
    let pos: number = 0;
    let parsed = 0;
    let lastChunk = 0;
    const suspendable = new Suspendable();
    const decoder = new StringDecoder('utf-8');

    const next = async (shift = 0, callback?: () => void,) => {
      if (!this.writable && pos + shift >= buffer.length + this.writableLength - lastChunk) return true;

      while (pos + shift >= buffer.length) {
        callback?.();

        await suspendable.suspend();
      }

      //Cleanup buffer if it's too big
      if (!collectJson && pos > 512) {
        parsed += pos;
        buffer = buffer.substring(pos);
        pos = 0;
      }

      return pos + shift < buffer.length;
    }

    const waitStart = async () => {
      const length = start?.length ?? 0;
      if (!length) return;
      while (await next(length)) {
        const startPos = buffer.indexOf(start, pos);
        if (startPos >= 0) {
          pos = startPos + start.length;
          await skipSpaces();
          buffer = buffer.substring(pos);
          pos = 0;
          parsed = 0;
          break
        }
        pos = buffer.length - length + 1;
      }
    }

    const skipSpaces = async () => {
      while (await next()) {
        if (buffer.at(pos)?.trim() === '') {
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
              throw new SyntaxError('Json syntax error at ' + (pos + parsed));
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
            throw new SyntaxError('Json syntax error at ' + (pos + parsed));
          }
          value = true;
          pos += 4;
          break;
        case "f":
          await next(4);
          if (buffer.substring(pos, pos + 5) !== 'false') {
            throw new SyntaxError('Json syntax error at ' + (pos + parsed));
          }
          value = false;
          pos += 5;
          break;
        case "n":
          await next(3);
          if (buffer.substring(pos, pos + 4) !== 'null') {
            throw new SyntaxError('Json syntax error at ' + (pos + parsed));
          }
          value = null;
          pos += 4;
          break;
        default:
          let number = '';
          if (buffer.at(pos) === '-') {
            ++pos;
            number = '-';
            await next();
          }
          number += await parseDidgits();
          let char = buffer.at(pos)!;
          if(char === '.') {
            ++pos;
            number += char + await parseDidgits();
            char = buffer.at(pos)!;
          }
          if(['e','E'].includes(char)) {
            pos++
            number += char;
            await next();
            char = buffer.at(pos)!;
            if (['+','-'].includes(char)) {
              ++pos;
              number += char;
            }
            number += await parseDidgits();
          }
          value = Number(number);
      }

      pushValue(this.#observers, path, value);

      return value;
    }

    const parseDidgits = async () => {
      let digits = '';
      while (await next()) {
        let c = buffer.at(pos)!;
        if(c >= '0' && c <= '9') {
          digits += c;
          ++pos;
          continue;
        }
        break;
      }

      if(digits.length === 0) {
        throw new SyntaxError('Json syntax error at ' + (pos + parsed));
      }

      return digits;
    }


    const parseString = async (path?: Array<string | number>) => {
      let value = '';
      let chunk = '';
      ++pos;
      const stream = path && this.#resolveDesc(path, false)?.stream;
      loop: while (await next(0, () => {
        if (chunk) {
          value += chunk;
          stream?.push(chunk);
          chunk = '';
        }
      })) {
        switch (buffer.at(pos)) {
          case void 0:
            throw new SyntaxError('Json syntax error at ' + (pos + parsed));
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

    const pushValue = (observers: ObserverDesc, path: Array<string | number>, value: any, depth: number = 0) => {
      if (depth === path.length) {
        observers.observer?.next({path, value});
        return;
      }
      const key = path[depth]!;
      if (observers.children[key]) {
        pushValue(observers.children[key], path, value, depth + 1);
      }
      if (observers.children[Any]) {
        pushValue(observers.children[Any], path, value, depth + 1);
      }
      if (observers.children[Rest]) {
        pushValue(observers.children[Rest], path, value, path.length);
      }
    }

    const cleanup = (observer: ObserverDesc) => {
      observer.stream?.push(null);
      observer.observer?.complete();
      for (const child of Object.values(observer.children)) {
        cleanup(child);
      }
    }

    //Arrow functions: `this` is bound lexically to the JsonStream instance.
    //A method shorthand would need a `this: JsonStream` annotation, which is
    //unsound - Node types these callbacks as `this: Writable`.
    super({
      defaultEncoding: 'utf-8',
      construct: (callback: Callback) => {
        waitStart()
          .then(() => parse())
          .then(async (value) => {
            this.emit('value', value)
            while (!this.closed) {
              await suspendable.suspend();
            }
          })
          .catch((e) => {
            this.emit('error', e);
          });
        callback();
      },
      write: async (chunk: Buffer | string, encoding: BufferEncoding, callback: Callback) => {
        const chunkStr = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        buffer += chunkStr;
        lastChunk = chunkStr.length;
        await suspendable.resume(true);
        lastChunk = 0;
        callback();
      },
      final: (callback: Callback) => {
        suspendable.resume(false).then(() => callback()).catch(callback);
      },
      destroy: (error: Error | null, callback: Callback) => {
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