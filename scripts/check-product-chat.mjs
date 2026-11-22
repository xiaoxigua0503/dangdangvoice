// Targeted local mock check. Refuses ordinary/production databases and all fetches.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
const url=new URL(process.env.DATABASE_URL||'invalid:');
if(process.env.NODE_ENV!=='test'||process.env.AI_PROVIDER!=='mock'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/ddv_chat_check')throw new Error('Use a disposable loopback ddv_chat_check database, NODE_ENV=test AI_PROVIDER=mock');
globalThis.fetch=()=>{throw new Error('Network forbidden in chat check');};
const {pool}=await import('../server/db.mjs');
const {aiAPI}=await import('../server/ai-api.mjs');
const {aiConfig,digest}=await import('../server/ai-config.mjs');
const {claimChat,executeChat}=await import('../server/ai-chat-worker-core.mjs');
const {loadChatContext,validateChat,chatBudget,chatConfig,chatEnvelope,CHAT_PROMPT,commentProvenance}=await import('../server/ai-chat-context.mjs');
try{
 assert.equal((await pool.query("SELECT to_regclass('public.users') existing")).rows[0].existing,null,'Database must be empty');
 await pool.query('CREATE TABLE schema_migrations(version text PRIMARY KEY)');
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));await pool.query('INSERT INTO schema_migrations VALUES($1)',[file]);}
 const owner=randomUUID(),other=randomUUID(),run=randomUUID(),job=randomUUID(),csrf='c'.repeat(64),session='a'.repeat(64),otherSession='b'.repeat(64);
 for(const [id,token] of [[owner,session],[other,otherSession]]){await pool.query("INSERT INTO users(id,email,password_hash,verified_at,plan) VALUES($1,$2,'unused',now(),'pro')",[id,id+'@example.invalid']);await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);}
 await pool.query("INSERT INTO saved_runs(id,user_id,idempotency_key,product,engine_version) VALUES($1,$2,$3,$4,'mock')",[run,owner,randomUUID(),{pid:'123',name:'Mock only'}]);
 const report={schemaVersion:4,hasSynthesis:true,summary:'本地模拟报告',considerations:[],generatedAt:'2026-11-22T00:00:00Z'};
 await pool.query("INSERT INTO ai_jobs(id,user_id,run_id,input_hash,config,config_hash,product,state,report) VALUES($1,$2,$3,'immutable',$4,'mock',$5,'completed',$6)",[job,owner,run,aiConfig(),{pid:'123',name:'Mock only'},report]);
 await pool.query("INSERT INTO ai_comments(job_id,id,data) VALUES($1,'C0',$2)",[job,{text:'包装有损坏，内容适合入门',score:8}]);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGP4TyFgGDVg1IBRA4aLAQBdePwur/3haQAAAABJRU5ErkJggg==','base64');
 await pool.query("INSERT INTO ai_images(job_id,id,url,bytes,mime,content_hash) VALUES($1,'I0','https://img.ddimg.cn/mock.png',$2,'image/png',$3)",[job,bytes,digest(bytes)]);
 await pool.query("INSERT INTO ai_image_comments VALUES($1,'I0','C0')",[job]);
 const root=`/api/ai/jobs/${job}/chat`;
 async function request(method,path,body,token=session,headers={}){let response;const req={method,headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json','x-csrf-token':csrf,cookie:`ddv_account=${token}; ddv_csrf=${csrf}`,...headers}};await aiAPI(req,{setHeader(){}},new URL(path,'http://localhost:3000'),async()=>JSON.stringify(body),(res,status,data)=>{response={status,data};});return response;}
 let calls=0;
 const answer=async(config,input,images)=>{calls++;assert.equal(input.scope.snapshot,run);assert.deepEqual(input.comments.map(c=>c.id),['C0']);assert.equal(images.length,0);assert.deepEqual(input.scope.currentImageIds,[]);assert.equal(input.reportReference.kind,'previous_ai_report_not_primary_evidence');return {result:{text:'买家提到包装损坏。[1]',references:[{citation:1,type:'comment',id:'C0'}]},usage:{mock:true,prompt_tokens:10,completion_tokens:5,total_tokens:15}};};
 assert.equal((await request('GET',root)).data.conversation,null);
 assert.equal(+(await pool.query('SELECT count(*) n FROM ai_chat_conversations')).rows[0].n,0);
 assert.equal((await request('GET',root,undefined,otherSession)).status,404);
 assert.equal((await request('POST',root,{requestId:randomUUID(),question:'test'},session,{origin:'https://untrusted.invalid'})).status,403);
 for(const column of ["plan='free'","verified_at=NULL","disabled_at=now()","pro_expires_at=now()-interval '1 day'"]){await pool.query('UPDATE users SET '+column+' WHERE id=$1',[owner]);assert.ok([401,403].includes((await request('GET',root)).status));await pool.query("UPDATE users SET plan='pro',verified_at=now(),disabled_at=NULL,pro_expires_at=NULL WHERE id=$1",[owner]);}
 const before=+(await pool.query('SELECT count(*) n FROM ai_chat_requests')).rows[0].n;
 assert.equal((await request('POST',root+'/preflight',{requestId:randomUUID(),question:'图片',imageIds:['I0'],purpose:'gift'})).status,200);
 assert.equal(+(await pool.query('SELECT count(*) n FROM ai_chat_requests')).rows[0].n,before,'Preflight cannot enqueue');
 assert.equal(+(await pool.query('SELECT count(*) n FROM ai_chat_conversations')).rows[0].n,0,'Preflight cannot create conversation');
 const foreignRun=randomUUID();await pool.query("INSERT INTO saved_runs(id,user_id,idempotency_key,product,engine_version) VALUES($1,$2,$3,$4,'mock')",[foreignRun,other,randomUUID(),{pid:'999'}]);
 const foreignJob=randomUUID();await pool.query("INSERT INTO ai_jobs(id,user_id,run_id,input_hash,config,config_hash,product,state,report) VALUES($1,$2,$3,'foreign',$4,'foreign',$5,'completed',$6)",[foreignJob,other,foreignRun,aiConfig(),{pid:'999'},report]);
 await pool.query("INSERT INTO ai_images(job_id,id,url,bytes,mime,content_hash) VALUES($1,'FOREIGN','https://img.ddimg.cn/foreign.png',$2,'image/png',$3)",[foreignJob,bytes,digest(bytes)]);
 assert.equal((await request('POST',root,{requestId:randomUUID(),question:'foreign image',imageIds:['FOREIGN']})).status,422);
 assert.equal((await request('POST',root+'/preflight',{requestId:randomUUID(),question:'duplicates',imageIds:['I0','I0']})).status,422);
 const cap=process.env.AI_CHAT_CONTEXT_TOKENS;process.env.AI_CHAT_CONTEXT_TOKENS='10000';
 const tooLarge=await request('POST',root,{requestId:randomUUID(),question:'预算',imageIds:['I0']});assert.equal(tooLarge.status,422);assert.ok(tooLarge.data.msg.includes('聊天单独配置'));if(cap===undefined)delete process.env.AI_CHAT_CONTEXT_TOKENS;else process.env.AI_CHAT_CONTEXT_TOKENS=cap;
 assert.equal(+(await pool.query('SELECT count(*) n FROM ai_chat_requests')).rows[0].n,0);
 assert.equal(commentProvenance('30113677',{detail_url:'https://comment.dangdang.com/comment/detail/0/29473473/47',variant:'普通版'}).sourceProductId,'29473473');
 assert.equal(commentProvenance('30113677',{}).versionStatus,'可能为其他版本／版本未确认');
 assert.ok(CHAT_PROMPT.includes('你还在马'));assert.ok(CHAT_PROMPT.includes('本轮未重新查看图片'));
 const first={requestId:randomUUID(),question:'买家反映了哪些问题？',useImages:false};
 const responses=await Promise.all([request('POST',root,first),request('POST',root,first)]);assert.ok(responses.every(r=>r.status===200));
 assert.equal(+(await pool.query('SELECT count(*) n FROM ai_chat_requests')).rows[0].n,1);
 assert.equal((await request('POST',root,{...first,requestId:randomUUID()})).status,429);
 const claimed=await claimChat();assert.ok(claimed);assert.equal(await claimChat(),null);
 const c=await pool.connect();try{const context=await loadChatContext(c,{...claimed,image_ids:['I0'],use_images:true});assert.equal(context.images.length,1);const budget=chatBudget({...chatConfig(),...chatConfig().models[0]},context.input,context.images);assert.equal(budget.imageTokens,chatConfig().models[0].limits.imageTokens);assert.equal(budget.payloadBytes,Buffer.byteLength(JSON.stringify(chatEnvelope({...chatConfig(),...chatConfig().models[0]},context.input,context.images))));const larger=chatBudget({...chatConfig(),...chatConfig().models[0]},context.input,[{...context.images[0],bytes:Buffer.alloc(2000)}]);assert.equal(larger.textBytes,budget.textBytes);assert.equal(larger.imageTokens,budget.imageTokens);assert.equal(larger.upperTokens,budget.upperTokens);assert.equal(chatBudget({...chatConfig(),...chatConfig().models[0],chatContext:1},context.input,context.images).reason,'chat_context_limit');assert.deepEqual(context.input.imageCatalog[0].comments,['C0']);assert.throws(()=>validateChat({text:'wrong',references:[{type:'comment',id:'foreign'}]},context.input,context.images));assert.equal(chatBudget({...chatConfig(),chatContext:1},context.input,context.images).fits,false);}finally{c.release();}
 await executeChat(claimed,{inferFn:answer});assert.equal(calls,1);
 assert.equal((await request('GET',root)).data.turns[0].result.references[0].id,'C0');
 await request('POST',root,first);await request('GET',root);assert.equal(await claimChat(),null);assert.equal(calls,1,'Refresh/replay must not infer');
 const firstTurn=(await request('GET',root)).data.turns[0];assert.equal(firstTurn.scope.deliveryConfirmed,true);assert.deepEqual(firstTurn.scope.deliveredImageIds,[]);assert.equal(firstTurn.result.references[0].citation,1);
 const oldSession=(await request('GET',root)).data.sessionId;
 await pool.query("INSERT INTO ai_chat_requests(id,conversation_id,session_id,ordinal,question,config,protocol,state,result) VALUES($1,$2,$3,2,'legacy',$4,'product-chat-v1','completed',$5)",[randomUUID(),claimed.conversation_id,oldSession,chatConfig(),{text:'旧回答 [1]',references:[{type:'comment',id:'C0'}]}]);
 assert.equal((await request('GET',root)).data.turns.at(-1).result.references[0].citation,undefined,'Never invent old citation mapping');
 const freshSession=randomUUID();assert.equal((await request('POST',root+'/sessions',{sessionId:freshSession})).status,200);assert.equal(calls,1);
 assert.equal((await request('GET',root+'?session='+freshSession)).data.turns.length,0);assert.equal((await request('GET',root+'?session='+oldSession)).data.turns.length,2);assert.equal(calls,1);
 const freshPreview=await request('POST',root+'/preflight',{requestId:randomUUID(),question:'新对话',imageIds:['I0'],purpose:'collection',sessionId:freshSession});assert.equal(freshPreview.data.scope.historyIncluded,0);assert.equal(calls,1);
 const second={requestId:randomUUID(),question:'这张图片呢？',useImages:false};await request('POST',root,second);
 const cancelled=await claimChat();let start,late,observeAbort;
 const started=new Promise(resolve=>{start=resolve;}),aborted=new Promise(resolve=>{observeAbort=resolve;});
 const execution=executeChat(cancelled,{inferFn:async(config,input,images,signal)=>{calls++;start();signal.addEventListener('abort',observeAbort,{once:true});return new Promise(resolve=>{late=()=>resolve({result:{text:'late answer',references:[]},usage:{mock:true}});});}});
 await started;assert.equal((await request('POST',`${root}/${second.requestId}/cancel`,{})).status,200);assert.equal(await claimChat(),null,'Stopping request keeps its processing slot');
 await aborted;late();await execution;
 const state=(await pool.query('SELECT state,result,lease_token FROM ai_chat_requests WHERE id=$1',[second.requestId])).rows[0];assert.equal(state.state,'cancelled');assert.equal(state.result,null);assert.equal(state.lease_token,null);assert.equal(await claimChat(),null);assert.equal(calls,2);
 const third={requestId:randomUUID(),question:'interruption'};await request('POST',root,third);await claimChat();await pool.query("UPDATE ai_chat_requests SET lease_until=now()-interval '1 second' WHERE id=$1",[third.requestId]);assert.equal(await claimChat(),null);assert.equal((await request('GET',root)).data.turns.at(-1).state,'failed');assert.equal(calls,2,'Lost lease must never repeat inference');
 const fourth={requestId:randomUUID(),question:'changed snapshot'};await request('POST',root,fourth);const stale=await claimChat();await pool.query("UPDATE ai_jobs SET report=jsonb_set(report,'{summary}','\"New report\"') WHERE id=$1",[job]);await executeChat(stale,{inferFn:answer});assert.equal(calls,2);assert.equal((await request('GET',root)).data.conversation,null,'New report cannot show old conversation');
 const visual={requestId:randomUUID(),question:'请看所选图片',imageIds:['I0'],purpose:'gift'};assert.equal((await request('POST',root,visual)).status,200);
 await executeChat(await claimChat(),{inferFn:async(config,input,images)=>{calls++;assert.equal(input.purchasePurpose,'gift');assert.deepEqual(images.map(i=>i.id),['I0']);return {result:{text:'mock 视觉输入 [1]',references:[{citation:1,type:'image',id:'I0'}]},usage:{mock:true}};}});
 const visualTurn=(await request('GET',root)).data.turns[0];assert.deepEqual(visualTurn.scope.deliveredImageIds,['I0']);assert.equal(visualTurn.scope.deliveryMode,'mock');assert.equal(visualTurn.result.references[0].id,'I0');assert.equal(calls,3);
 console.log('Product chat mock check passed: auth/CSRF/ownership, idempotency, order/concurrency, references/images/budget, refresh without inference, abort/late response, expired lease and report identity. No network/model/mail calls.');
}finally{await pool.end();}
