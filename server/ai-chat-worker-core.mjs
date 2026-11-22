import {randomUUID} from 'node:crypto';
import {pool,transaction} from './db.mjs';
import {numberEnv} from './ai-config.mjs';
import {loadChatContext,validateChat,CHAT_PROTOCOL} from './ai-chat-context.mjs';
import {chatModel,inferChat} from './ai-chat-provider.mjs';
const eligible=`u.plan='pro' AND u.verified_at IS NOT NULL AND u.disabled_at IS NULL AND (u.pro_expires_at IS NULL OR u.pro_expires_at>now())`;
export async function claimChat(){return transaction(async c=>{
 // Serializes claims across all chat processes; independent from report slots.
 await c.query('SELECT pg_advisory_xact_lock(17062,1)');
 await c.query("UPDATE ai_chat_requests SET state='failed',error='worker_interrupted',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='running' AND lease_until<now()");
 await c.query("UPDATE ai_chat_attempts a SET ended_at=now(),error='worker_interrupted' FROM ai_chat_requests r WHERE a.request_id=r.id AND a.ended_at IS NULL AND r.state IN ('failed','cancelled')");
 await c.query(`UPDATE ai_chat_requests r SET state='cancelled',error='entitlement_changed',updated_at=now() FROM ai_chat_conversations v JOIN users u ON u.id=v.user_id WHERE r.conversation_id=v.id AND r.state IN ('pending','running') AND NOT (${eligible})`);
 const running=+(await c.query("SELECT count(*) n FROM ai_chat_requests WHERE state='running' OR (state='cancelled' AND lease_until>now())")).rows[0].n;
 if(running>=numberEnv('AI_CHAT_CONCURRENCY',1,1,4))return null;
 const row=(await c.query(`SELECT r.*,v.user_id,v.job_id FROM ai_chat_requests r JOIN ai_chat_conversations v ON v.id=r.conversation_id JOIN users u ON u.id=v.user_id
   WHERE r.state='pending' AND r.protocol=$1 AND r.config->>'provider'=$2 AND ${eligible}
   AND ($3::uuid IS NULL OR v.job_id=$3::uuid)
   ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1`,[CHAT_PROTOCOL,process.env.AI_PROVIDER||'qwen',process.env.AI_WORKER_JOB_ID||null])).rows[0];
 if(!row)return null;
 row.lease_token=randomUUID();
 await c.query("UPDATE ai_chat_requests SET state='running',lease_token=$2,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1",[row.id,row.lease_token]);return row;
});}
export async function renewChat(request){
 const r=await pool.query(`UPDATE ai_chat_requests r SET lease_until=now()+interval '30 seconds' FROM ai_chat_conversations v JOIN users u ON u.id=v.user_id
 WHERE r.id=$1 AND r.lease_token=$2 AND r.state='running' AND r.lease_until>now() AND r.conversation_id=v.id AND ${eligible} RETURNING r.id`,[request.id,request.lease_token]);return !!r.rowCount;
}
export async function executeChat(request,{signal,inferFn=inferChat}={}){
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let timer,renewing=false;
 const check=async()=>{if(renewing)return;renewing=true;try{if(!await renewChat(request))controller.abort();}catch{controller.abort();}finally{renewing=false;}};
 timer=setInterval(()=>void check(),2000);
 let c,attempt=null,scope=null;
 try{
  c=await pool.connect();
  if(!await renewChat(request))controller.abort();controller.signal.throwIfAborted();
  const context=await loadChatContext(c,request);scope=context.scope;
  await c.query("UPDATE ai_chat_requests SET scope=$3 WHERE id=$1 AND lease_token=$2 AND state='running'",[request.id,request.lease_token,scope]);
  let start=0;
  for(let n=0;n<request.config.chatRequests;n++){
   controller.signal.throwIfAborted();
   const selection=await chatModel(c,request.config,context.input,context.images,start),config=selection.config;
   // Durable dispatch intent precedes any network call. Expired leases are failed,
   // never reclaimed, so an unknown provider outcome cannot cause duplicate calls.
   if(!await renewChat(request))throw new Error('cancelled');
   attempt=(await c.query('INSERT INTO ai_chat_attempts(request_id,model,endpoint_host) VALUES($1,$2,$3) RETURNING id',[request.id,config.model,new URL(config.endpoint).hostname])).rows[0].id;
   const dispatch=await c.query("UPDATE ai_chat_requests SET actual_model=$3 WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id",[request.id,request.lease_token,config.model]);
   if(!dispatch.rowCount)controller.abort();controller.signal.throwIfAborted();
   let output;
   try{output=await inferFn(config,context.input,context.images,controller.signal);}
   catch(error){
    await c.query('UPDATE ai_chat_attempts SET ended_at=now(),error=$2,usage=$3 WHERE id=$1',[attempt,error.fallbackReason||'provider_error',error.providerUsage||{}]);attempt=null;
    controller.signal.throwIfAborted();
    if(error.fallbackReason&&selection.index+1<request.config.models.length&&n+1<request.config.chatRequests){
     await c.query(`INSERT INTO ai_chat_model_cooldowns(model_key,until_at,reason) VALUES($1,now()+($2*interval '1 millisecond'),$3) ON CONFLICT(model_key) DO UPDATE SET until_at=excluded.until_at,reason=excluded.reason`,[selection.key,config.modelCooldownMs,error.fallbackReason]);
     start=selection.index+1;continue;
    }
    throw error;
   }
   await c.query('UPDATE ai_chat_attempts SET ended_at=now(),usage=$2 WHERE id=$1',[attempt,output.usage]);attempt=null;
   controller.signal.throwIfAborted();
   const result=validateChat(output.result,context.input,context.images);
   // Re-check immutable report identity and entitlement immediately before commit.
   await c.query('BEGIN');
   await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[context.conv.user_id]);
   await loadChatIdentity(c,context.conv);
   if(!await renewChat(request))throw new Error('cancelled');
   await c.query(`UPDATE ai_chat_requests SET state='completed',result=$3,usage=$4,lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()`,[request.id,request.lease_token,result,await totalUsage(c,request.id,config.provider==='mock')]);
   await c.query('COMMIT');
   return;
  }
  throw new Error('provider_request_budget');
 }catch(error){
  if(!c)throw error;
  await c.query('ROLLBACK');
  const safe=['context_budget_exceeded','model_limits_unverified','provider_models_unavailable','image_unavailable','snapshot_changed','invalid_reference'];
  const code=controller.signal.aborted?'cancelled':safe.includes(error.message)?error.message:'answer_failed';
  if(attempt)await c.query('UPDATE ai_chat_attempts SET ended_at=now(),error=$2 WHERE id=$1',[attempt,code]);
  await c.query("UPDATE ai_chat_requests SET state=$3,error=$4,usage=$5,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running'",[request.id,request.lease_token,code==='cancelled'?'cancelled':'failed',code,await totalUsage(c,request.id,false)]);
 }finally{clearInterval(timer);signal?.removeEventListener('abort',abort);if(c){try{await c.query("UPDATE ai_chat_requests SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='cancelled'",[request.id,request.lease_token]);}finally{c.release();}}}
}
async function totalUsage(c,id,mock){const rows=(await c.query('SELECT usage FROM ai_chat_attempts WHERE request_id=$1',[id])).rows;return {mock,attempts:rows.length,...Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].map(k=>[k,rows.reduce((n,r)=>n+(r.usage?.[k]||0),0)]))};}
// Identity only: do not reload images or rebuild inference context at commit time.
import {validChatReport,reportHash} from './ai-chat-context.mjs';
async function loadChatIdentity(c,conv){const job=(await c.query('SELECT state,report,input_hash FROM ai_jobs WHERE id=$1 AND user_id=$2 AND run_id=$3 FOR SHARE',[conv.job_id,conv.user_id,conv.run_id])).rows[0];if(!validChatReport(job)||job.input_hash!==conv.input_hash||reportHash(job.report)!==conv.report_hash)throw new Error('snapshot_changed');}
