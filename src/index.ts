import {Readable, Writable} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {firstValueFrom, Observable, Subject} from "rxjs";
import {Suspendable} from "./suspendable.js";

export const Any = Symbol('Any');
export const Rest = Symbol('Rest');

//Guards against a document that is nothing but opening brackets: every level
//costs an async frame, so an unbounded one exhausts the heap.
const MAX_DEPTH = 1000;

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

export type PathSegment = string | number;

export type Path =
  string
  | (PathSegment | typeof Any)[]
  | [...(PathSegment | typeof Any)[], typeof Rest];

export type Emitted<T = any> = { path: PathSegment[], value: T };

const newDesc = (): ObserverDesc => ({children: Object.create(null)});

//Object.values misses the Any/Rest symbol keys.
const childrenOf = (desc: ObserverDesc): ObserverDesc[] => {
  const children = Object.values(desc.children);
  if (desc.children[Any]) children.push(desc.children[Any]!);
  if (desc.children[Rest]) children.push(desc.children[Rest]!);
  return children;
}

export class JsonStream extends Writable {
  readonly #observers: ObserverDesc = newDesc();
  #json = '';

  constructor(start: string = '', collectJson: boolean = false) {
    let buffer: string = ''
    let pos: number = 0;
    let parsed = 0;
    let lastChunk = 0;
    let done = false;
    let failed = false;
    const suspendable = new Suspendable();
    const decoder = new StringDecoder('utf-8');
    const path: Array<PathSegment> = [];

    const syntaxError = () => new SyntaxError('Json syntax error at ' + (pos + parsed));

    //True once the writer is finished and everything it wrote has been buffered.
    const eof = (shift = 0) =>
      !this.writable && pos + shift >= buffer.length + this.writableLength - lastChunk;

    //Cheap synchronous check. Every call site tries this before awaiting next(),
    //so the promise machinery only runs when the buffer is actually exhausted.
    const avail = (shift = 0) => pos + shift < buffer.length;

    //Returns false when no more data will ever arrive.
    const next = async (shift = 0) => {
      while (pos + shift >= buffer.length) {
        if (eof(shift)) return false;
        await suspendable.suspend();
      }

      //Cleanup buffer if it's too big
      if (pos > 512) {
        parsed += pos;
        buffer = buffer.substring(pos);
        pos = 0;
      }

      return true;
    }

    //Fails with a syntax error rather than returning false.
    const require = async (shift = 0) => {
      if (avail(shift) || await next(shift)) return;
      throw syntaxError();
    }

    const waitStart = async () => {
      const length = start?.length ?? 0;
      if (!length) return;
      while (true) {
        const startPos = buffer.indexOf(start, pos);
        if (startPos >= 0) {
          pos = startPos + start.length;
          await skipSpaces();
          buffer = buffer.substring(pos);
          pos = 0;
          parsed = 0;
          return;
        }
        //Keep the last length-1 characters: the marker may straddle the seam.
        pos = Math.max(0, buffer.length - length + 1);
        if (!await next(length - 1)) {
          throw new SyntaxError('Start pattern ' + JSON.stringify(start) + ' not found');
        }
      }
    }

    const isSpace = (code: number) => code === 32 || code === 10 || code === 13 || code === 9;

    const skipSpaces = async () => {
      while (true) {
        while (pos < buffer.length) {
          if (!isSpace(buffer.charCodeAt(pos))) return;
          ++pos;
        }
        if (!await next()) return;
      }
    }

    const parse = async (): Promise<any> => {
      if (path.length > MAX_DEPTH) {
        throw new SyntaxError('Json nesting deeper than ' + MAX_DEPTH + ' at ' + (pos + parsed));
      }

      await skipSpaces();
      await require();

      let value: any;
      switch (buffer.at(pos)) {
        case '{': {
          pos++;
          value = {}
          while (true) {
            await skipSpaces();
            await require();
            if (buffer.at(pos) === '}') {
              ++pos;
              break;
            }

            const name = await parseString(false);

            await skipSpaces();
            await require();

            if (buffer.at(pos) !== ':') {
              throw syntaxError();
            }

            ++pos

            path.push(name);
            const child = await parse();
            path.pop();

            //Plain assignment would trip the __proto__ setter instead of
            //creating an own property, which is not what JSON.parse does.
            Object.defineProperty(value, name, {
              value: child,
              enumerable: true,
              writable: true,
              configurable: true,
            });

            await skipSpaces();
            await require();

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
          while (true) {
            await skipSpaces();
            await require();
            if (buffer.at(pos) === ']') {
              ++pos;
              break;
            }
            path.push(index);
            value.push(await parse());
            path.pop();
            ++index;
            await skipSpaces();
            await require();
            if (buffer.at(pos) === ',') {
              ++pos;
            }
          }
          break;
        }
        case '"':
          value = await parseString(true);
          break;
        case "t":
          await require(3);
          if (buffer.substring(pos, pos + 4) !== 'true') {
            throw syntaxError();
          }
          value = true;
          pos += 4;
          break;
        case "f":
          await require(4);
          if (buffer.substring(pos, pos + 5) !== 'false') {
            throw syntaxError();
          }
          value = false;
          pos += 5;
          break;
        case "n":
          await require(3);
          if (buffer.substring(pos, pos + 4) !== 'null') {
            throw syntaxError();
          }
          value = null;
          pos += 4;
          break;
        default: {
          let number = '';
          if (buffer.at(pos) === '-') {
            ++pos;
            number = '-';
            await require();
          }
          number += await parseDidgits();
          if (buffer.at(pos) === '.') {
            ++pos;
            number += '.' + await parseDidgits();
          }
          let char = buffer.at(pos);
          if (char === 'e' || char === 'E') {
            ++pos;
            number += char;
            await require();
            char = buffer.at(pos);
            if (char === '+' || char === '-') {
              ++pos;
              number += char;
            }
            number += await parseDidgits();
          }
          value = Number(number);
        }
      }

      pushValue(this.#observers, value);

      return value;
    }

    const parseDidgits = async () => {
      let digits = '';
      while (true) {
        let end = pos;
        while (end < buffer.length) {
          const code = buffer.charCodeAt(end);
          if (code < 48 || code > 57) break;
          ++end;
        }
        digits += buffer.slice(pos, end);
        pos = end;
        //Stopped on a non-digit, or nothing more is coming.
        if (end < buffer.length || !await next()) break;
      }

      if (digits.length === 0) {
        throw syntaxError();
      }

      return digits;
    }

    const parseString = async (observed: boolean) => {
      await require();
      if (buffer.at(pos) !== '"') {
        throw syntaxError();
      }
      ++pos;

      let value = '';
      let chunk = '';
      const stream = observed ? this.#resolveDesc(path, false)?.stream : undefined;

      const flush = () => {
        if (!chunk) return;
        value += chunk;
        stream?.push(chunk);
        chunk = '';
      }

      loop: while (true) {
        if (pos >= buffer.length) {
          flush();
          if (!await next()) throw syntaxError();
          continue;
        }

        switch (buffer.at(pos)) {
          case '"':
            ++pos;
            break loop;
          case '\\':
            ++pos;
            await require();
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
              case 'u': {
                await require(4);
                const hex = buffer.substring(pos + 1, pos + 5);
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                  throw syntaxError();
                }
                chunk += String.fromCharCode(parseInt(hex, 16));
                pos += 5;
                break;
              }
              default:
                chunk += buffer.at(pos);
                ++pos;
                break;
            }
            break;
          default: {
            //Take the whole run up to the next quote or backslash in one slice:
            //appending character by character builds a rope the GC has to walk.
            let end = pos;
            while (end < buffer.length) {
              const code = buffer.charCodeAt(end);
              if (code === 34 || code === 92) break;
              ++end;
            }
            chunk += buffer.slice(pos, end);
            pos = end;
            break;
          }
        }
      }

      flush();
      stream?.push(null);

      return value;
    }

    const pushValue = (observers: ObserverDesc, value: any, depth: number = 0) => {
      if (depth === path.length) {
        observers.observer?.next({path: path.slice(), value});
        return;
      }
      const key = path[depth]!;
      if (Object.hasOwn(observers.children, key)) {
        pushValue(observers.children[key]!, value, depth + 1);
      }
      if (observers.children[Any]) {
        pushValue(observers.children[Any]!, value, depth + 1);
      }
      if (observers.children[Rest]) {
        pushValue(observers.children[Rest]!, value, path.length);
      }
    }

    const cleanup = (observer: ObserverDesc, error?: Error | null) => {
      if (error) {
        observer.stream?.destroy(error);
        observer.observer?.error(error);
      } else {
        observer.stream?.push(null);
        observer.observer?.complete();
      }
      for (const child of childrenOf(observer)) {
        cleanup(child, error);
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
            done = true;
            buffer = '';
            this.emit('value', value)
            while (!this.closed) {
              await suspendable.suspend();
            }
          })
          //destroy() runs the cleanup below, which carries the real cause to
          //every observer. A bare emit('error') would leave them hanging.
          .catch((e) => {
            failed = true;
            //A writer may be parked on resume(); nothing will ever suspend again.
            suspendable.release();
            this.destroy(e);
          });
        callback();
      },
      write: async (chunk: Buffer | string, encoding: BufferEncoding, callback: Callback) => {
        const chunkStr = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        if (collectJson) {
          //Kept apart from `buffer`, which is indexed on every character and so
          //would be flattened by V8 on every write.
          this.#json += chunkStr;
        }
        //Everything after the root value is discarded; only the collector keeps it.
        if (!done && !failed) {
          buffer += chunkStr;
          lastChunk = chunkStr.length;
          await suspendable.resume(true);
          lastChunk = 0;
        }
        callback();
      },
      final: (callback: Callback) => {
        if (failed) {
          callback();
          return;
        }
        suspendable.resume(false).then(() => callback()).catch(callback);
      },
      destroy: (error: Error | null, callback: Callback) => {
        cleanup(this.#observers, error);
        callback(error);
      }
    });
  }

  /** The raw text written to the stream. Empty unless `collectJson` was set. */
  public get json(): string {
    return this.#json;
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
        observer = observer.children[key] = newDesc();
      } else {
        return null;
      }
    }
    return observer;
  }

  public observe<T = any>(path: Path = []): Observable<Emitted<T>> {
    return (this.#resolveDesc(path).observer ??= new Subject<Emitted<T>>());
  }

  public stream(path: Path): Readable {
    const desc = this.#resolveDesc(path);
    if (desc.stream) {
      throw new Error('Stream already exists for ' + JSON.stringify(path));
    }
    return (desc.stream = new Readable({
      encoding: 'utf-8',
      read() {
      }
    }))
  }

  public async value<T = any>(path: Path = []): Promise<T> {
    const {value} = await firstValueFrom(this.observe<T>(path));
    return value;
  }
}
