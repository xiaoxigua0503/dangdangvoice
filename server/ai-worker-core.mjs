import {AI_ENGINE_VERSION} from './ai-engine-version.mjs';
import {advertiseWorker,supportsUnit,WORKER_CAPABILITIES} from './ai-pipeline.mjs';
import {prepareReview,reviewImages} from './ai-review-prepare.mjs';
import {validateReview,REVIEW_PROMPT} from './ai-review.mjs';
import {selectModel,recordFallback} from './ai-model-runtime.mjs';
import {insertReviewUnits} from './ai-review-jobs.mjs';
import {randomUUID} from 'node:crypto';
import {pool} from './db.mjs';
import {digest,PROMPT_VERSION} from './ai-config.mjs';
import {infer,usageFrom} from './ai-provider.mjs';
import {downloadImage} from './ai-images.mjs';
import {finalize} from './ai-jobs.mjs';
const safeErrors = new Set([
  "provider_request_budget",
  "provider_model_unavailable",
  "provider_models_unavailable",
  "model_limits_unverified",
  "context_budget_exceeded",
  "context_budget_unconfirmed",
  "invalid_structure",
  "invalid_reference",
  "provider_not_configured",
  "provider_rate_limit",
  "provider_auth_failed",
  "provider_http_error",
  "provider_output_too_large",
  "invalid_provider_json",
  "provider_output_incomplete",
  "invalid_image_url",
  "unsupported_image_host",
  "unsafe_image_address",
  "image_size_limit",
  "image_pixel_limit",
  "unsupported_image_format",
  "invalid_image_content",
  "image_redirect_limit",
  "image_not_found",
  "image_unavailable",
  "image_download_error",
  "total_image_budget",
]);
function networkErrors(e,depth=0) {
  if(!e||depth>3)return undefined;
  const code=typeof e.code==='string'&&/^[A-Z0-9_]{1,70}$/.test(e.code)?e.code:undefined;
  return {name:['Error','TypeError','AggregateError','AbortError','TimeoutError'].includes(e.name)?e.name:undefined,code,cause:networkErrors(e.cause,depth+1),errors:Array.isArray(e.errors)?e.errors.slice(0,6).map(x=>networkErrors(x,depth+1)):undefined};
}
async function tryLock(c, key) {
  return (
    await c.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok", [
      key,
    ])
  ).rows[0].ok;
}
export async function claim(c, provider = process.env.AI_PROVIDER || "qwen") {
  const runtime = (await c.query("SELECT * FROM ai_runtime WHERE singleton"))
    .rows[0];
  let slot = false;
  for (let i = 0; i < runtime.global_concurrency; i++) {
    if (
      (await c.query("SELECT pg_try_advisory_lock(17061,$1) ok", [i])).rows[0]
        .ok
    ) {
      slot = true;
      break;
    }
  }
  if (!slot) return null;
  await c.query("BEGIN");
  try {
    await advertiseWorker(c);
    const candidates = (
      await c.query(
        `SELECT w.*,j.user_id,j.config,j.config_hash,j.model_cursor FROM ai_units w JOIN ai_jobs j ON j.id=w.job_id JOIN users a ON a.id=j.user_id WHERE ($3::uuid IS NULL OR j.id=$3::uuid) AND EXISTS (SELECT 1 FROM jsonb_each($4::jsonb) cap WHERE cap.key=coalesce(j.config->>'pipelineVersion',CASE j.config->>'schemaVersion' WHEN '1' THEN 'evidence-v1' WHEN '2' THEN 'product-review-v2' WHEN '3' THEN 'product-review-v3' WHEN '4' THEN 'product-summary-v4' END) AND cap.value->>'schema'=j.config->>'schemaVersion' AND (j.config->>'executorVersion' IS NULL OR cap.value->>'engineVersion'=j.config->>'executorVersion') AND (cap.value->'kinds') ? w.kind) AND a.plan='pro' AND a.disabled_at IS NULL AND (a.pro_expires_at IS NULL OR a.pro_expires_at>now()) AND a.verified_at IS NOT NULL AND j.config->>'provider'=$2 AND j.state IN ('queued','running') AND ((w.state='pending' AND w.next_at<=now()) OR (w.state='running' AND w.lease_until<now())) AND (w.state='running' OR (SELECT count(*) FROM ai_units active JOIN ai_jobs ownerjob ON ownerjob.id=active.job_id WHERE ownerjob.user_id=j.user_id AND active.state='running' AND active.lease_until>now())<$1) ORDER BY w.next_at,w.id FOR UPDATE OF w SKIP LOCKED LIMIT 32`,
        [runtime.user_concurrency, provider, process.env.AI_WORKER_JOB_ID || null, JSON.stringify(WORKER_CAPABILITIES)],
      )
    ).rows;
    for (const unit of candidates) {
      if (!supportsUnit(unit.config,unit.kind)) continue;
      if (!(await tryLock(c, "unit:" + unit.id))) continue;
      let ownerSlot = false;
      for (let i = 0; i < runtime.user_concurrency; i++) {
        if (await tryLock(c, `owner:${unit.user_id}:${i}`)) {
          ownerSlot = true;
          break;
        }
      }
      if (!ownerSlot) {
        await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          "unit:" + unit.id,
        ]);
        continue;
      }
      if (unit.state === "running")
        await c.query(
          "UPDATE ai_attempts SET state='interrupted',ended_at=now(),error='worker_interrupted' WHERE unit_id=$1 AND ended_at IS NULL",
          [unit.id],
        );
      if (unit.attempts >= unit.config.maxAttempts) {
        await c.query(
          "UPDATE ai_units SET state='failed',error='retry_exhausted',lease_token=NULL WHERE id=$1",
          [unit.id],
        );
        await finalize(c, unit.job_id);
        await c.query("COMMIT");
        return { exhausted: true };
      }
      unit.leaseToken = randomUUID();
      await c.query(
        "UPDATE ai_units SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+($3*interval '1 millisecond') WHERE id=$1",
        [unit.id, unit.leaseToken, unit.config.timeoutMs + 60000],
      );
      await c.query(
        "UPDATE ai_jobs SET state='running',updated_at=now() WHERE id=$1",
        [unit.job_id],
      );
      unit.attemptId = (
        await c.query(
          "INSERT INTO ai_attempts(unit_id) VALUES($1) RETURNING id",
          [unit.id],
        )
      ).rows[0].id;
      await c.query("COMMIT");
      return unit;
    }
    await c.query("COMMIT");
    return null;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
