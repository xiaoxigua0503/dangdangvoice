import {randomUUID} from 'node:crypto';
import {coverage} from './ai-jobs.mjs';
export async function insertReviewUnits(c,jobId,chunks){
 for(const input of chunks){
  const id=randomUUID();await c.query("INSERT INTO ai_units(id,job_id,kind,input) VALUES($1,$2,'review',$3)",[id,jobId,input]);
  for(const comment of input.comments)await c.query('INSERT INTO ai_unit_comments(job_id,unit_id,comment_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[jobId,id,comment.id]);
 }
}
export async function finalizeReview(c,job){
 const units=(await c.query('SELECT kind,state,result,error FROM ai_units WHERE job_id=$1',[job.id])).rows;
 const prep=units.find(u=>u.kind==='prepare'),read=units.find(u=>u.kind==='review'&&u.state==='done');
 const result=read?.result||null,counts=await coverage(job.id,c);
 const attempts=(await c.query(`SELECT a.id,a.error,a.cached,a.provider_request,a.usage,round(extract(epoch FROM(a.ended_at-a.started_at))*1000)::bigint::text ms,u.kind FROM ai_attempts a JOIN ai_units u ON u.id=a.unit_id WHERE u.job_id=$1 ORDER BY a.id`,[job.id])).rows;
 const accepted=attempts.filter(a=>a.usage?.provider&&!a.error).at(-1)?.usage.provider;
 const timings=['prepare','review'].map(kind=>({kind,ms:String(attempts.filter(a=>a.kind===kind).reduce((n,a)=>n+Number(a.ms||0),0))}));
 const report={schemaVersion:4,...result,findings:[],hasSynthesis:!!result,generatedAt:new Date().toISOString(),mock:job.config.provider==='mock',partial:!!result&&(!counts.complete||result.visualStatus==='partial'),coverage:counts,scope:prep?.result?.scope,quality:prep?.result?.quality||null,qualityWarning:prep?.result?.qualityWarning||null,unread:prep?.result?.unread||[],blocked:prep?.result?.blocked||null,strategy:'一次完整图文合读；仅服务错误按配置重试或切换模型',stages:read?1:0,method:'全部评论、商品资料和成功下载的去重图片共同输入；不抽样，不使用生成式修复。',actualModel:accepted?.model||null,actualEndpointHost:accepted?.endpointHost||null,providerAttempts:attempts.filter(a=>a.provider_request||a.usage?.provider).map(a=>({attempt:a.id,model:a.usage?.provider?.model||null,endpointHost:a.usage?.provider?.endpointHost||null,fallbackReason:a.usage?.provider?.fallbackReason||null,error:a.error,httpStatus:a.usage?.providerError?.httpStatus,providerCode:a.usage?.providerError?.code,selection:a.usage?.modelSelection,skipped:a.usage?.provider?.skipped,cached:a.cached})),timings,totalMs:Date.now()-new Date(job.created_at).getTime()};
 await c.query('UPDATE ai_jobs SET state=$3,report=$2,updated_at=now() WHERE id=$1',[job.id,report,result?(report.partial?'partial':'completed'):'failed']);
}
