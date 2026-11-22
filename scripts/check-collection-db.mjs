import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
const u=new URL(process.env.DATABASE_URL||'invalid:');
if(process.env.NODE_ENV!=='test'||process.env.AI_PROVIDER!=='mock'||!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/ddv_collection_check')throw new Error('Disposable loopback ddv_collection_check only');
globalThis.fetch=()=>{throw new Error('No network');};
const {pool}=await import('../server/db.mjs'),{collectionLease}=await import('../server/collection-lease.mjs'),{loadReportProgress}=await import('../server/ai-progress.mjs'),{createJob,preview}=await import('../server/ai-jobs.mjs'),{aiConfig}=await import('../server/ai-config.mjs');
try{
 assert.equal((await pool.query("SELECT to_regclass('public.users') t")).rows[0].t,null);
 await pool.query('CREATE TABLE schema_migrations(version text PRIMARY KEY)');
 for(const f of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){await pool.query(await readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));await pool.query('INSERT INTO schema_migrations VALUES($1)',[f]);}
 const owner=randomUUID(),other=randomUUID(),pid='11902920274',token=randomUUID(),token2=randomUUID();
 for(const id of [owner,other])await pool.query("INSERT INTO users(id,email,password_hash,plan,verified_at) VALUES($1,$2,'unused','pro',now())",[id,id+'@example.invalid']);
 const request=(action,t=token,who=owner)=>collectionLease(pool,who,{action,pid,token:t});
 await request('start');await request('start');await assert.rejects(request('start',token2),e=>e.status===409);await request('start',randomUUID(),other);await request('renew');await request('stop');await assert.rejects(request('renew'),e=>e.status===409);await assert.rejects(request('start'),e=>e.status===409);await request('start',token2);await request('complete',token2);await assert.rejects(request('renew',token2),e=>e.status===409);
 const run=randomUUID();await pool.query("INSERT INTO saved_runs(id,user_id,idempotency_key,product,engine_version) VALUES($1,$2,$3,$4,'fixture')",[run,owner,randomUUID(),{pid,name:'测试衣服',site:{total_comment_num:79,total_auto_count:79,pageCount:0,collection_outcome:'defaults_only'}}]);
 assert.equal((await preview(owner,run)).public.noPublicComments,true);await assert.rejects(createJob(owner,run),e=>e.status===409);assert.equal(+(await pool.query('SELECT count(*) n FROM ai_jobs')).rows[0].n,0);
 const job=randomUUID(),unit=randomUUID();await pool.query("INSERT INTO ai_jobs(id,user_id,run_id,input_hash,config,config_hash,product,state) VALUES($1,$2,$3,'fixture',$4,'fixture',$5,'running')",[job,owner,run,aiConfig(),{pid}]);
 await pool.query("INSERT INTO ai_units(id,job_id,kind,input,state,display_phase) VALUES($1,$2,'review',$3,'running','model')",[unit,job,{comments:[],parts:[],images:[]}]);
 await pool.query("INSERT INTO ai_attempts(unit_id,provider_request) VALUES($1,true)",[unit]);
 for(let i=0;i<22;i++)await pool.query('INSERT INTO ai_images(job_id,id,url,bytes) VALUES($1,$2,$3,$4)',[job,'I'+i,'https://img.ddimg.cn/'+i,i<8?Buffer.from([0]):null]);
 const load=async()=>loadReportProgress(pool,(await pool.query('SELECT * FROM ai_jobs WHERE id=$1',[job])).rows[0]);
 for(let i=0;i<2;i++){const progress=await load();assert.equal(progress.phase,'model');assert.equal(progress.preparedImages,8);assert.equal(progress.totalImages,22);}
 assert.equal(+(await pool.query('SELECT count(*) n FROM ai_attempts')).rows[0].n,1,'Refresh cannot infer');
 await pool.query("UPDATE ai_units SET display_phase='persist' WHERE id=$1",[unit]);assert.equal((await load()).phase,'persist');
 await pool.query("UPDATE ai_jobs SET state='completed',report=$2 WHERE id=$1",[job,{schemaVersion:4,hasSynthesis:true,summary:'Fixture saved report'}]);assert.equal((await load()).phase,'completed');
 console.log('Disposable PostgreSQL checks passed: owner/product lease dedup, stop/no revival, empty-source AI job prevention, stored image counts/phase, read-only refresh and saved-report completion. No provider calls.');
}finally{await pool.end();}
