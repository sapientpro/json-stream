// Compile-only package API checks. Run tsc with --noEmit, strict and NodeNext.
import {JsonParser, Json5Parser, Any, Rest, createParser, compileJsonPath, type Parser, type Subscription} from '@sapientpro/json-stream';
import {JsonStream, createNodeWritable} from '@sapientpro/json-stream/node';
const p: Parser = new JsonParser({retainRoot:false});
const sub: Subscription = p.onValue<number>(['items',Any,'id'],(value,path)=>{value.toFixed();path[0]?.toString();});
sub.unsubscribe();
const strings: ReadableStream<string> = p.stringStream(['items',Any,'text']);
const result: Promise<{id:number}> = p.getValue<{id:number}>(['items',0]);
new Json5Parser().onString([Rest],{next(value,path){value.toUpperCase();path.length;},end(path){path.length;}});
createParser({format:'json5'}).onValueJsonPath('$.items[*]',()=>{});
p.onValue(compileJsonPath('$.items[0]'),()=>{});
const node=new JsonStream({format:'json5'});node.getValue<number>(['id']);createNodeWritable(p);
void strings;void result;
// @ts-expect-error array segments cannot be booleans
p.onValue([true],()=>{});
// @ts-expect-error unknown dialect
createParser({format:'jsonl'});
// @ts-expect-error readonly snapshots cannot be mutated
p.onValue([],(_value,path)=>{path.push('x');});

import {JsonLinesParser, PrefixedJsonParser, PrefixFilter} from '@sapientpro/json-stream';
const lines=new JsonLinesParser({format:'json5',retainRoot:false});
lines.onValue<number>(['id'],(value,path,index)=>{value.toFixed();path.length;index.toFixed();});
lines.onString(['text'],{next(fragment,path,index){fragment.toUpperCase();path.length;index.toFixed();},end(path,index){path.length;index.toFixed();}});
lines.getValueJsonPath<number>('$.id');lines.stringStream(['text']);createNodeWritable(lines);
const prefixed=new PrefixedJsonParser('data:');prefixed.onRecord<{id:number}>((value,index)=>{value.id;index.toFixed();});
createNodeWritable(new PrefixFilter(prefixed,'BEGIN'));
// @ts-expect-error prefix seeking lives outside the core
new JsonParser({start:'data:'});

const reusable=new JsonParser();reusable.write('1');reusable.reset();reusable.write('2');reusable.end();

// @ts-expect-error framing offsets are internal, not a public write argument
reusable.write('1',0);
