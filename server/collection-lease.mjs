import {z} from 'zod';
const Input=z.object({action:z.enum(['start','renew','stop','complete']),pid:z.string().regex(/^\d{5,}$/),token:z.string().uuid()}).strict();
export async function collectionLease(c,owner,body){
 const b=Input.parse(body);
 if(b.action==='start'){
  const r=await c.query(`INSERT INTO collection_leases(user_id,pid,token,status,expires_at) VALUES($1,$2,$3,'active',now()+interval '60 seconds')
   ON CONFLICT(user_id,pid) DO UPDATE SET token=excluded.token,status='active',created_at=CASE WHEN collection_leases.token=excluded.token THEN collection_leases.created_at ELSE now() END,expires_at=excluded.expires_at
   WHERE (collection_leases.token<>excluded.token AND (collection_leases.status<>'active' OR collection_leases.expires_at<now()))
   OR (collection_leases.token=excluded.token AND collection_leases.status='active' AND collection_leases.expires_at>now() AND collection_leases.created_at>now()-interval '15 minutes') RETURNING pid`,[owner,b.pid,b.token]);
  if(!r.rowCount)throw Object.assign(new Error('这个商品已有采集任务，或本轮已达到时间上限'),{status:409});return {ok:true};
 }
 if(b.action==='renew'){
  const r=await c.query("UPDATE collection_leases SET expires_at=now()+interval '60 seconds' WHERE user_id=$1 AND pid=$2 AND token=$3 AND status='active' AND expires_at>now() AND created_at>now()-interval '15 minutes' RETURNING pid",[owner,b.pid,b.token]);
  if(!r.rowCount)throw Object.assign(new Error('本轮采集已停止、失去所有权或超时'),{status:409});return {ok:true};
 }
 await c.query("UPDATE collection_leases SET status=$4,expires_at=now() WHERE user_id=$1 AND pid=$2 AND token=$3",[owner,b.pid,b.token,b.action==='stop'?'stopped':'completed']);return {ok:true};
}
