// Explicit LOCAL-only bootstrap. Never sends mail; never resets existing passwords.
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pool,transaction} from './db.mjs';
import {passwordHash} from './accounts.mjs';
if(process.env.NODE_ENV==='production')throw new Error('仅限本地开发环境');
const db=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1','[::1]'].includes(db.hostname))throw new Error('仅允许本机数据库');
const file=resolve('.private/demo-credentials.json');
try{
 let previous={};try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const records=[];
 await mkdir(resolve('.private'),{recursive:true,mode:0o700});await chmod(resolve('.private'),0o700);
 // Persist generated credentials before committing users, so interruption cannot lose them.
 for(const [name,plan,role] of [['free','free','user'],['pro','pro','user'],['admin','pro','admin']]){
  const email=`${name}@dangdangvoice.example`;
  const exists=(await pool.query('SELECT id,role FROM users WHERE email=$1',[email])).rows[0];
  if(exists){records.push(previous.accounts?.find(a=>a.email===email)||{email,password:null,note:'已有账户，密码未重置；使用原凭据'});continue;}
  const password=process.env[`BOOTSTRAP_${name.toUpperCase()}_PASSWORD`]||previous.accounts?.find(a=>a.email===email)?.password||randomBytes(24).toString('base64url');
  if(password.length<12||password.length>128)throw new Error('引导密码需12–128字符');
  records.push({email,password});
  await writeFile(file,JSON.stringify({accounts:records},null,2),{mode:0o600});await chmod(file,0o600);
  const encoded=await passwordHash(password);
  await transaction(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(17063,1)");
   await c.query('INSERT INTO users(id,email,password_hash,verified_at,plan,role) VALUES($1,$2,$3,now(),$4,$5) ON CONFLICT(email) DO NOTHING',[randomUUID(),email,encoded,plan,role]);
   await c.query("INSERT INTO admin_audit(action,details) VALUES('local_bootstrap',$1)",[JSON.stringify({email,role})]);
  });
 }
 const admin=(await pool.query("SELECT email FROM users WHERE role='admin'")).rows;
 if(admin.length!==1||admin[0].email!=='admin@dangdangvoice.example')throw new Error('管理员与引导标识冲突，请手动核查；未替换已有管理员');
 await writeFile(file,JSON.stringify({notice:'仅限本地演示；标识不是可投递邮箱。请妥善保存。',accounts:records},null,2),{mode:0o600});await chmod(file,0o600);
 console.log('本地演示账户已就绪；私有凭据文件：'+file);
}finally{await pool.end();}
