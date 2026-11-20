import { modelBudget } from "./ai-review.mjs";
import { effectivePro } from "./accounts.mjs";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.mjs";
import { digest, numberEnv, aiConfig, providerReady } from "./ai-config.mjs";
const fail = (status, msg) => {
  throw Object.assign(new Error(msg), { status });
};
export function batchParts(parts, config) {
  const batches = [];
  let batch = [],
    size = 0;
  for (const part of parts) {
    if (
      batch.length &&
      (batch.length >= config.batchComments ||
        size + part.text.length > config.batchChars)
    ) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(part);
    size += part.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function makePlan(rows, product, config) {
  const comments = [],
    parts = [],
    imageMap = new Map();
  for (const [ordinal, row] of rows.entries()) {
    const id = "C" + ordinal;
    const data = {
      text: typeof row.text === "string" ? row.text : "",
      text_full: typeof row.text_full === "string" ? row.text_full : "",
      score: Number.isFinite(row.score) ? row.score : null,
      is_auto: Boolean(row.is_auto),
      source: row.source ?? product.source ?? null,
      variant: row.variant ?? null,
      date: row.date ?? null,
      detail_url: row.detail_url ?? null,
    };
    comments.push({
      id,
      sourceId: row.cid == null ? null : String(row.cid),
      data,
    });
    const texts =
      data.text_full && data.text_full !== data.text
        ? [
            ["text", data.text],
            ["text_full", data.text_full],
          ]
        : [["text", data.text_full || data.text]];
    let part = 0;
    for (const [field, text] of texts) {
      const chars = Array.from(text);
      if (!chars.length && texts.length > 1) continue;
      for (
        let offset = 0;
        offset < Math.max(1, chars.length);
        offset += Math.floor(config.batchChars / 2)
      )
        parts.push({
          commentId: id,
          score: data.score, date: data.date, variant: data.variant, is_auto: data.is_auto, source: data.source,
          part: part++,
          field,
          text: chars
            .slice(offset, offset + Math.floor(config.batchChars / 2))
            .join(""),
        });
    }
    const pics = Array.isArray(row.pics) ? row.pics : [];
    const urls = pics.map((p, photoIndex) =>
      typeof p?.big === "string" && p.big
        ? p.big
        : typeof p?.th === "string"
          ? p.th
          : "invalid:" + id + ":" + photoIndex,
    );
    if (!urls.length && row.has_img) urls.push("missing:" + id);
    for (const [photoIndex,originalUrl] of urls.entries()) {
      let url=originalUrl;
      try {
        const u = new URL(url);
        u.hash = "";
        if (u.protocol === "http:") u.protocol = "https:";
        url = u.href;
      } catch {
        /* remains an explicit unavailable entry */
      }
      if (!imageMap.has(url))
        imageMap.set(url, {
          id: "I" + digest(url).slice(0, 24),
          url,
          comments: [], occurrences:[],
        });
      const img = imageMap.get(url);
      img.occurrences.push({commentId:id,photoIndex,originalUrl});
      if (img.comments.at(-1) !== id) img.comments.push(id);
    }
  }
  const images = [...imageMap.values()];
  const units = parts.length ? [{kind:'prepare', input:{parts, product, images:images.map(i=>({id:i.id,comments:i.comments,occurrences:i.occurrences})), comments}}] : [];
  return { comments, images, units };
}
export async function loadOwnedRun(userId, runId, c = pool) {
  const run = (
    await c.query("SELECT product FROM saved_runs WHERE id=$1 AND user_id=$2", [
      runId,
      userId,
    ])
  ).rows[0];
  if (!run) fail(404, "云端记录不存在");
  const rows = (
    await c.query(
      "SELECT data FROM saved_comments WHERE run_id=$1 ORDER BY ordinal",
      [runId],
    )
  ).rows.map((r) => r.data);
  // Minimize the AI snapshot and never send reviewer account names or levels.
  const p = run.product;
  const product = {
    pid: p.pid, name:p.name, source:p.source, collected_at:p.collected_at,
    sellerMetadata: Object.fromEntries(['description','price','specifications','variants','publisher','author','isbn'].filter(k=>p[k]!=null).map(k=>[k,p[k]])),
    site: (()=>{const site=p.site||p.analysis?.site||{};return Object.fromEntries(['total_comment_num','pageCount','average_score'].filter(k=>site[k]!=null).map(k=>[k,site[k]]));})(),
    note_sample:p.analysis?.note_sample || null, note_partial:p.analysis?.note_partial || null,
  };
  return { rows, product };
}
export async function preview(userId, runId) {
  const config = aiConfig();
  const { rows, product } = await loadOwnedRun(userId, runId);
  const plan = makePlan(rows, product, config);
  const limits = {
    comments: numberEnv("AI_MAX_COMMENTS", 20000),
    images: numberEnv("AI_MAX_IMAGES", 200),
    units: numberEnv("AI_MAX_UNITS", 2000),
    imageBytes: config.maxImageBytes,
    totalImageBytes: config.maxTotalImageBytes,
  };
  const jobLimits = {
    daily: numberEnv("AI_USER_MAX_DAILY_JOBS", 10),
    active: numberEnv("AI_USER_MAX_ACTIVE_JOBS", 2),
    retryRounds: numberEnv("AI_MAX_RETRY_ROUNDS", 2, 1, 5),
    attempts: config.maxAttempts,
    maxOutputTokens: config.outputTokens,
  };
  const blocked =
    !modelBudget(config) ||
    rows.length > limits.comments ||
    plan.images.length > limits.images ||
    plan.units.length > limits.units;
  return {
    config,
    plan,
    product,
    public: {
      comments: rows.length,
      images: plan.images.filter((i) => !i.url.startsWith("missing:")).length,
      missingImageReferences: plan.images.filter((i) =>
        i.url.startsWith("missing:"),
      ).length,
      units: plan.units.length,
      limits,
      jobLimits,
      maxRequests:
        limits.units * jobLimits.attempts * (jobLimits.retryRounds + 1),
      blocked,
      budget: modelBudget(config),
      strategy: "下载并去重后，容量允许时一次图文合读；超限时分阶段阅读，再写一篇综合解读。不会静默抽样。",
      ready: providerReady(config),
      provider: config.provider,
      model: config.model,
      promptVersion: config.promptVersion,
      sourceNotices: [product.note_sample, product.note_partial].filter(
        Boolean,
      ),
      notice:
        "分析本份快照，不代表当当全部评价。传入已采集商品资料（商家声明）、评论全文、评分、日期、版本、默认评价标记及关联图片；不发送评论者账户名。未能读取的图片会明确列出。",
    },
  };
}
export async function createJob(userId, runId) {
  const check = await preview(userId, runId);
  if (check.public.blocked)
    fail(
      422,
      "本记录超出配置容量，不能进行全量分析；请调整容量后重试，不会抽样启动",
    );
  if (!check.public.ready) fail(503, "AI 服务尚未配置密钥，未开始分析");
  const { config, plan, product } = check;
  const inputHash = digest({
    product,
    comments: plan.comments,
    images: plan.images,
  });
  const configHash = digest(config);
  return transaction(async (c) => {
    const u = (
      await c.query(
        "SELECT plan,verified_at,pro_expires_at,disabled_at FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (!effectivePro(u) || !u.verified_at)
      fail(403, "需要已验证邮箱的 Pro 账户");
    if (
      !(
        await c.query(
          "SELECT 1 FROM saved_runs WHERE id=$1 AND user_id=$2 FOR SHARE",
          [runId, userId],
        )
      ).rowCount
    )
      fail(404, "云端记录不存在");
    const existing = (
      await c.query(
        "SELECT id FROM ai_jobs WHERE user_id=$1 AND run_id=$2 AND input_hash=$3 AND config_hash=$4",
        [userId, runId, inputHash, configHash],
      )
    ).rows[0];
    if (existing) return { id: existing.id, reused: true };
    const counts = (
      await c.query(
        "SELECT count(*) FILTER(WHERE state IN ('queued','running')) active,count(*) FILTER(WHERE created_at>now()-interval '24 hours') daily FROM ai_jobs WHERE user_id=$1",
        [userId],
      )
    ).rows[0];
    if (
      +counts.active >= numberEnv("AI_USER_MAX_ACTIVE_JOBS", 2) ||
      +counts.daily >= numberEnv("AI_USER_MAX_DAILY_JOBS", 10)
    )
      fail(429, "已达到当前账户 AI 任务限额，请稍后再试");
    const id = randomUUID();
    await c.query(
      "INSERT INTO ai_jobs(id,user_id,run_id,input_hash,config,config_hash,product) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, userId, runId, inputHash, config, configHash, product],
    );
    await c.query(
      "INSERT INTO ai_comments(job_id,id,source_id,data) SELECT $1,x->>'id',x->>'sourceId',x->'data' FROM jsonb_array_elements($2::jsonb) x",
      [id, JSON.stringify(plan.comments)],
    );
    await c.query(
      "INSERT INTO ai_images(job_id,id,url) SELECT $1,x->>'id',x->>'url' FROM jsonb_array_elements($2::jsonb) x",
      [id, JSON.stringify(plan.images)],
    );
    const associations = plan.images.flatMap((image) =>
      image.comments.map((cid) => ({ imageId: image.id, commentId: cid })),
    );
    await c.query(
      "INSERT INTO ai_image_comments(job_id,image_id,comment_id) SELECT $1,x->>'imageId',x->>'commentId' FROM jsonb_array_elements($2::jsonb) x",
      [id, JSON.stringify(associations)],
    );
    const units = plan.units.map((unit) => ({ ...unit, id: randomUUID() }));
    await c.query(
      "INSERT INTO ai_units(id,job_id,kind,input) SELECT (x->>'id')::uuid,$1,x->>'kind',x->'input' FROM jsonb_array_elements($2::jsonb) x",
      [id, JSON.stringify(units)],
    );
    const links = units.flatMap((u) =>
      [...new Set(u.input.parts.map((p) => p.commentId))].map((cid) => ({
        unitId: u.id,
        cid,
      })),
    );
    await c.query(
      "INSERT INTO ai_unit_comments(job_id,unit_id,comment_id) SELECT $1,(x->>'unitId')::uuid,x->>'cid' FROM jsonb_array_elements($2::jsonb) x",
      [id, JSON.stringify(links)],
    );
    if (!plan.units.length)
      await c.query(
        "UPDATE ai_jobs SET state='completed',report=$2 WHERE id=$1",
        [
          id,
          {
            schemaVersion:2,hasSynthesis:false,empty:true,partial:false,findings: [],
            generatedAt: new Date().toISOString(),
            mock: config.provider === "mock",
          },
        ],
      );
    return { id, reused: false };
  });
}
export async function coverage(id, c = pool) {
  const comments = (
    await c.query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE n>0 AND done=n)::int completed,count(*) FILTER(WHERE failed>0)::int failed FROM (SELECT a.id,count(u.id) n,count(u.id) FILTER(WHERE u.state='done') done,count(u.id) FILTER(WHERE u.state IN ('failed','cancelled')) failed FROM ai_comments a LEFT JOIN ai_unit_comments link ON link.job_id=a.job_id AND link.comment_id=a.id LEFT JOIN ai_units u ON u.id=link.unit_id AND u.kind IN ('text','review') WHERE a.job_id=$1 GROUP BY a.id) q`,
      [id],
    )
  ).rows[0];
  const images = (
    await c.query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE done=n AND n>0)::int completed,count(*) FILTER(WHERE failed>0)::int failed FROM (SELECT coalesce(i.content_hash,i.url) key,count(u.id) n,count(u.id) FILTER(WHERE u.state='done') done,count(u.id) FILTER(WHERE u.state IN ('failed','cancelled')) failed FROM ai_images i LEFT JOIN ai_units u ON u.job_id=i.job_id AND ((u.kind='image' AND u.input->>'imageId'=i.id) OR (u.kind='review' AND EXISTS(SELECT 1 FROM jsonb_array_elements(u.input->'images') x WHERE x->>'id'=i.id OR (x->'aliases') ? i.id))) WHERE i.job_id=$1 AND i.url NOT LIKE 'missing:%' GROUP BY coalesce(i.content_hash,i.url)) q`,
      [id],
    )
  ).rows[0];
  images.missingReferences = +(
    await c.query(
      "SELECT count(*) n FROM ai_images WHERE job_id=$1 AND url LIKE 'missing:%'",
      [id],
    )
  ).rows[0].n;
  const units = (
    await c.query(
      "SELECT count(*)::int total,count(*) FILTER(WHERE state='done')::int completed,count(*) FILTER(WHERE state IN ('failed','cancelled'))::int failed,count(*) FILTER(WHERE state='running')::int running FROM ai_units WHERE job_id=$1",
      [id],
    )
  ).rows[0];
  return {
    comments,
    images,
    units,
    complete:
      comments.total === comments.completed &&
      images.total === images.completed &&
      images.missingReferences === 0,
  };
}
export async function finalize(c, id) {
  const job = (
    await c.query("SELECT * FROM ai_jobs WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (!job || job.state === "cancelled") return;
  if (
    (
      await c.query(
        "SELECT 1 FROM ai_units WHERE job_id=$1 AND state IN ('pending','running') LIMIT 1",
        [id],
      )
    ).rowCount
  )
    return;
  if(job.config.schemaVersion===2) { const {finalizeReview}=await import('./ai-review-jobs.mjs'); return finalizeReview(c,job); }
  const rows = (
    await c.query(
      "SELECT id,result FROM ai_units WHERE job_id=$1 AND state='done' ORDER BY id",
      [id],
    )
  ).rows;
  const findings = rows.flatMap((r) =>
    (r.result?.findings || []).map((f, i) => ({ ...f, id: r.id + ":" + i })),
  );
  const aspectGroups = new Map();
  for (const f of findings) {
    if (!aspectGroups.has(f.aspect))
      aspectGroups.set(f.aspect, { positive: [], negative: [] });
    if (f.category === "strength") aspectGroups.get(f.aspect).positive.push(f);
    if (f.category === "problem") aspectGroups.get(f.aspect).negative.push(f);
  }
  for (const [aspect, group] of aspectGroups) {
    if (!group.positive.length || !group.negative.length) continue;
    const sources = [...group.positive, ...group.negative];
    findings.push({
      id: "conflict:" + digest(aspect).slice(0, 16),
      category: "conflict",
      aspect,
      title: "同一方面存在不同方向的证据",
      body: "该方面同时被列为优势与问题，建议对照下方证据中的版本、日期和具体场景，不宜据此承诺统一体验。",
      uncertainty:
        "这是程序对经过校验的分批发现进行的交叉提示；需要阅读原文核对差异原因。",
      priority: "medium",
      comments: [...new Set(sources.flatMap((f) => f.comments))],
      images: [...new Set(sources.flatMap((f) => f.images))],
      quotes: [],
    });
  }
  const counts = await coverage(id, c);
  await c.query(
    "UPDATE ai_jobs SET state='completed',report=$2,updated_at=now() WHERE id=$1",
    [
      id,
      {
        findings,
        coverage: counts,
        partial: !counts.complete,
        mock: job.config.provider === "mock",
        generatedAt: new Date().toISOString(),
        method:
          "全量分批证据报告；各发现仅针对所引用证据，不将分批观察扩写为全体结论。",
      },
    ],
  );
}
