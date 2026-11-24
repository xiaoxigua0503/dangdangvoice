import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction} from './db.mjs';
import {requireUser,checkOrigin,mailStatus} from './accounts.mjs';
import {coverage} from './ai-jobs.mjs';
const fail=(status,msg)=>{throw Object.assign(new Error(msg),{status});};
export async function stopUserWork(c,id){
 await c.query("UPDATE ai_jobs SET state='cancelled',report=NULL,updated_at=now() WHERE user_id=$1 AND state IN ('queued','running')",[id]);
 await c.query("UPDATE ai_units w SET state='cancelled',lease_token=NULL,lease_until=NULL,error='access_revoked' FROM ai_jobs j WHERE w.job_id=j.id AND j.user_id=$1 AND w.state IN ('pending','running')",[id]);
 if((await c.query("SELECT to_regclass('enterprise_tasks') ready")).rows[0]?.ready){await c.query("UPDATE enterprise_tasks SET state='cancelled',error='access_revoked',updated_at=now() WHERE user_id=$1 AND state IN ('pending','running')",[id]);await c.query("UPDATE enterprise_listings SET state='cancelled',error='access_revoked',updated_at=now() WHERE user_id=$1 AND state IN ('pending','running')",[id]);}
}
export async function adminAPI(req,res,url,readBody,json){
 const path=url.pathname;
 if(!path.startsWith('/api/admin/')&&path!=='/api/upgrade')return false;
 res.setHeader('Cache-Control','no-store');
 try{
 checkOrigin(req); const actor=await requireUser(req);
 if(path.startsWith('/api/admin/')&&actor.role!=='admin')fail(403,'仅管理员可访问');
 let b={};
 if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192));}catch{fail(400,'请求内容无效或过大');}}
 if(path==='/api/upgrade'){
  if(req.method==='GET'){json(res,200,{request:(await pool.query('SELECT id,state,note,created_at,reviewed_at FROM upgrade_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[actor.id])).rows[0]||null});return true;}
  if(req.method!=='POST')fail(405,'请求方式无效');
  const {note,plan}=z.object({note:z.string().trim().max(1000).default(''),plan:z.enum(['pro','enterprise']).default('pro')}).strict().parse(b);
  await transaction(async c=>{await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor.id]);
   if(+(await c.query("SELECT count(*) n FROM upgrade_requests WHERE user_id=$1 AND created_at>now()-interval '24 hours'",[actor.id])).rows[0].n>=3)fail(429,'申请过于频繁，请明天再试');
   await c.query("INSERT INTO upgrade_requests(id,user_id,note,target_plan) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) WHERE state='pending' DO NOTHING",[randomUUID(),actor.id,note,plan]);});
  json(res,200,{msg:'升级申请已提交，等待管理员审核'});return true;
 }
 const page=Math.max(1,Math.min(10000,Math.floor(Number(url.searchParams.get('page'))||1))),offset=(page-1)*20;
 if(req.method==='GET'&&path==='/api/admin/overview'){
  const users=(await pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE plan='pro' AND (pro_expires_at IS NULL OR pro_expires_at>now()) AND disabled_at IS NULL)::int pro,count(*) FILTER(WHERE plan='enterprise' AND (pro_expires_at IS NULL OR pro_expires_at>now()) AND disabled_at IS NULL)::int enterprise,count(*) FILTER(WHERE disabled_at IS NOT NULL)::int disabled FROM users")).rows[0];
  json(res,200,{users:{...users,free:users.total-users.pro-users.enterprise},pending:+(await pool.query("SELECT count(*) n FROM upgrade_requests WHERE state='pending'")).rows[0].n,jobs:(await pool.query('SELECT state,count(*)::int count FROM ai_jobs GROUP BY state')).rows,mail:mailStatus(),ai:{provider:process.env.AI_PROVIDER||'qwen',model:process.env.AI_MODEL||'qwen3.7-flash',configured:!!process.env.AI_API_KEY}});return true;
 }
 if(req.method==='GET'&&path==='/api/admin/users'){
  const q=(url.searchParams.get('q')||'').trim().slice(0,254);
  const rows=(await pool.query('SELECT id,email,role,plan,verified_at,disabled_at,pro_expires_at,created_at FROM users WHERE position(lower($1) in email)>0 ORDER BY created_at DESC LIMIT 20 OFFSET $2',[q,offset])).rows;
  json(res,200,{rows,total:+(await pool.query('SELECT count(*) n FROM users WHERE position(lower($1) in email)>0',[q])).rows[0].n,page});return true;
 }
 if(req.method==='GET'&&path==='/api/admin/requests'){
  json(res,200,{rows:(await pool.query('SELECT r.*,u.email FROM upgrade_requests r JOIN users u ON u.id=r.user_id ORDER BY (r.state=\'pending\') DESC,r.created_at DESC LIMIT 20 OFFSET $1',[offset])).rows,total:+(await pool.query('SELECT count(*) n FROM upgrade_requests')).rows[0].n,page});return true;
 }
 if(req.method==='GET'&&path==='/api/admin/jobs'){
  const rows=(await pool.query("SELECT j.id,j.state,j.created_at,j.config->>'model' model,u.email,(SELECT jsonb_build_object('attempts',count(*),'prompt_tokens',coalesce(sum((a.usage->>'prompt_tokens')::bigint),0),'completion_tokens',coalesce(sum((a.usage->>'completion_tokens')::bigint),0)) FROM ai_attempts a JOIN ai_units w ON w.id=a.unit_id WHERE w.job_id=j.id) usage FROM ai_jobs j JOIN users u ON u.id=j.user_id ORDER BY j.created_at DESC LIMIT 20 OFFSET $1",[offset])).rows;
  for(const r of rows)r.coverage=await coverage(r.id);
  json(res,200,{rows,total:+(await pool.query('SELECT count(*) n FROM ai_jobs')).rows[0].n,page});return true;
 }
 if(req.method==='GET'&&path==='/api/admin/audit'){
  json(res,200,{rows:(await pool.query('SELECT a.id,a.action,a.details,a.created_at,u.email actor,t.email target FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_id ORDER BY a.id DESC LIMIT 20 OFFSET $1',[offset])).rows,total:+(await pool.query('SELECT count(*) n FROM admin_audit')).rows[0].n,page});return true;
 }
 if(req.method==='POST'&&path==='/api/admin/action'){
  const data=z.object({userId:z.string().uuid(),action:z.enum(['grant','grant_enterprise','revoke','disable','enable','sessions','approve','reject']),requestId:z.string().uuid().optional(),expiresAt:z.string().datetime().nullable().optional()}).strict().parse(b);
  if(data.expiresAt&&new Date(data.expiresAt)<=new Date())fail(422,'到期时间须晚于当前时间');
  await transaction(async c=>{
   const u=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[data.userId])).rows[0];if(!u)fail(404,'账户不存在');
   if(u.role==='admin'&&['disable','revoke'].includes(data.action))fail(403,'不能停用唯一管理员或撤销其 Pro 权限');
   let approvedPlan='pro';
   if(['approve','reject'].includes(data.action)){
    if(!data.requestId)fail(422,'请选择申请');
    const r=await c.query("UPDATE upgrade_requests SET state=$3,reviewed_at=now(),reviewed_by=$4 WHERE id=$1 AND user_id=$2 AND state='pending' RETURNING id,target_plan",[data.requestId,u.id,data.action==='approve'?'approved':'rejected',actor.id]);if(!r.rowCount)fail(409,'申请已处理或不存在');approvedPlan=r.rows[0].target_plan||'pro';
   }
   if(['grant','grant_enterprise','approve'].includes(data.action)){const target=data.action==='grant_enterprise'?'enterprise':data.action==='approve'?approvedPlan:'pro';if(u.plan!==target)await stopUserWork(c,u.id);await c.query('UPDATE users SET plan=$2,pro_expires_at=$3 WHERE id=$1',[u.id,target,data.expiresAt||null]);}
   if(data.action==='revoke')await c.query("UPDATE users SET plan='free',pro_expires_at=NULL WHERE id=$1",[u.id]);
   if(data.action==='disable')await c.query('UPDATE users SET disabled_at=now() WHERE id=$1',[u.id]);
   if(data.action==='enable')await c.query('UPDATE users SET disabled_at=NULL WHERE id=$1',[u.id]);
   if(['disable','sessions'].includes(data.action))await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);
   if(['disable','revoke'].includes(data.action))await stopUserWork(c,u.id);
   await c.query('INSERT INTO admin_audit(actor_id,target_id,action,details) VALUES($1,$2,$3,$4)',[actor.id,u.id,data.action,JSON.stringify({expiresAt:data.expiresAt||null,requestId:data.requestId||null,plan:data.action==='grant_enterprise'?'enterprise':data.action==='approve'?approvedPlan:undefined})]);
  });json(res,200,{msg:'管理操作已保存'});return true;
 }
 fail(404,'管理接口不存在');
 }catch(e){json(res,e instanceof z.ZodError?422:e.status||503,{msg:e instanceof z.ZodError?'请求格式不正确':e.status?e.message:'管理服务暂不可用'});return true;}
}
