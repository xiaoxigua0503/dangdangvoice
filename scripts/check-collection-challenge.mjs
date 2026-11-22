// Focused offline fixtures; upstream scripts are inert strings, never executed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {parseListResponse,classifyHtmlResponse,htmlAccessFailure} from '../server/collection-parser.mjs';
globalThis.fetch=()=>{throw new Error('Network forbidden');};
const row='<div class="comment_items"><div class="describe_detail"><a href="https://comment.dangdang.com/comment/detail/0/12345/67890">书中提到 captcha challenge WAF 和 aliyun_waf，登录问题</a></div></div>';
const list={summary:{total_comment_num:1,pageCount:144},html:row,commentEnabled:true};
for(const data of [list,JSON.stringify(list)]){
 const r=parseListResponse(JSON.stringify({data:{list:data}}));assert.equal(r.outcome,'completed');assert.equal(r.items.length,1);assert.match(r.items[0].text,/captcha challenge WAF/);
}
// JSON data cannot be reclassified as a top-level verification document.
assert.notEqual(parseListResponse(JSON.stringify({data:{list:{...list,html:row+'<script>var aliyun_waf=1</script>'}}})).outcome,'challenge_detected');
for(const html of ['<html><title>普通商品页</title><body>商品<script>var challenge=1</script></body></html>',
 '<html><script>console.log("captcha challenge")</script></html>',
 '<html><body><p>challenge captcha</p><script>var aliyun_waf=1</script></body></html>',
 '<html><script>'+('const x="text";'.repeat(200))+'</script></html>']){
 assert.equal(classifyHtmlResponse(html).kind,'ordinary_html');assert.equal(parseListResponse(html).outcome,'unsupported_response');
}
assert.equal(parseListResponse('<title>Access Denied</title><body>Access Denied</body>').outcome,'blocked');
for(const script of ['var aliyun_waf=1;', 'var _waf_token="fixture";', 'var challenge=1;document.cookie;'+('/* padding */'.repeat(120))]){
 const html='<html><head></head><body><script>'+('/* padding */'.repeat(100))+script+'</script></body></html>';
 const r=parseListResponse(html);assert.equal(r.outcome,'challenge_detected');assert.equal(r.code,'challenge_detected');assert.equal(r.blocked,true);
 assert.equal(r.diagnostic.rules.scriptShell,true);assert.equal(htmlAccessFailure(html).outcome,'challenge_detected');
}
// Marker after the previous 8192-character cutoff is still inspected, never logged.
assert.equal(parseListResponse('<script>'+('/* padding */'.repeat(900))+'var aliyun_waf=1;</script>').outcome,'challenge_detected');
assert.equal(parseListResponse('invalid json').outcome,'parse_error');
assert.equal(parseListResponse(JSON.stringify({data:{list:{summary:{total_comment_num:0,pageCount:0},html:''}}})).outcome,'empty_confirmed');
assert.equal(parseListResponse(JSON.stringify({data:{list:{summary:{total_comment_num:79,total_auto_count:79,pageCount:0},html:''}}})).outcome,'defaults_only');
const compile=async name=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(await readFile(new URL('../src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const helperURL=await compile('collection'),urlURL=await compile('url');
const source=ts.transpileModule(await readFile(new URL('../src/api.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(['"])\.\/collection\1/g,JSON.stringify(helperURL)).replace(/(['"])\.\/url\1/g,JSON.stringify(urlURL));
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{store.set(k,v);localStorage[k]=v;},removeItem:k=>{store.delete(k);delete localStorage[k];}};
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')),h=await import(helperURL);
const task={pid:'12345',ownerId:'owner',url:'https://product.dangdang.com/12345.html',maxPages:3,maxDetails:3,addedAt:Date.now(),lastTry:0,tries:0};
api.taskQueueAdd(task);const paused=api.taskQueueFailure(task,'challenge_detected',90000)[0];
assert.equal(paused.state,'paused');assert.equal(paused.reason,'challenge_detected');assert.ok(paused.nextAt>=paused.lastTry+90000);
assert.equal(h.queueDue(paused,Date.now()+300000),false);assert.equal(h.canResume(api.taskQueueList(),task.pid,task.ownerId),false);
api.archiveList(); // Archive compatibility scanning must never consume the retry queue.
const reloaded=JSON.parse(store.get('ddv-task-queue-v1'))[0];assert.equal(reloaded.state,'paused');assert.equal(h.queueDue(reloaded,Date.now()+300000),false);
api.taskQueueFailure(task,'network_error');assert.equal(api.taskQueueList()[0].reason,'challenge_detected');
api.taskQueueStop(task.pid,task.ownerId);api.taskQueueFailure(task,'challenge_detected');assert.equal(api.taskQueueList()[0].state,'stopped');
const c=new AbortController();c.abort();assert.equal(h.mayQueue(c.signal,false,true),false);
assert.match(h.issueText('challenge_detected'),/访问验证页面/);assert.doesNotMatch(h.issueText('challenge_detected'),/格式暂未识别/);
console.log('Offline challenge parser + queue fixtures passed. No network or script execution.');
