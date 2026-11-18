import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
const source=await readFile(new URL('../src/api.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('"./url"',JSON.stringify(new URL('../src/url.ts',import.meta.url).href));
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('same-product retry tasks remain isolated across accounts',()=>{
 const task={pid:'30113481',url:'https://product.dangdang.com/30113481.html',maxPages:37,maxDetails:140};
 api.taskQueueAdd({...task,ownerId:'A'});api.taskQueueAdd({...task,ownerId:'B'});api.taskQueueAdd({...task,ownerId:'A'});
 assert.equal(api.taskQueueList().length,2);
 api.taskQueueTouch(task.pid,false,'A');assert.equal(api.taskQueueList().find(t=>t.ownerId==='A').tries,1);assert.equal(api.taskQueueList().find(t=>t.ownerId==='B').tries,0);
 api.taskQueueRemove(task.pid,'A');assert.deepEqual(api.taskQueueList().map(t=>t.ownerId),['B']);
});
test('full JSON export retains every comment and photo while local archive keeps its documented cap',()=>{
 const product={pid:'12345',name:'图书',source:'import',collected_at:123,analysis:{engine:'lexicon-blend (portable)',total:601},comments_count:601};
 const comments=Array.from({length:601},(_,i)=>({cid:String(i),text:'正文',pics:[{th:'https://img.ddimg.cn/a_p.jpg',big:'https://img.ddimg.cn/a_e.jpg'}]}));
 api.archiveSave(product,comments);assert.equal(api.archiveList()[0].comments.length,440);
 const exported=JSON.parse(api.buildPayloadJson(product,comments));assert.deepEqual(exported.comments,comments);assert.deepEqual(exported.product,product);
});
