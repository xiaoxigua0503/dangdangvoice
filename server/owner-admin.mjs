// Privileged server CLI only. Promotes a normally registered, verified owner;
// creates no password, bypasses no email verification, imports no local demo user.
import {z} from 'zod';
import {pool,transaction} from './db.mjs';
const [address,confirmOrigin]=process.argv.slice(2);
try{
 const email=z.string().trim().email().transform(v=>v.toLowerCase()).parse(address);
 if(!pool||process.env.NODE_ENV!=='production'||!process.env.DATABASE_URL)throw new Error('仅用于配置完成的生产数据库');
 const origin=new URL(process.env.APP_BASE_URL||'');
 if(origin.protocol!=='https:'||origin.origin!==confirmOrigin||email.endsWith('.example')||email.endsWith('@example.com'))throw new Error('需真实 owner 邮箱和精确 HTTPS origin 确认');
 await transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(17063,1)');
  const u=(await c.query('SELECT id,verified_at,disabled_at FROM users WHERE email=$1 FOR UPDATE',[email])).rows[0];
  if(!u?.verified_at||u.disabled_at)throw new Error('owner 须先正常注册并完成邮箱验证，且账户未停用');
  const admin=(await c.query("SELECT id FROM users WHERE role='admin'")).rows[0];
  if(admin&&admin.id!==u.id)throw new Error('已存在其他唯一管理员，未修改');
  await c.query("UPDATE users SET role='admin',plan='pro',pro_expires_at=NULL WHERE id=$1",[u.id]);
  await c.query("INSERT INTO admin_audit(actor_id,target_id,action,details) VALUES($1,$1,'owner_bootstrap',$2)",[u.id,JSON.stringify({origin:origin.origin,source:'privileged_cli'})]);
 });console.log('生产 owner 管理员已就绪；原密码保持不变');
}catch(e){console.error(e instanceof z.ZodError?'需要有效 owner 邮箱':e.message);process.exitCode=1;}finally{await pool?.end();}
