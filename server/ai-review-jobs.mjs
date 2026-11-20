import {randomUUID} from 'node:crypto';
import {coverage} from './ai-jobs.mjs';
import {budgetInput,reviewParts} from './ai-review.mjs';
export async function insertReviewUnits(c,jobId,chunks,kind='review') {
 for(const input of chunks){
  const id=randomUUID();await c.query('INSERT INTO ai_units(id,job_id,kind,input) VALUES($1,$2,$3,$4)',[id,jobId,kind,input]);
  for(const cid of new Set(reviewParts(input).map(p=>p.commentId))) await c.query('INSERT INTO ai_unit_comments(job_id,unit_id,comment_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[jobId,id,cid]);
 }
}
export async function finalizeReview(c,job) {
 const units=(await c.query('SELECT kind,state,input,result,error FROM ai_units WHERE job_id=$1 ORDER BY id',[job.id])).rows;
 const prep=units.find(u=>u.kind==='prepare'),reads=units.filter(u=>u.kind==='review'),final=units.find(u=>u.kind==='synthesis');
 const good=reads.filter(u=>u.state==='done');
 if(reads.length>1&&(!final||final.error==='stale_synthesis')&&good.length){
  // Final stage sees every validated intermediate result, citations and exact
  // source snippets. It never claims to reread photos. Nothing is truncated.
  const used=good.flatMap(u=>[u.result.verdict,...u.result.paragraphs,...u.result.imageText,...u.result.checks,...u.result.qualitySignals]).flatMap(p=>p.citations);
  const all=good.flatMap(u=>reviewParts(u.input));
  const parts=[...new Map(all.filter(p=>used.some(x=>x.kind==='comment'&&x.id===p.commentId)).map(p=>[p.commentId+':'+p.part,p])).values()];
  const images=[...new Map(good.flatMap(u=>u.input.images).filter(i=>used.some(x=>x.kind==='image'&&x.id===i.id)).map(i=>[i.id,{id:i.id,comments:i.comments}])).values()];
  const input={schemaVersion:2,mode:'synthesis',product:job.product,scope:prep.result.scope,parts,images,summaries:good.map(u=>u.result),unread:{failedStages:reads.length-good.length,images:prep.result.unread}};
  if(budgetInput(job.config,input).fits){if(final)await c.query("UPDATE ai_units SET input=$2,state='pending',error=NULL,next_at=now() WHERE job_id=$1 AND kind='synthesis'",[job.id,input]);else await insertReviewUnits(c,job.id,[input],'synthesis');return;}
  // Fail closed: no concatenation masquerading as a completed synthesis.
  if(!final) await c.query("INSERT INTO ai_units(id,job_id,kind,input,state,error) VALUES($1,$2,'synthesis',$3,'failed','context_budget_exceeded')",[randomUUID(),job.id,input]);
  units.push({kind:'synthesis',state:'failed'});
 }
 const reportResult=final?.state==='done'?final.result:reads.length===1&&good.length?good[0].result:null;
 const counts=await coverage(job.id,c);
 const quality=prep?.result?.quality||null;
 const repairSteps=(await c.query("SELECT a.usage->'repair' repair FROM ai_units u JOIN ai_attempts a ON a.unit_id=u.id WHERE u.job_id=$1 AND a.state='done' AND a.usage ? 'repair' ORDER BY a.id",[job.id])).rows.map(r=>r.repair);
 const executions=(await c.query("SELECT DISTINCT a.usage->'execution' execution FROM ai_units u JOIN ai_attempts a ON a.unit_id=u.id WHERE u.job_id=$1 AND a.state='done' AND a.usage ? 'execution'",[job.id])).rows.map(r=>r.execution);
 const timings=(await c.query(`SELECT u.kind,coalesce(sum(extract(epoch FROM (a.ended_at-a.started_at))*1000),0)::bigint::text ms FROM ai_units u JOIN ai_attempts a ON a.unit_id=u.id WHERE u.job_id=$1 GROUP BY u.kind`,[job.id])).rows;
 await c.query("UPDATE ai_jobs SET state='completed',report=$2,updated_at=now() WHERE id=$1",[job.id,{schemaVersion:2,...reportResult,findings:[],generatedAt:new Date().toISOString(),mock:job.config.provider==='mock',partial:!counts.complete||!reportResult,coverage:counts,quality,scope:prep?.result?.scope,unread:prep?.result?.unread||[],strategy:repairSteps.length?(repairSteps.every(s=>s.textOnly)?'图文合读后局部修订（修订使用既有图像观察，未重新读图）':'图文合读后局部复核（含重新读图的修订）'):reads.length>1?'分阶段阅读后综合写作':'一次图文合读',stages:reads.length,hasSynthesis:!!reportResult,repairSteps,snapshotPromptVersion:job.config.promptVersion,executions,timings,totalMs:Date.now()-new Date(job.created_at).getTime(),method:reads.length>1?'已校验阶段证据综合成文，非再次阅读原图。':'全部可读文本与去重图片在同一请求内对照。'}]);
}
