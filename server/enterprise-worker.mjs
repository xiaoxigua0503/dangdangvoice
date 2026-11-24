import {randomUUID} from 'node:crypto';
import {pool} from './db.mjs';
import {aiConfig,digest} from './ai-config.mjs';
import {modelIdentity} from './ai-model-runtime.mjs';
import {classifyProviderError,retryAfterMs} from './ai-models.mjs';
import {usageFrom} from './ai-provider.mjs';
import {enterpriseBrowserPath,collectEnterpriseBrowser,BUSINESS_ROUTES} from './enterprise-browser.mjs';
import {parseProduct,enterpriseServiceRequest} from './enterprise-product.mjs';
import {enterpriseEligible,ENTERPRISE_ENGINE,ENTERPRISE_PROTOCOL,enterpriseEnvelope,enterpriseBudget,validateEnterprise} from './enterprise-context.mjs';
const eligible="u.plan='enterprise' AND u.verified_at IS NOT NULL AND u.disabled_at IS NULL AND (u.pro_expires_at IS NULL OR u.pro_expires_at>now())";
export async function collectEnterprise(input,signal,fetcher=fetch){
 if(input.url!==`https://product.dangdang.com/${input.productId}.html`||!/^\d{5,20}$/.test(input.productId))throw new Error('invalid_product_url');
 if(fetcher===fetch){const executablePath=await enterpriseBrowserPath();if(executablePath)return collectEnterpriseBrowser(input,signal,executablePath);}
 const r=await fetcher(input.url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),headers:{'user-agent':'Mozilla/5.0 DangdangVoice public product research','accept-language':'zh-CN,zh;q=0.9'}});
 if(!r.ok){await r.body?.cancel();throw Object.assign(new Error(r.status===429?'rate_limited':r.status===403?'access_denied':'upstream_error'),{retryAfter:retryAfterMs(r.headers.get('retry-after'))||0,httpStatus:r.status});}
 const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>2000000)throw new Error('response_too_large');chunks.push(x.value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks),header=r.headers.get('content-type')||'',charset=/charset=\s*utf-8/i.test(header)||/<meta[^>]+charset\s*=\s*["']?utf-8/i.test(bytes.subarray(0,8192).toString('latin1'))?'utf-8':'gb18030';
 const html=new TextDecoder(charset).decode(bytes);let parsed=parseProduct(html,input);const diagnostics={stage:'product_document',outcome:parsed.outcome,code:parsed.error||null,recognitionRule:parsed.recognitionRule||null,httpStatus:r.status,contentType:header.slice(0,120),responseBytes:size,collectedAt:new Date().toISOString(),sourceUrl:input.url,dynamicSources:'only_score_service_http_verified',transport:fetcher===fetch?'http':'test_transport',...(fetcher===fetch?{browserStatus:'browser_not_configured'}:{})};
 if(!parsed.ok)throw Object.assign(new Error(parsed.error),{outcome:parsed.outcome,httpStatus:r.status,collectionDiagnostics:diagnostics});
 const sourceResponses=[];const sourceUrl=enterpriseServiceRequest(html,input.productId);
 if(sourceUrl){
  const source={url:sourceUrl,status:'network_error',collectedAt:new Date().toISOString()};
  try{
   signal.throwIfAborted();const response=await fetcher(sourceUrl,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{'user-agent':'Mozilla/5.0 DangdangVoice public product research','accept-language':'zh-CN,zh;q=0.9'}});
   source.httpStatus=response.status;source.contentType=(response.headers.get('content-type')||'').slice(0,120);
   if(!response.ok){source.status=response.status===429?'rate_limited':response.status===403?'access_denied':'upstream_error';await response.body?.cancel();}
   else{const reader=response.body.getReader(),parts=[];let length=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>100000)throw new Error('response_too_large');parts.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});}source.responseBytes=length;const text=Buffer.concat(parts).toString('utf8');try{source.body=JSON.parse(text);source.status='observed';}catch{const check=parseProduct(text,input);source.status=check.error==='challenge_detected'?'challenge_detected':check.error==='region_restricted'?'region_restricted':check.error==='access_denied'?'access_denied':'unsupported_response';}}
  }catch(e){if(signal.aborted)throw e;source.status=e.name==='TimeoutError'?'timeout':e.message==='response_too_large'?'response_too_large':'network_error';}
  sourceResponses.push(source);parsed=parseProduct(html,{...input,sourceResponses});
 }
 if(fetcher===fetch){parsed=parseProduct(html,{...input,sourceResponses,expectedRoutes:BUSINESS_ROUTES});parsed.outcome='partial';diagnostics.browserStatus='browser_not_configured';diagnostics.transport='http';diagnostics.code='browser_not_configured';}
 signal.throwIfAborted();parsed.data.collectionDiagnostics=diagnostics;return parsed;
}
async function boundedJSON(r,limit){const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>limit)throw new Error('provider_output_too_large');chunks.push(x.value);}}finally{await reader.cancel().catch(()=>{});}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export async function inferEnterprise(config,input,kind,signal,fetcher=fetch){
 const budget=enterpriseBudget(config,input,kind);if(!budget.fits)throw new Error(budget.reason);
 if(config.provider==='mock'){if(process.env.NODE_ENV==='production')throw new Error('mock_disabled');const c={topic:'coverage',text:'这是本地流程演示，未验证真实模型分析。',sourceIds:[],statIds:['T.readListings']};return {result:kind==='chat'?{text:'本地 DiDi 演示。',claims:[c]}:{sections:[{heading:'资料核验',claims:[c]}],checks:[]},usage:{mock:true}};}
 const key=process.env[config.keyEnv||'AI_API_KEY'];if(!key)throw new Error('provider_not_configured');
 const r=await fetcher(config.endpoint+'/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(enterpriseEnvelope(config,input,kind))});
 if(!r.ok){let data;try{data=await boundedJSON(r,16384);}catch{}const raw=data?.error?.code||data?.code,code=typeof raw==='string'&&/^[\w.-]{1,100}$/.test(raw)?raw:'',classification=classifyProviderError(r.status,code);throw Object.assign(new Error('provider_http_error'),{httpStatus:r.status,providerCode: code || null,fallbackReason:classification.fallbackReason,retryable:classification.retryable,retryAfter:retryAfterMs(r.headers.get('retry-after'))||0});}
 const body=await boundedJSON(r,2000000),usage=usageFrom(body.usage);if(body.choices?.[0]?.finish_reason!=='stop')throw Object.assign(new Error('provider_output_incomplete'),{usage});try{return {result:JSON.parse(body.choices[0].message.content),usage};}catch{throw Object.assign(new Error('invalid_structure'),{usage});}
}
async function select(c,task){
 const current=aiConfig(),allow=new Map(current.models.map(m=>[modelIdentity(m),m]));
 for(let index=task.model_cursor;index<task.config.models.length;index++){const p=task.config.models[index],key=modelIdentity(p),active=allow.get(key);if(!active){if(index===0)break;continue;}if((await c.query('SELECT 1 FROM enterprise_model_cooldowns WHERE model_key=$1 AND until_at>now()',[key])).rowCount)continue;if((task.config.freeQuotaOnly||current.freeQuotaOnly)&&!active.freeTierStopConfirmed)continue;if(task.config.provider!=='mock'&&!process.env[p.keyEnv])continue;const config={...task.config,...p,limits:active.limits,requestOptions:active.requestOptions};const budget=enterpriseBudget(config,task.input,task.kind);if(!budget.fits)throw new Error(budget.reason);return {config,index,key};}
 throw new Error('provider_models_unavailable');
}
export async function runEnterpriseOne({role,allowModels=true,signal,collectFn=collectEnterprise,inferFn=inferEnterprise,db=pool}={}){
 if(process.env.AI_WORKER_JOB_ID||signal?.aborted)return false;const c=await db.connect();let task,attempt=null,selection,stage='claim',taskUsage=null,heartbeat,controller=new AbortController(),aborted=()=>controller.abort();signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();
 const renew=async()=>{if(!task)return false;const r=await db.query(`UPDATE enterprise_tasks t SET lease_until=now()+interval '30 seconds' FROM users u WHERE t.id=$1 AND t.lease_token=$2 AND t.state='running' AND t.lease_until>now() AND u.id=t.user_id AND ${eligible} RETURNING t.id`,[task.id,task.lease_token]);if(!r.rowCount)controller.abort();return !!r.rowCount;};
 try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(17064,1)');
  await c.query("UPDATE enterprise_tasks SET state='failed',error='enterprise_version_changed',updated_at=now() WHERE kind='report' AND state='pending' AND (config->>'enterpriseEngine' IS DISTINCT FROM $1 OR config->>'enterpriseProtocol' IS DISTINCT FROM $2)",[ENTERPRISE_ENGINE,ENTERPRISE_PROTOCOL]);
  const expired=(await c.query("UPDATE enterprise_tasks SET state='failed',error='worker_interrupted',updated_at=now() WHERE state='running' AND lease_until<now() RETURNING listing_id,kind")).rows;for(const e of expired)if(e.kind==='collect')await c.query("UPDATE enterprise_listings SET state='failed',error='worker_interrupted',next_at=now()+interval '20 seconds' WHERE id=$1 AND state='running'",[e.listing_id]);
  await c.query(`UPDATE enterprise_tasks t SET state='cancelled',error='access_revoked',updated_at=now() FROM users u WHERE u.id=t.user_id AND t.state IN ('pending','running') AND NOT (${eligible})`);
  await c.query("UPDATE enterprise_listings l SET state='cancelled',error='access_revoked' FROM users u WHERE l.user_id=u.id AND l.state IN ('pending','running') AND NOT ("+eligible+")");
  await c.query("UPDATE enterprise_attempts a SET ended_at=now(),error='worker_interrupted' FROM enterprise_tasks t WHERE a.task_id=t.id AND a.ended_at IS NULL AND t.state IN ('failed','cancelled')");
  const reportBatch=role==='report'?process.env.ENTERPRISE_WORKER_BATCH_ID:null;if(reportBatch&&!/^[0-9a-f-]{36}$/i.test(reportBatch))throw new Error('invalid_enterprise_worker_scope');
  const kinds=reportBatch?(allowModels?['report']:[]):role==='chat'?(allowModels?['chat']:[]):['collect',...(allowModels?['report']:[])];
  task=(await c.query(`SELECT t.* FROM enterprise_tasks t JOIN users u ON u.id=t.user_id WHERE t.state='pending' AND t.next_at<=now() AND t.kind=ANY($1::text[]) AND t.config->>'enterpriseProtocol'=$2 AND t.config->>'enterpriseEngine'=$3 AND t.config->>'provider'=$4 AND ($5::uuid IS NULL OR t.batch_id=$5::uuid) AND ${eligible} AND NOT EXISTS(SELECT 1 FROM enterprise_tasks active WHERE active.user_id=t.user_id AND active.state='running') ORDER BY t.created_at,t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1`,[kinds,ENTERPRISE_PROTOCOL,ENTERPRISE_ENGINE,process.env.AI_PROVIDER||'qwen',reportBatch||null])).rows[0];
  if(!task){await c.query('COMMIT');return false;}
  const runtime=(await c.query('SELECT global_concurrency,user_concurrency FROM ai_runtime WHERE singleton')).rows[0];let slot=false;const limit=task.kind==='collect'?task.config.collectionConcurrency:runtime.global_concurrency;
  for(let i=0;i<limit;i++)if((await c.query('SELECT pg_try_advisory_lock($1,$2) ok',[task.kind==='collect'?17063:17061,i])).rows[0].ok){slot=true;break;}
  if(!slot){await c.query('COMMIT');return false;}
  if(!(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok',['owner:'+task.user_id+':0'])).rows[0].ok){await c.query('COMMIT');return false;}
  task.lease_token=randomUUID();await c.query("UPDATE enterprise_tasks SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1",[task.id,task.lease_token]);task.attempts++;
  if(task.kind==='collect')await c.query("UPDATE enterprise_listings SET state='running',attempts=attempts+1,updated_at=now() WHERE id=$1",[task.listing_id]);await c.query('COMMIT');
  let renewing=false;heartbeat=setInterval(()=>{if(renewing)return;renewing=true;void renew().catch(()=>controller.abort()).finally(()=>{renewing=false;});},2000);
  if(!await renew())throw new Error('cancelled');controller.signal.throwIfAborted();let result,usage={};
  if(task.kind==='collect')result=await collectFn(task.input,controller.signal);
  else{
   if(task.provider_requests>=task.config.maxProviderRequests||task.attempts>task.config.maxAttempts)throw new Error('request_budget');selection=await select(c,task);if(!await renew())throw new Error('cancelled');controller.signal.throwIfAborted();
   attempt=(await c.query('INSERT INTO enterprise_attempts(task_id,model,endpoint_host) VALUES($1,$2,$3) RETURNING id',[task.id,selection.config.model,new URL(selection.config.endpoint).hostname])).rows[0].id;
   const dispatch=await c.query("UPDATE enterprise_tasks SET provider_requests=provider_requests+1,actual_model=$3 WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id",[task.id,task.lease_token,selection.config.model]);if(!dispatch.rowCount)throw new Error('cancelled');task.provider_requests++;
   stage='provider';controller.signal.throwIfAborted();const response=await inferFn(selection.config,task.input,task.kind,controller.signal);usage=response.usage;taskUsage=usage;
   if(task.kind==='chat'){await c.query('UPDATE enterprise_attempts SET usage=$2,ended_at=now() WHERE id=$1',[attempt,usage]);attempt=null;}
   stage='validation';result=validateEnterprise(response.result,task.input.snapshot,task.kind);if(attempt){await c.query('UPDATE enterprise_attempts SET usage=$2,ended_at=now() WHERE id=$1',[attempt,usage]);attempt=null;}usage={...usage,mock:task.config.provider==='mock',historyScope:task.input.historyScope||null};
  }
  controller.signal.throwIfAborted();await c.query('BEGIN');const u=(await c.query('SELECT * FROM users WHERE id=$1 FOR SHARE',[task.user_id])).rows[0];if(!enterpriseEligible(u)||!await renew())throw new Error('cancelled');
  const committed=await c.query("UPDATE enterprise_tasks SET state='completed',result=$3,usage=$4,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id",[task.id,task.lease_token,result,usage]);
  if(committed.rowCount&&task.kind==='collect')await c.query('UPDATE enterprise_listings SET state=$2,data=$3,error=NULL,updated_at=now() WHERE id=$1',[task.listing_id,result.outcome,result.data]);await c.query('COMMIT');return true;
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});if(!task?.lease_token)throw error;
  const safe=['challenge_detected','region_restricted','access_denied','rate_limited','upstream_error','upstream_http_error','product_identity_mismatch','product_schema_unrecognized','response_too_large','invalid_product_url','enterprise_context_budget','provider_models_unavailable','provider_output_incomplete','invalid_structure','invalid_reference','invalid_listing_reference','incomplete_competitor_mapping','missing_field_reference','missing_observed_evidence','missing_reference','numeric_narrative_not_allowed','request_budget','provider_http_error','model_limits_unverified','enterprise_version_changed'];
  const cancelled=controller.signal.aborted||error.message==='cancelled',code=cancelled?'cancelled':safe.includes(error.message)?error.message:error.name==='TimeoutError'?'timeout':task.kind==='collect'?'network_or_parse_error':'answer_failed';
  if (task.kind !== 'collect' && !cancelled) {
  console.warn('enterprise_task_failed', {
    taskId: task.id,
    kind: task.kind,
    model: selection?.config?.model ?? null,
    code,
    step:stage,
    fieldPath: typeof error.fieldPath==='string'&&/^[a-zA-Z0-9_.\[\]]{1,160}$/.test(error.fieldPath)?error.fieldPath:error.issues?.[0]?.path?.map(x=>String(x)).join('.')||null,
    httpStatus: error.httpStatus ?? null,
    providerCode: error.providerCode ?? null,
    errorName: error.name ?? null,
    networkCode: /^[A-Z0-9_]{1,60}$/.test(error.cause?.code ?? '')
      ? error.cause.code
      : null,
  });
}
  if(attempt)await c.query('UPDATE enterprise_attempts SET ended_at=now(),error=$2,usage=$3 WHERE id=$1',[attempt,code,error.usage||taskUsage||{}]);
  let retry=false,next=20000;
  if(!cancelled&&task.kind!=='collect'&&selection&&task.provider_requests<task.config.maxProviderRequests&&task.attempts<task.config.maxAttempts){
   if(error.fallbackReason){await c.query("INSERT INTO enterprise_model_cooldowns(model_key,until_at,reason) VALUES($1,now()+($2*interval '1 millisecond'),$3) ON CONFLICT(model_key) DO UPDATE SET until_at=excluded.until_at,reason=excluded.reason",[selection.key,task.config.modelCooldownMs,error.fallbackReason]);task.model_cursor=selection.index+1;retry=task.model_cursor<task.config.models.length;next=1000;}
   else if(error.retryable&&error.httpStatus&&(error.retryAfter||0)<=task.config.maxRetryAfterMs){retry=true;next=Math.max(20000*2**(task.attempts-1),error.retryAfter||0);}
  }
  const failureCommit=await c.query("UPDATE enterprise_tasks SET state=$3,error=$4,model_cursor=$5,next_at=now()+($6*interval '1 millisecond'),lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id",[task.id,task.lease_token,cancelled?'cancelled':retry?'pending':'failed',code,task.model_cursor,next]);
  if(task.kind==='report'&&failureCommit.rowCount)await c.query('UPDATE enterprise_tasks SET usage=$2 WHERE id=$1',[task.id,{...(taskUsage||error.usage||{}),diagnostic:{step:stage,code,fieldPath:error.fieldPath||error.issues?.[0]?.path?.join('.')||null}}]);
  if(task.kind==='collect'&&failureCommit.rowCount&&error.collectionDiagnostics)await c.query('UPDATE enterprise_tasks SET result=$2 WHERE id=$1',[task.id,{collectionDiagnostics:error.collectionDiagnostics}]);
  if(task.kind==='collect'&&failureCommit.rowCount){const paused=['challenge_detected','region_restricted','access_denied'].includes(code);await c.query("UPDATE enterprise_listings SET state=$2,error=$3,next_at=now()+(greatest(least(120000,20000*power(2,least(attempts-1,3))),$4)*interval '1 millisecond'),updated_at=now() WHERE id=$1 AND state='running'",[task.listing_id,cancelled?'cancelled':paused?'paused':'failed',code,error.retryAfter||0]);}
  return true;
 }finally{clearInterval(heartbeat);signal?.removeEventListener('abort',aborted);await c.query('SELECT pg_advisory_unlock_all()').catch(()=>{});c.release();}
}
