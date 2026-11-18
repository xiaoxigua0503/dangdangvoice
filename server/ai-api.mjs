import { z } from "zod";
import { pool, transaction } from "./db.mjs";
import { requireUser, checkOrigin, effectivePro } from "./accounts.mjs";
import { preview, createJob, coverage, loadOwnedRun } from "./ai-jobs.mjs";
import { numberEnv } from "./ai-config.mjs";
const fail = (status, msg) => {
  throw Object.assign(new Error(msg), { status });
};
export async function aiAPI(req, res, url, readBody, json) {
  if (!url.pathname.startsWith("/api/ai/")) return false;
  res.setHeader("Cache-Control", "no-store");
  try {
    checkOrigin(req);
    const user = await requireUser(req);
    if (user.plan !== "pro")
      fail(403, "AI 深度分析仅向 Pro 账户开放；免费基础分析继续可用");
    const path = url.pathname;
    let match;
    if (
      (match = path.match(/^\/api\/ai\/runs\/([^/]+)\/(preview|jobs)$/)) &&
      req.method === "GET"
    ) {
      const run = z.string().uuid().parse(match[1]);
      if (match[2] === "preview") {
        json(res, 200, (await preview(user.id, run)).public);
        return true;
      }
      await loadOwnedRun(user.id, run);
      const rows = (
        await pool.query(
          "SELECT id,state,created_at,config->>'model' model FROM ai_jobs WHERE run_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30",
          [run, user.id],
        )
      ).rows;
      json(res, 200, { rows });
      return true;
    }
    if (path === "/api/ai/jobs" && req.method === "POST") {
      let b;
      try {
        b = JSON.parse(await readBody(req, 4096));
      } catch {
        fail(400, "请求内容无效");
      }
      const { runId } = z
        .object({ runId: z.string().uuid() })
        .strict()
        .parse(b);
      json(res, 200, await createJob(user.id, runId));
      return true;
    }
    match = path.match(
      /^\/api\/ai\/jobs\/([^/]+)(?:\/(report|evidence|cancel|retry|image)(?:\/([^/]+))?)?$/,
    );
    if (!match) fail(404, "AI 接口不存在");
    const id = z.string().uuid().parse(match[1]),
      action = match[2] || "";
    const job = (
      await pool.query(
        "SELECT id,user_id,run_id,state,config,created_at,updated_at,product,revision,report - 'findings' AS report FROM ai_jobs WHERE id=$1 AND user_id=$2",
        [id, user.id],
      )
    ).rows[0];
    if (!job) fail(404, "AI 任务不存在");
    if (!action && req.method === "GET") {
      const counts = await coverage(id);
      const failures = (
        await pool.query(
          "SELECT id,kind,input->>'imageId' image_id,ARRAY(SELECT DISTINCT p->>'commentId' FROM jsonb_array_elements(input->'parts') p) comment_ids,error FROM ai_units WHERE job_id=$1 AND state IN ('failed','cancelled') ORDER BY id LIMIT 100",
          [id],
        )
      ).rows;
      const errorsTotal = +(
        await pool.query(
          "SELECT count(*) n FROM ai_units WHERE job_id=$1 AND state IN ('failed','cancelled')",
          [id],
        )
      ).rows[0].n;
      const usage = (
        await pool.query(
          "SELECT count(*)::int attempts,coalesce(sum((usage->>'prompt_tokens')::bigint),0)::text prompt_tokens,coalesce(sum((usage->>'completion_tokens')::bigint),0)::text completion_tokens,count(*) FILTER(WHERE cached)::int cache_hits FROM ai_attempts WHERE unit_id IN (SELECT id FROM ai_units WHERE job_id=$1)",
          [id],
        )
      ).rows[0];
      const categories = job.report
        ? (
            await pool.query(
              "SELECT f->>'category' category,count(*)::int count FROM ai_jobs j,jsonb_array_elements(j.report->'findings') f WHERE j.id=$1 GROUP BY f->>'category'",
              [id],
            )
          ).rows
        : [];
      json(res, 200, {
        id,
        runId: job.run_id,
        state: job.state,
        model: job.config.model,
        provider: job.config.provider,
        promptVersion: job.config.promptVersion,
        mock: job.config.provider === "mock",
        coverage: counts,
        product: job.product,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        report: job.report
          ? {
              generatedAt: job.report.generatedAt,
              partial: job.report.partial,
              method: job.report.method,
            }
          : null,
        categories,
        failures,
        errorsTotal,
        usage,
        revision: job.revision,
      });
      return true;
    }
    if (action === "report" && req.method === "GET") {
      const category = (url.searchParams.get("category") || "").slice(0, 30),
        page = Math.max(
          1,
          Math.min(
            10000,
            Math.floor(Number(url.searchParams.get("page")) || 1),
          ),
        );
      if (!job.report) fail(409, "报告尚未生成");
      const total = +(
        await pool.query(
          "SELECT count(*) n FROM ai_jobs j,jsonb_array_elements(j.report->'findings') f WHERE j.id=$1 AND ($2='' OR f->>'category'=$2)",
          [id, category],
        )
      ).rows[0].n;
      const findings = (
        await pool.query(
          "SELECT f FROM ai_jobs j,jsonb_array_elements(j.report->'findings') WITH ORDINALITY x(f,n) WHERE j.id=$1 AND ($2='' OR f->>'category'=$2) ORDER BY CASE f->>'priority' WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,n LIMIT 20 OFFSET $3",
          [id, category, (page - 1) * 20],
        )
      ).rows.map((r) => r.f);
      json(res, 200, { findings, total, page });
      return true;
    }
    if (action === "evidence" && req.method === "GET") {
      const cid = url.searchParams.get("comment"),
        iid = url.searchParams.get("image");
      if (cid) {
        const comment = (
          await pool.query(
            "SELECT id,source_id,data FROM ai_comments WHERE job_id=$1 AND id=$2",
            [id, cid],
          )
        ).rows[0];
        if (!comment) fail(404, "评论证据不存在");
        const images = (
          await pool.query(
            "SELECT image_id id FROM ai_image_comments WHERE job_id=$1 AND comment_id=$2",
            [id, cid],
          )
        ).rows;
        json(res, 200, { comment, images });
        return true;
      }
      if (iid) {
        const image = (
          await pool.query(
            "SELECT id,url,content_hash,mime,downloaded_at,error FROM ai_images WHERE job_id=$1 AND id=$2",
            [id, iid],
          )
        ).rows[0];
        if (!image) fail(404, "图片证据不存在");
        const comments = (
          await pool.query(
            "SELECT comment_id id FROM ai_image_comments WHERE job_id=$1 AND image_id=$2",
            [id, iid],
          )
        ).rows;
        json(res, 200, { image, comments });
        return true;
      }
      fail(422, "请选择评论或图片证据");
    }
    if (action === "image" && req.method === "GET") {
      const image = (
        await pool.query(
          "SELECT bytes,mime FROM ai_images WHERE job_id=$1 AND id=$2",
          [id, match[3]],
        )
      ).rows[0];
      if (!image?.bytes) fail(404, "图片未下载或不可用");
      res.writeHead(200, {
        "content-type": image.mime,
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      });
      res.end(image.bytes);
      return true;
    }
    if (["retry", "cancel"].includes(action) && req.method === "POST") {
      try {
        z.object({})
          .strict()
          .parse(JSON.parse(await readBody(req, 4096)));
      } catch {
        fail(422, "请求格式无效或过大");
      }
      await transaction(async (c) => {
        const entitlement = (
          await c.query(
            "SELECT plan,verified_at,pro_expires_at,disabled_at FROM users WHERE id=$1 FOR UPDATE",
            [user.id],
          )
        ).rows[0];
        if (!effectivePro(entitlement) || !entitlement.verified_at)
          fail(403, "需要已验证邮箱的 Pro 账户");
        const row = (
          await c.query(
            "SELECT state,revision FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [id, user.id],
          )
        ).rows[0];
        if (!row) fail(404, "AI 任务不存在");
        if (action === "cancel") {
          if (row.state === "completed")
            fail(409, "任务已结束，无需取消；已保存的报告保持可读");
          await c.query(
            "UPDATE ai_jobs SET state='cancelled',report=NULL,updated_at=now() WHERE id=$1",
            [id],
          );
          await c.query(
            "UPDATE ai_units SET state='cancelled',error='cancelled',lease_token=NULL,lease_until=NULL WHERE job_id=$1 AND state IN ('pending','running')",
            [id],
          );
        } else {
          if (row.revision >= numberEnv("AI_MAX_RETRY_ROUNDS", 2, 1, 5))
            fail(429, "已达到手动重试轮数上限");
          const active = +(
            await c.query(
              "SELECT count(*) n FROM ai_jobs WHERE user_id=$1 AND state IN ('queued','running') AND id<>$2",
              [user.id, id],
            )
          ).rows[0].n;
          if (active >= numberEnv("AI_USER_MAX_ACTIVE_JOBS", 2))
            fail(429, "当前账户并行任务已满");
          const r = await c.query(
            "UPDATE ai_units SET state='pending',attempts=0,error=NULL,next_at=now(),lease_token=NULL,lease_until=NULL WHERE job_id=$1 AND state IN ('failed','cancelled') RETURNING id",
            [id],
          );
          if (!r.rowCount) fail(409, "没有需要重试的失败项");
          await c.query(
            "UPDATE ai_jobs SET state=CASE WHEN state IN ('queued','running') THEN state ELSE 'queued' END,report=NULL,revision=revision+1,updated_at=now() WHERE id=$1",
            [id],
          );
        }
      });
      json(res, 200, { ok: true });
      return true;
    }
    fail(405, "不支持此请求方式");
  } catch (e) {
    json(res, e instanceof z.ZodError ? 422 : e.status || 503, {
      msg:
        e instanceof z.ZodError
          ? "AI 请求格式不正确"
          : e.status
            ? e.message
            : "AI 服务暂不可用或配置不完整，请检查服务器配置",
    });
    return true;
  }
}
