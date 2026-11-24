import {pool,transaction} from './db.mjs';
import {stopUserWork} from './admin-api.mjs';
if(!pool)throw new Error('DATABASE_URL is required');
const [action,target,value]=process.argv.slice(2);
try{
 if(['grant-pro','grant-enterprise','revoke-pro','revoke-enterprise'].includes(action)){
  const expiry=value?new Date(value):null;
  if(expiry&&(!Number.isFinite(expiry.getTime())||expiry<=new Date()))throw new Error('到期时间无效');
  await transaction(async c=>{
   const u=(await c.query('SELECT id,role,plan FROM users WHERE email=$1 FOR UPDATE',[target?.trim().toLowerCase()])).rows[0];if(!u)throw new Error('账户不存在');
   if(u.role==='admin'&&action.startsWith('revoke-'))throw new Error('不能撤销唯一管理员的 Pro');
   await c.query('UPDATE users SET plan=$2,pro_expires_at=$3 WHERE id=$1',[u.id,action==='grant-enterprise'?'enterprise':action==='grant-pro'?'pro':'free',action.startsWith('grant-')?expiry:null]);
   if(action.startsWith('revoke-')||u.plan!==(action==='grant-enterprise'?'enterprise':'pro'))await stopUserWork(c,u.id);
   await c.query('INSERT INTO admin_audit(target_id,action,details) VALUES($1,$2,$3)',[u.id,action,JSON.stringify({source:'local_cli',expiresAt:expiry})]);
  });console.log('账户权限已更新');
 }else if(action==='concurrency'){
  const global=Number(target),perUser=Number(value);
  if(!Number.isInteger(global)||global<1||global>8||!Number.isInteger(perUser)||perUser<1||perUser>4)throw new Error('concurrency global(1..8) per-user(1..4)');
  await transaction(async c=>{await c.query('UPDATE ai_runtime SET global_concurrency=$1,user_concurrency=$2 WHERE singleton',[global,perUser]);await c.query("INSERT INTO admin_audit(action,details) VALUES('concurrency',$1)",[JSON.stringify({global,perUser})]);});
 }else throw new Error('grant-pro/grant-enterprise email [ISO-expiry] | revoke-pro/revoke-enterprise email | concurrency 2 1');
}finally{await pool.end();}