export async function runOne({
  inferFn = infer,
  downloadFn = downloadImage,
  signal = new AbortController().signal,
  retryBaseMs = 5000,
} = {}) {
  const c = await pool.connect();
  let unit,
    heartbeat,
    usage = {},
    cacheHit = false, stage = "claim", rejectedValidation=null, selection=null;
  const phaseMs={};let phaseAt=Date.now();
  const markStage=name=>{phaseMs[stage]=(phaseMs[stage]||0)+Date.now()-phaseAt;phaseAt=Date.now();stage=name;};
  const log = (event, extra = {}) => console.log("ai_unit " + JSON.stringify({at:new Date().toISOString(),event, job:unit?.job_id, unit:unit?.id, kind:unit?.kind, stage, ...extra}));
  const control = new AbortController();
  const abort = () => control.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) control.abort();
  const disconnected = () => control.abort();
  c.on("error", disconnected);
  try {
    unit = await claim(c);
    if (!unit) return false;
    if (unit.exhausted) return true;
    log("claimed", {attempt:unit.attempts+1});
    heartbeat = setInterval(() => {
      void c
        .query(
          `UPDATE ai_units w SET lease_until=now()+($3*interval '1 millisecond') FROM ai_jobs j JOIN users a ON a.id=j.user_id WHERE w.id=$1 AND w.lease_token=$2 AND w.state='running' AND w.job_id=j.id AND j.state='running' AND a.plan='pro' AND a.disabled_at IS NULL AND (a.pro_expires_at IS NULL OR a.pro_expires_at>now()) AND a.verified_at IS NOT NULL RETURNING w.id`,
          [unit.id, unit.leaseToken, unit.config.timeoutMs + 60000],
        )
        .then((r) => {
          if (!r.rowCount) control.abort();
        })
        .catch(() => control.abort());
    }, 2000);
    const workSignal = AbortSignal.any([
      control.signal,
      AbortSignal.timeout(unit.config.timeoutMs + 20000),
    ]);
    markStage("image_download");
    const image=unit.kind==='prepare'?[]:await reviewImages(c,unit);
    markStage('cache');
    if(unit.kind!=='prepare'){
      selection=await selectModel(c,unit,image);
      const previous=(await c.query("SELECT a.usage->'providerError'->>'fallbackReason' reason FROM ai_attempts a JOIN ai_units u ON u.id=a.unit_id WHERE u.job_id=$1 AND a.usage->'providerError'->>'fallbackReason' IS NOT NULL ORDER BY a.id DESC LIMIT 1",[unit.job_id])).rows[0];
      usage.provider={model:selection.config.model,endpointHost:new URL(selection.config.endpoint).hostname,endpointHash:digest(selection.config.endpoint),index:selection.index,fallbackReason:selection.skipped.at(-1)?.reason||(selection.index>0?previous?.reason:null),skipped:selection.skipped};
    }
    const cacheKey=digest({config:unit.config_hash,engineVersion:AI_ENGINE_VERSION,prompt:digest(REVIEW_PROMPT),profile:selection?.cacheProfile||null,input:unit.input,image:image.map(i=>({id:i.id,hash:i.hash}))});
    await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      "cache:" + unit.job_id + ":" + cacheKey,
    ]);
    const cached = (
      await c.query(
        "SELECT result FROM ai_cache WHERE user_id=$1 AND job_id=$2 AND key=$3",
        [unit.user_id, unit.job_id, cacheKey],
      )
    ).rows[0];
    let result;
    if(unit.kind==="prepare") {
      markStage("image_download_and_plan");result=await prepareReview(unit,downloadFn,workSignal);
    } else if (cached) {
      cacheHit = true;
      result=validateReview(cached.result,unit.input);
    } else {
      markStage('provider');
      // One HTTP call per durable attempt. No in-request fallback/repair loop.
      const bodyBudget=selection.config;
      log('provider_started',{model:bodyBudget.model,images:image.length,mode:'full_multimodal'});
      await reserveProviderRequest(c,unit,selection,usage);
      const response=await inferFn(bodyBudget,unit.input,image,workSignal);
      usage={...usage,...response.usage,delivered:{comments:unit.input.comments.length,images:image.length}};
      markStage('validation');
      try{result=validateReview(response.result,unit.input);}
      catch(e){rejectedValidation={issues:e.validationIssues||[{code:e.message}],draft:response.result,promptVersion:PROMPT_VERSION};throw e;}
    }
    if (control.signal.aborted) throw new Error("aborted");
    markStage("persist");
    usage={...usage,phaseMs,execution:{engineVersion:AI_ENGINE_VERSION,promptVersion:unit.config.schemaVersion>=2?PROMPT_VERSION:unit.config.promptVersion,schemaVersion:unit.config.schemaVersion,pipelineVersion:unit.config.pipelineVersion}};
    await c.query("BEGIN");
    const owned = (
      await c.query(
        "SELECT j.id FROM ai_jobs j JOIN users a ON a.id=j.user_id WHERE j.id=$1 AND j.state='running' AND a.plan='pro' AND a.disabled_at IS NULL AND (a.pro_expires_at IS NULL OR a.pro_expires_at>now()) FOR UPDATE OF j",
        [unit.job_id],
      )
    ).rows[0];
    if (!owned) throw new Error("aborted");
    const committed = await c.query(
      "UPDATE ai_units SET state='done',result=$3,error=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='running' RETURNING id",
      [unit.id, unit.leaseToken, result],
    );
    if (committed.rowCount) {
      if(unit.kind==="prepare") await insertReviewUnits(c,unit.job_id,result.chunks);
      await c.query(
        "INSERT INTO ai_cache(user_id,job_id,key,result,usage) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [unit.user_id, unit.job_id, cacheKey, result, usage],
      );
      await c.query(
        "UPDATE ai_attempts SET state='done',ended_at=now(),usage=$2,cached=$3 WHERE id=$1",
        [unit.attemptId, usage, cacheHit],
      );
      await finalize(c, unit.job_id);
    }
    await c.query("COMMIT");
    markStage("complete");
    log("completed", {cached:cacheHit,phaseMs});
    return true;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    if (!unit?.id) throw e;
    if (e.providerUsage) usage = {...usage,...usageFrom(e.providerUsage)};
    if(e.modelSelection)usage.modelSelection=e.modelSelection;
    if(e.httpStatus)usage.providerError={httpStatus:e.httpStatus,code:e.providerCode||null,fallbackReason:e.fallbackReason||null,retryAfterMs:e.retryAfterMs??null};
    if(e.providerDiagnostic)rejectedValidation={issues:[{code:e.message,path:"provider"}],providerDiagnostic:e.providerDiagnostic,promptVersion:PROMPT_VERSION};
    const code = safeErrors.has(e.message) || /^(?:provider_http_\d{3}|provider_timeout|provider_network_error|provider_quota_exhausted|image_http_\d{3}|image_timeout)$/.test(e.message)
      ? e.message
      : control.signal.aborted
        ? "interrupted"
        : e.message === "aborted" ||
            ["AbortError", "TimeoutError"].includes(e.name)
          ? "request_timeout"
          : "worker_error";
    markStage("failed");usage={...usage,phaseMs,execution:{engineVersion:AI_ENGINE_VERSION,promptVersion:unit.config.schemaVersion>=2?PROMPT_VERSION:unit.config.promptVersion,schemaVersion:unit.config.schemaVersion,pipelineVersion:unit.config.pipelineVersion}};
    log("failed", {code, phaseMs, httpStatus:e.httpStatus, network:networkErrors(e)});
    const permanent =
      e.permanent ||
      ["provider_auth_failed", "provider_not_configured", "model_limits_unverified", "context_budget_exceeded", "context_budget_unconfirmed"].includes(code);
    await c.query("BEGIN");
    try {
      const live = (
        await c.query("SELECT state,provider_requests FROM ai_jobs WHERE id=$1 FOR UPDATE", [
          unit.job_id,
        ])
      ).rows[0];
      if (live) {
        const leased=(await c.query("SELECT 1 FROM ai_units WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE",[unit.id,unit.leaseToken])).rowCount>0;
        const fallback=leased&&live.state!=='cancelled'?await recordFallback(c,unit,selection,e):false;
        const state =
          live.state === "cancelled"
            ? "cancelled"
            : (permanent&&!fallback) || live.provider_requests>=(unit.config.maxProviderRequests||3) || unit.attempts + 1 >= Math.min(unit.config.maxAttempts,unit.config.maxProviderRequests||3)
              ? "failed"
              : "pending";
        await c.query(
          "UPDATE ai_units SET state=$3,error=$4,lease_token=NULL,lease_until=NULL,next_at=now()+($5*interval '1 millisecond') WHERE id=$1 AND lease_token=$2 AND state='running'",
          [
            unit.id,
            unit.leaseToken,
            state,
            code,
            fallback?0:Math.max(e.retryAfterMs||0,Math.min(120000,retryBaseMs*2**unit.attempts)),
          ],
        );
        await c.query(
          "UPDATE ai_attempts SET state=$2,ended_at=now(),error=$3,usage=$4,validation=$5 WHERE id=$1",
          [unit.attemptId, state, code, usage, rejectedValidation],
        );
        await finalize(c, unit.job_id);
      }
      await c.query("COMMIT");
      return true;
    } catch (f) {
      await c.query("ROLLBACK");
      throw f;
    }
  } finally {
    clearInterval(heartbeat);
    signal.removeEventListener("abort", abort);
    c.removeListener("error", disconnected);
    await c.query("SELECT pg_advisory_unlock_all()").catch(() => {});
    c.release();
  }
}

