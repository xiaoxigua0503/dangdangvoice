export function hasReadableReport(report){return !!report&&report.hasSynthesis!==false&&!report.empty&&(report.schemaVersion===4?!!report.summary?.trim():!!report.verdict?.text?.trim()&&!!report.paragraphs?.some(p=>p.text?.trim()));}
export function reportProgress(job,units,times,images,now=new Date()){
 const terminal=['completed','partial','failed','cancelled'].includes(job.state);
 const valid=hasReadableReport(job.report);
 let state=job.state==='completed'&&!valid?'failed':job.state==='completed'&&(job.report?.partial||job.report?.coverage?.complete===false)?'partial':job.state;
 const current=units.find(u=>u.state==='running'),pending=units.find(u=>u.state==='pending');
 const retry=!current&&!!pending&&pending.attempts>0;
 const fallback=retry&&!!times.fallback_reason&&Number(job.model_cursor)>Number(times.previous_model_index??-1);
 const phase=terminal?(state==='completed'&&valid?'completed':state):retry?(fallback?'fallback':'retry'):current?(current.expired?'recovering':current.display_phase||(current.kind==='prepare'?'prepare':'processing')):'queued';
 return {phase,state,terminal,reportReadable:valid,preparedImages:images.downloaded,totalImages:images.total,createdAt:job.created_at,startedAt:times.started_at||null,finishedAt:terminal?job.updated_at:null,serverNow:now.toISOString(),retryAt:retry?pending.next_at:null,waitingForWorker:!terminal&&!current&&!times.started_at};
}
export async function loadReportProgress(c,job){
 const units=(await c.query("SELECT kind,state,attempts,next_at,(lease_until<now()) expired,display_phase FROM ai_units w WHERE job_id=$1 ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,next_at,id",[job.id])).rows;
 const times=(await c.query(`SELECT min(a.started_at) started_at,
 (SELECT a.usage->'providerError'->>'fallbackReason' FROM ai_attempts a JOIN ai_units u ON u.id=a.unit_id WHERE u.job_id=$1 ORDER BY a.id DESC LIMIT 1) fallback_reason,
 (SELECT a.usage->'provider'->>'index' FROM ai_attempts a JOIN ai_units u ON u.id=a.unit_id WHERE u.job_id=$1 ORDER BY a.id DESC LIMIT 1) previous_model_index
 FROM ai_attempts a JOIN ai_units u ON u.id=a.unit_id WHERE u.job_id=$1`,[job.id])).rows[0];
 const images=(await c.query('SELECT count(*)::int total,count(*) FILTER(WHERE bytes IS NOT NULL)::int downloaded FROM ai_images WHERE job_id=$1',[job.id])).rows[0];
 return reportProgress(job,units,times,images);
}
