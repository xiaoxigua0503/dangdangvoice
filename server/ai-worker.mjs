import {logProductionStatus} from "./production-status.mjs";
import { pool } from "./db.mjs";
import { runOne } from "./ai-worker-core.mjs";
import { aiConfig, numberEnv, providerReady } from "./ai-config.mjs";
if (!pool) throw new Error("DATABASE_URL is required");
const config = aiConfig();
logProductionStatus('worker');
// Startup readiness checks only; no unit is claimed and no model request is sent.
try {
 const schema=await pool.query("SELECT 1 FROM schema_migrations WHERE version='004_product_review.sql'");
 if(!schema.rowCount)throw new Error('migration_required');
 const identity=(await pool.query("SELECT current_database() db,current_schema() schema")).rows[0];
 const db=new URL(process.env.WORKER_DATABASE_URL||process.env.DATABASE_URL);
 console.log('AI worker：PostgreSQL 连接与迁移状态就绪');
 console.log('ai_worker_config '+JSON.stringify({pid:process.pid, environment:process.env.NODE_ENV||'development',databaseLocal:['127.0.0.1','localhost','[::1]'].includes(db.hostname),database:identity.db,schema:identity.schema,provider:config.provider,model:config.model,endpointHost:new URL(config.endpoint).hostname,jobScope:process.env.AI_WORKER_JOB_ID||null}));
} catch {
 await pool.end();throw new Error('AI worker 数据库未就绪，请检查生产直连地址与迁移');
}
if(process.env.AI_NETWORK_DIAGNOSTICS==='true'&&process.env.AI_NETWORK_DIAGNOSTIC_JOB_ID){const {networkDiagnostics}=await import('./ai-network-diagnostics.mjs');await networkDiagnostics(config,pool);}
const enabled=process.env.AI_WORKER_ENABLED==='true'||(process.env.NODE_ENV!=='production'&&process.env.AI_WORKER_ENABLED!=='false');
console.log("ai_worker_readiness "+JSON.stringify({enabled,providerReady:providerReady(config)}));
if(!enabled)console.log('AI worker 推理已暂停：需要显式 AI_WORKER_ENABLED=true 才能领取模型任务');
if (!providerReady(config)) console.log('AI worker 等待配置：缺少 AI_API_KEY，不领取任务、不发送请求；设置后重启。');
const controller = new AbortController();
for (const event of ["SIGTERM", "SIGINT"])
  process.once(event, () => controller.abort());
console.log(
  config.provider === "mock"
    ? "AI worker：仅本地 mock，未进行真实 AI 推理"
    : providerReady(config) ? "AI worker 已启动" : "AI worker 已启动（等待密钥）",
);
let lastIdleLog=0;
async function loop() {
  while (!controller.signal.aborted) {
    try {
      const worked = enabled && providerReady(config) ? await runOne({ signal: controller.signal }) : false;
      if (worked) continue;
      if(Date.now()-lastIdleLog>30000) {
        lastIdleLog=Date.now();
        const queue=(await pool.query(`SELECT count(*) FILTER(WHERE j.state IN ('queued','running'))::int active_jobs,
          count(*) FILTER(WHERE j.state IN ('queued','running') AND j.config->>'provider'=$1)::int provider_jobs
          FROM ai_jobs j WHERE ($2::uuid IS NULL OR j.id=$2::uuid)`,[config.provider,process.env.AI_WORKER_JOB_ID||null])).rows[0];
        console.log('ai_worker_idle '+JSON.stringify({enabled,providerReady:providerReady(config),...queue,reason:!enabled?'disabled':!providerReady(config)?'missing_key':'no_claimable_unit; check entitlement, provider, retry time, lease and concurrency if jobs remain'}));
      }
    } catch (error) {
      console.error("Database readiness failed:", {
        code: error.code ?? error.cause?.code ?? "unknown",
        reason:
          error.message === "migration_required"
            ? "missing 004_product_review.sql migration"
            : "connection or query failed",
      });
      await pool.end();
      process.exitCode = 1;
      throw new Error("AI worker database readiness failed");
    }
    await new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        controller.signal.removeEventListener("abort", onAbort);
        resolve();
      }, 1500);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
await Promise.all(
  Array.from({ length: numberEnv("AI_MAX_CONCURRENCY", 2, 1, 8) }, loop),
);
await pool.end();
