import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction} from './db.mjs';
import {effectivePro} from './accounts.mjs';
import {numberEnv,digest} from './ai-config.mjs';
import {chatConfig,validChatReport,reportHash} from './ai-chat-context.mjs';
const fail=(status,msg)=>{throw Object.assign(new Error(msg),{status});};
export async function chatAPI(req,res,url,user,readBody,json){
 const match=url.pathname.match(/^\/api\/ai\/jobs\/([^/]+)\/chat(?:\/([^/]+)\/cancel)?$/);
 if(!match)return false;
 const jobId=z.string().uuid().parse(match[1]);
 // Caller has already enforced origin/CSRF, verified email and effective Pro.
 if(match[2]){
  if(req.method!=='POST')fail(405,'不支持此请求方式');
  z.object({}).strict().parse(JSON.parse(await readBody(req,4096)));
  const id=z.string().uuid().parse(match[2]);
  const r=await pool.query(`UPDATE ai_chat_requests r SET state='cancelled',error='cancelled',updated_at=now()
    FROM ai_chat_conversations c WHERE r.id=$1 AND c.id=r.conversation_id AND c.user_id=$2 AND c.job_id=$3 AND r.state IN ('pending','running') RETURNING r.id`,[id,user.id,jobId]);
  if(!r.rowCount){const exists=await pool.query('SELECT 1 FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE r.id=$1 AND c.user_id=$2 AND c.job_id=$3',[id,user.id,jobId]);if(!exists.rowCount)fail(404,'问答不存在');}
  json(res,200,{ok:true});return true;
 }
 if(!['GET','POST'].includes(req.method))fail(405,'不支持此请求方式');
 const body=req.method==='POST'?z.object({requestId:z.string().uuid(),question:z.string().trim().min(1).max(numberEnv('AI_CHAT_MAX_QUESTION_CHARS',2000,50,10000)),useImages:z.boolean().default(false)}).strict().parse(JSON.parse(await readBody(req,65536))):null;
 const result=await transaction(async c=>{
  if(body){const entitlement=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];if(!effectivePro(entitlement)||!entitlement.verified_at)fail(403,'需要已验证邮箱的有效 Pro 账户');}
  const job=(await c.query('SELECT id,run_id,input_hash,state,report FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR SHARE',[jobId,user.id])).rows[0];
  if(!job)fail(404,'AI 任务不存在');
  // A replay always resolves the original request, even after a report revision.
  if(body){const replay=(await c.query('SELECT r.*,c.user_id,c.job_id FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE r.id=$1',[body.requestId])).rows[0];if(replay){if(replay.user_id!==user.id||replay.job_id!==jobId||replay.question!==body.question||replay.use_images!==body.useImages)fail(409,'请求编号已使用，请刷新问答');return {accepted:true,requestId:replay.id};}}
  if(!validChatReport(job))fail(409,'请先生成有效的 AI 综合解读后再提问');
  const hash=reportHash(job.report);
  let conv=(await c.query('SELECT * FROM ai_chat_conversations WHERE user_id=$1 AND job_id=$2 AND input_hash=$3 AND report_hash=$4',[user.id,jobId,job.input_hash,hash])).rows[0];
  if(body){
   const rateKey=digest('ai-chat:'+user.id);
   const rate=(await c.query(`INSERT INTO auth_limits(key,hits,until_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_limits.until_at<now() THEN 1 ELSE auth_limits.hits+1 END,until_at=CASE WHEN auth_limits.until_at<now() THEN now()+interval '15 minutes' ELSE auth_limits.until_at END RETURNING hits`,[rateKey])).rows[0];
   if(rate.hits>numberEnv('AI_CHAT_RATE_PER_15_MIN',20,1,200))fail(429,'问答过于频繁，请稍后重试');
   const active=+(await c.query("SELECT count(*) n FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE c.user_id=$1 AND (r.state IN ('pending','running') OR (r.state='cancelled' AND r.lease_until>now()))",[user.id])).rows[0].n;
   if(active>=numberEnv('AI_CHAT_USER_MAX_ACTIVE',1,1,4))fail(429,'已有问答正在处理，请等待或停止后再提问');
   const daily=+(await c.query("SELECT count(*) n FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE c.user_id=$1 AND r.created_at>now()-interval '24 hours'",[user.id])).rows[0].n;
   if(daily>=numberEnv('AI_CHAT_DAILY_TURNS',100,1,1000))fail(429,'今日问答次数已用尽');
   if(!conv){conv=(await c.query('INSERT INTO ai_chat_conversations(id,user_id,job_id,run_id,input_hash,report_hash,report_context) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),user.id,jobId,job.run_id,job.input_hash,hash,job.report])).rows[0];}
   const count=+(await c.query('SELECT count(*) n FROM ai_chat_requests WHERE conversation_id=$1',[conv.id])).rows[0].n;
   if(count>=numberEnv('AI_CHAT_MAX_TURNS',60,1,500))fail(429,'本份报告的问答轮数已达上限');
   const busy=await c.query("SELECT 1 FROM ai_chat_requests WHERE conversation_id=$1 AND (state IN ('pending','running') OR (state='cancelled' AND lease_until>now()))",[conv.id]);if(busy.rowCount)fail(409,'请等待当前回答或先停止');
   await c.query('INSERT INTO ai_chat_requests(id,conversation_id,ordinal,question,use_images,config) VALUES($1,$2,$3,$4,$5,$6)',[body.requestId,conv.id,count+1,body.question,body.useImages,chatConfig()]);
   return {accepted:true,requestId:body.requestId};
  }
  if(!conv)return {conversation:null,turns:[]};
  const rows=(await c.query("SELECT id,ordinal,question,use_images,state,result,scope,error,actual_model,usage,created_at,(state='cancelled' AND lease_until>now()) stopping FROM ai_chat_requests WHERE conversation_id=$1 ORDER BY ordinal",[conv.id])).rows;
  const comments=new Set((await c.query('SELECT id FROM ai_comments WHERE job_id=$1',[jobId])).rows.map(r=>r.id));
  const images=new Set((await c.query('SELECT id FROM ai_images WHERE job_id=$1',[jobId])).rows.map(r=>r.id));
  // Validate membership again at read time before any reference reaches the UI.
  const turns=rows.map(r=>({...r,state:r.stopping?'stopping':r.state,error:r.error?({context_budget_exceeded:'完整评论与本轮历史超出已确认预算，未截断或调用模型。可减少图片或缩短问题后重新提问。',model_limits_unverified:'模型容量尚未确认，未调用模型。',snapshot_changed:'报告版本已变化，请打开当前报告重新提问。',worker_interrupted:'处理曾中断，结果未知；系统未自动再次调用模型。',image_unavailable:'所选已保存图片不可用，未调用模型。'}[r.error]||'回答未完成，可重新提问；已取消的请求不会自动重试。'):null,result:r.result?{text:r.result.text,references:(r.result.references||[]).filter(ref=>(ref.type==='comment'?comments:ref.type==='image'?images:new Set()).has(ref.id))}:null}));
  return {conversation:{id:conv.id,jobId,runId:conv.run_id,mock:turns.some(t=>t.usage?.mock)},turns};
 });
 if(req.method==='GET')result.limits={questionChars:numberEnv('AI_CHAT_MAX_QUESTION_CHARS',2000,50,10000),images:numberEnv('AI_CHAT_MAX_IMAGES',4,1,12)};
 json(res,200,result);return true;
}
