import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction} from './db.mjs';
import {effectivePro} from './accounts.mjs';
import {numberEnv,digest} from './ai-config.mjs';
import {chatConfig,validChatReport,reportHash,loadChatContext,chatBudget,CHAT_PROTOCOL,BUDGET_MESSAGES,commentProvenance} from './ai-chat-context.mjs';
const fail=(status,msg)=>{throw Object.assign(new Error(msg),{status});};
const activeSQL="(r.state IN ('pending','running') OR (r.state='cancelled' AND r.lease_until>now()))";
const questionSchema=()=>z.object({requestId:z.string().uuid(),question:z.string().trim().min(1).max(numberEnv('AI_CHAT_MAX_QUESTION_CHARS',2000,50,10000)),useImages:z.boolean().optional(),imageIds:z.array(z.string().min(1).max(100)).max(4).optional(),purpose:z.enum(['unspecified','beginner','research','gift','collection']).default('unspecified'),sessionId:z.string().uuid().optional()}).strict();
async function parseBody(req,readBody,schema){let raw;try{raw=JSON.parse(await readBody(req,65536));}catch{fail(400,'请求内容无效');}return schema.parse(raw);}
function budgetError(error){if(BUDGET_MESSAGES[error.message])fail(422,BUDGET_MESSAGES[error.message]);throw error;}
export async function chatAPI(req,res,url,user,readBody,json){
 const match=url.pathname.match(/^\/api\/ai\/jobs\/([^/]+)\/chat(?:\/(preflight|sessions|evidence)|\/([^/]+)\/cancel)?$/);
 if(!match)return false;
 const jobId=z.string().uuid().parse(match[1]),action=match[2]||'';
 // Fixed origin/CSRF, verified authentication and effective Pro are enforced by aiAPI.
 if(match[3]){
  if(req.method!=='POST')fail(405,'不支持此请求方式');
  await parseBody(req,readBody,z.object({}).strict());const id=z.string().uuid().parse(match[3]);
  const r=await pool.query(`UPDATE ai_chat_requests r SET state='cancelled',error='cancelled',updated_at=now()
    FROM ai_chat_conversations c WHERE r.id=$1 AND c.id=r.conversation_id AND c.user_id=$2 AND c.job_id=$3 AND r.state IN ('pending','running') RETURNING r.id`,[id,user.id,jobId]);
  if(!r.rowCount&&!(await pool.query('SELECT 1 FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE r.id=$1 AND c.user_id=$2 AND c.job_id=$3',[id,user.id,jobId])).rowCount)fail(404,'问答不存在');
  json(res,200,{ok:true});return true;
 }
 if(!['GET','POST'].includes(req.method)||(action==='evidence'&&req.method!=='GET')||(['sessions','preflight'].includes(action)&&req.method!=='POST'))fail(405,'不支持此请求方式');
 const body=req.method==='POST'?await parseBody(req,readBody,action==='sessions'?z.object({sessionId:z.string().uuid()}).strict():questionSchema()):null;
 if(body&&action!=='sessions'){
  if(body.useImages&&!body.imageIds)fail(422,'请刷新页面并明确选择图片，不再自动选择图片。');
  body.imageIds=body.imageIds||[];if(new Set(body.imageIds).size!==body.imageIds.length)fail(422,'请勿重复选择同一图片');
 }
 const result=await transaction(async c=>{
  if(body){const entitlement=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];if(!effectivePro(entitlement)||!entitlement.verified_at)fail(403,'需要已验证邮箱的有效 Pro 账户');}
  const job=(await c.query('SELECT id,product,run_id,input_hash,state,report FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR SHARE',[jobId,user.id])).rows[0];
  if(!job)fail(404,'AI 任务不存在');
  if(body&&!action){
   const replay=(await c.query('SELECT r.*,c.user_id,c.job_id FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE r.id=$1',[body.requestId])).rows[0];
   if(replay){const sameImages=replay.image_ids===null?!body.imageIds.length&&!replay.use_images:JSON.stringify([...replay.image_ids].sort())===JSON.stringify([...body.imageIds].sort());if(replay.user_id!==user.id||replay.job_id!==jobId||replay.question!==body.question||!sameImages||replay.purpose!==body.purpose||(body.sessionId&&body.sessionId!==replay.session_id))fail(409,'请求编号已使用，请刷新问答');return {accepted:true,requestId:replay.id};}
  }
  if(!validChatReport(job))fail(409,'请先生成有效的 AI 综合解读后再提问');
  if(action==='evidence')return chatEvidence(c,job,url);
  const hash=reportHash(job.report);
  let conv=(await c.query('SELECT * FROM ai_chat_conversations WHERE user_id=$1 AND job_id=$2 AND input_hash=$3 AND report_hash=$4',[user.id,jobId,job.input_hash,hash])).rows[0];
  const draft=conv||{id:randomUUID(),user_id:user.id,job_id:jobId,run_id:job.run_id,input_hash:job.input_hash,report_hash:hash,report_context:job.report};
  const sessions=conv?(await c.query('SELECT id,created_at FROM ai_chat_sessions WHERE conversation_id=$1 ORDER BY created_at,id',[conv.id])).rows:[];
  const selectedSession=body?.sessionId||url.searchParams.get('session')||sessions.at(-1)?.id||null;
  if(selectedSession&&action!=='sessions'&&!sessions.some(s=>s.id===selectedSession))fail(404,'对话不属于当前报告');
  async function saveConversation(){if(!conv){await c.query('INSERT INTO ai_chat_conversations(id,user_id,job_id,run_id,input_hash,report_hash,report_context) VALUES($1,$2,$3,$4,$5,$6,$7)',[draft.id,user.id,jobId,job.run_id,job.input_hash,hash,job.report]);conv=draft;}}
  if(action==='sessions'){
   const existing=(await c.query('SELECT conversation_id FROM ai_chat_sessions WHERE id=$1',[body.sessionId])).rows[0];
   if(existing){if(existing.conversation_id!==conv?.id)fail(409,'对话编号已使用');return {sessionId:body.sessionId};}
   if(sessions.length>=numberEnv('AI_CHAT_MAX_TURNS',60,1,500))fail(429,'本报告的对话数量已达上限');
   const busy=await c.query(`SELECT 1 FROM ai_chat_requests r WHERE conversation_id=$1 AND ${activeSQL}`,[draft.id]);if(busy.rowCount)fail(409,'请先停止当前回答，再开始新对话');
   await saveConversation();await c.query('INSERT INTO ai_chat_sessions(id,conversation_id) VALUES($1,$2)',[body.sessionId,conv.id]);return {sessionId:body.sessionId};
  }
  if(body){
   const count=+(await c.query('SELECT count(*) n FROM ai_chat_requests WHERE conversation_id=$1',[draft.id])).rows[0].n;
   const config=chatConfig();if(body.imageIds.length>config.imageLimit)fail(422,'所选图片超过聊天限制，请减少图片');
   const sessionId=selectedSession||randomUUID();
   const request={draftConversation:draft,conversation_id:draft.id,session_id:sessionId,ordinal:count+1,question:body.question,image_ids:body.imageIds,use_images:!!body.imageIds.length,purpose:body.purpose,config,protocol:CHAT_PROTOCOL};
   let context;try{context=await loadChatContext(c,request);}catch(e){budgetError(e);}
   // Preflight uses the primary model and the entire unchanged input, without
   // provider selection/fallback, queue creation or inference.
   const primary={...config,...config.models[0]};const budget=chatBudget(primary,context.input,context.images);
   if(!budget.fits)fail(422,BUDGET_MESSAGES[budget.reason]||'输入超过已确认预算，未提交任务。');
   if(action==='preflight')return {fits:true,budget,scope:context.scope};
   const rate=(await c.query(`INSERT INTO auth_limits(key,hits,until_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_limits.until_at<now() THEN 1 ELSE auth_limits.hits+1 END,until_at=CASE WHEN auth_limits.until_at<now() THEN now()+interval '15 minutes' ELSE auth_limits.until_at END RETURNING hits`,[digest('ai-chat:'+user.id)])).rows[0];
   if(rate.hits>numberEnv('AI_CHAT_RATE_PER_15_MIN',20,1,200))fail(429,'问答过于频繁，请稍后重试');
   const active=+(await c.query(`SELECT count(*) n FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE c.user_id=$1 AND ${activeSQL}`,[user.id])).rows[0].n;
   if(active>=numberEnv('AI_CHAT_USER_MAX_ACTIVE',1,1,4))fail(429,'已有问答正在处理，请等待或停止后再提问');
   const daily=+(await c.query("SELECT count(*) n FROM ai_chat_requests r JOIN ai_chat_conversations c ON c.id=r.conversation_id WHERE c.user_id=$1 AND r.created_at>now()-interval '24 hours'",[user.id])).rows[0].n;
   if(daily>=numberEnv('AI_CHAT_DAILY_TURNS',100,1,1000))fail(429,'今日问答次数已用尽');
   if(count>=numberEnv('AI_CHAT_MAX_TURNS',60,1,500))fail(429,'本份报告的问答轮数已达上限');
   if((await c.query(`SELECT 1 FROM ai_chat_requests r WHERE conversation_id=$1 AND ${activeSQL}`,[draft.id])).rowCount)fail(409,'请等待当前回答或先停止');
   await saveConversation();
   if(!selectedSession)await c.query('INSERT INTO ai_chat_sessions(id,conversation_id) VALUES($1,$2)',[sessionId,conv.id]);
   await c.query('INSERT INTO ai_chat_requests(id,conversation_id,session_id,ordinal,question,use_images,image_ids,purpose,config,protocol) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[body.requestId,conv.id,sessionId,count+1,body.question,!!body.imageIds.length,JSON.stringify(body.imageIds),body.purpose,config,CHAT_PROTOCOL]);
   return {accepted:true,requestId:body.requestId,sessionId};
  }
  const rows=selectedSession?(await c.query(`SELECT id,ordinal,question,use_images,image_ids,purpose,protocol,state,result,scope,error,actual_model,usage,created_at,(state='cancelled' AND lease_until>now()) stopping FROM ai_chat_requests WHERE session_id=$1 ORDER BY ordinal`,[selectedSession])).rows:[];
  const comments=(await c.query('SELECT id,data FROM ai_comments WHERE job_id=$1',[jobId])).rows;
  const catalog=(await c.query(`SELECT i.id,i.bytes IS NOT NULL available,ARRAY(SELECT comment_id FROM ai_image_comments l WHERE l.job_id=i.job_id AND l.image_id=i.id ORDER BY comment_id) comments FROM ai_images i WHERE i.job_id=$1 ORDER BY i.id`,[jobId])).rows;
  const ids={comment:new Set(comments.map(r=>r.id)),image:new Set(catalog.map(r=>r.id))};
  const turns=rows.map(r=>({...r,state:r.stopping?'stopping':r.state,error:r.error?(BUDGET_MESSAGES[r.error]||({snapshot_changed:'报告版本已变化，请重新打开当前报告。',worker_interrupted:'处理曾中断，结果未知；系统未自动再次调用模型。'}[r.error])||'回答未完成，可重新提问；取消的请求不会自动重试。'):null,result:r.result?{text:r.result.text,references:(r.result.references||[]).filter(ref=>ids[ref.type]?.has(ref.id))}:null}));
  const referenced=new Set(turns.flatMap(t=>(t.result?.references||[]).filter(r=>r.type==='comment').map(r=>r.id)));
  return {conversation:conv?{id:conv.id,jobId,runId:conv.run_id,mock:turns.some(t=>t.usage?.mock)}:null,sessionId:selectedSession,sessions,turns,catalog,sources:Object.fromEntries(comments.filter(c=>referenced.has(c.id)).map(c=>[c.id,{...commentProvenance(job.product.pid,c.data),label:`评论 ${c.id}${c.data.variant?' · '+c.data.variant:''}`}]))};
 });
 if(req.method==='GET'&&!action)result.limits={questionChars:numberEnv('AI_CHAT_MAX_QUESTION_CHARS',2000,50,10000),images:numberEnv('AI_CHAT_MAX_IMAGES',4,1,4),historyTurns:numberEnv('AI_CHAT_HISTORY_TURNS',8,1,30)};
 json(res,200,result);return true;
}
async function chatEvidence(c,job,url){
 const cid=url.searchParams.get('comment'),iid=url.searchParams.get('image');
 if(cid){const row=(await c.query('SELECT id,data FROM ai_comments WHERE job_id=$1 AND id=$2',[job.id,cid])).rows[0];if(!row)fail(404,'评论不属于当前快照');const images=(await c.query('SELECT image_id id FROM ai_image_comments WHERE job_id=$1 AND comment_id=$2',[job.id,cid])).rows;return {comment:{...row,provenance:commentProvenance(job.product.pid,row.data)},images};}
 if(iid){const image=(await c.query('SELECT id,bytes IS NOT NULL available,error FROM ai_images WHERE job_id=$1 AND id=$2',[job.id,iid])).rows[0];if(!image)fail(404,'图片不属于当前快照');const comments=(await c.query('SELECT a.id,a.data FROM ai_comments a JOIN ai_image_comments l ON l.job_id=a.job_id AND l.comment_id=a.id WHERE a.job_id=$1 AND l.image_id=$2',[job.id,iid])).rows.map(r=>({id:r.id,provenance:commentProvenance(job.product.pid,r.data)}));return {image,comments};}
 fail(422,'请选择原评或图片');
}
