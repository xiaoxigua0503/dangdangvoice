import {logProductionStatus} from "./production-status.mjs";
import { pool } from "./db.mjs";
import { runOne } from "./ai-worker-core.mjs";
import { aiConfig, numberEnv, providerReady } from "./ai-config.mjs";
if (!pool) throw new Error("DATABASE_URL is required");
const config = aiConfig();
logProductionStatus('worker');
// Startup readiness checks only; no unit is claimed and no model request is sent.
try {
 const schema=await pool.query("SELECT 1 FROM schema_migrations WHERE version='003_admin.sql'");
 if(!schema.rowCount)throw new Error('migration_required');
 console.log('AI worker：PostgreSQL 连接与迁移状态就绪');
} catch {
 await pool.end();throw new Error('AI worker 数据库未就绪，请检查生产直连地址与迁移');
}
const enabled=process.env.AI_WORKER_ENABLED==='true'||(process.env.NODE_ENV!=='production'&&process.env.AI_WORKER_ENABLED!=='false');
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
async function loop() {
  while (!controller.signal.aborted) {
    try {
      const worked = enabled && providerReady(config) ? await runOne({ signal: controller.signal }) : false;
      if (worked) continue;
    } catch {
      console.error("AI worker step unavailable; retrying");
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