// Reserve durably before HTTP, including network failures and fallback. The job
// lock serializes parallel stages. Crashes cannot refund a possibly sent request.
async function reserveProviderRequest(c,unit,selection,usage){
 await c.query('BEGIN');
 try{
  const job=(await c.query(`SELECT j.provider_requests FROM ai_jobs j JOIN users a ON a.id=j.user_id WHERE j.id=$1 AND j.state='running' AND a.plan='pro' AND a.disabled_at IS NULL AND a.verified_at IS NOT NULL AND (a.pro_expires_at IS NULL OR a.pro_expires_at>now()) AND EXISTS(SELECT 1 FROM ai_units w WHERE w.id=$2 AND w.job_id=j.id AND w.lease_token=$3 AND w.state='running') FOR UPDATE OF j`,[unit.job_id,unit.id,unit.leaseToken])).rows[0];
  if(!job)throw new Error('aborted');
  if(job.provider_requests>=(unit.config.maxProviderRequests||3))throw Object.assign(new Error('provider_request_budget'),{permanent:true});
  await c.query('UPDATE ai_jobs SET provider_requests=provider_requests+1,model_cursor=$2 WHERE id=$1',[unit.job_id,selection.index]);
  await c.query('UPDATE ai_attempts SET provider_request=true,usage=$2 WHERE id=$1',[unit.attemptId,usage]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}
}
