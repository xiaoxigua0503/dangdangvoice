import { randomUUID } from "node:crypto";
import { pool } from "./db.mjs";
import { digest } from "./ai-config.mjs";
import { infer, usageFrom } from "./ai-provider.mjs";
import { downloadImage } from "./ai-images.mjs";
import { validateResult } from "./ai-evidence.mjs";
import { finalize } from "./ai-jobs.mjs";
const safeErrors = new Set([
  "invalid_structure",
  "invalid_reference",
  "missing_evidence",
  "invented_quote",
  "unsupported_statistics",
  "definitive_authenticity_claim",
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
    const candidates = (
      await c.query(
        `SELECT w.*,j.user_id,j.config,j.config_hash FROM ai_units w JOIN ai_jobs j ON j.id=w.job_id JOIN users a ON a.id=j.user_id WHERE a.plan='pro' AND a.disabled_at IS NULL AND (a.pro_expires_at IS NULL OR a.pro_expires_at>now()) AND a.verified_at IS NOT NULL AND j.config->>'provider'=$2 AND j.state IN ('queued','running') AND ((w.state='pending' AND w.next_at<=now()) OR (w.state='running' AND w.lease_until<now())) AND (w.state='running' OR (SELECT count(*) FROM ai_units active JOIN ai_jobs ownerjob ON ownerjob.id=active.job_id WHERE ownerjob.user_id=j.user_id AND active.state='running' AND active.lease_until>now())<$1) ORDER BY w.next_at,w.id FOR UPDATE OF w SKIP LOCKED LIMIT 32`,
        [runtime.user_concurrency, provider],
      )
    ).rows;
    for (const unit of candidates) {
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
async function imageFor(c, unit, downloadFn, signal) {
  let img = (
    await c.query("SELECT * FROM ai_images WHERE job_id=$1 AND id=$2", [
      unit.job_id,
      unit.input.imageId,
    ])
  ).rows[0];
  if (!img) throw new Error("image_unavailable");
  if (img.bytes)
    return { bytes: img.bytes, mime: img.mime, hash: img.content_hash };
  // One immutable downloaded representation per URL, even with many context units.
  await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
    "download:" + unit.job_id + ":" + img.id,
  ]);
  img = (
    await c.query("SELECT * FROM ai_images WHERE job_id=$1 AND id=$2", [
      unit.job_id,
      img.id,
    ])
  ).rows[0];
  if (img.bytes)
    return { bytes: img.bytes, mime: img.mime, hash: img.content_hash };
  const image = await downloadFn(img.url, unit.config, signal);
  const hash = digest(image.bytes);
  await c.query("BEGIN");
  try {
    await c.query("SELECT id FROM ai_jobs WHERE id=$1 FOR UPDATE", [
      unit.job_id,
    ]);
    const total = +(
      await c.query(
        "SELECT coalesce(sum(octet_length(bytes)),0) n FROM ai_images WHERE job_id=$1",
        [unit.job_id],
      )
    ).rows[0].n;
    if (total + image.bytes.length > unit.config.maxTotalImageBytes)
      throw Object.assign(new Error("total_image_budget"), { permanent: true });
    await c.query(
      "UPDATE ai_images SET bytes=$3,mime=$4,content_hash=$5,downloaded_at=now(),error=NULL WHERE job_id=$1 AND id=$2",
      [unit.job_id, img.id, image.bytes, image.mime, hash],
    );
    await c.query("COMMIT");
    return { ...image, hash };
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
    cacheHit = false;
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
    const image =
      unit.kind === "image"
        ? await imageFor(c, unit, downloadFn, workSignal)
        : null;
    const cacheKey = digest({
      config: unit.config_hash,
      kind: unit.kind,
      parts: unit.input.parts,
      product: unit.input.product,
      image: image?.hash || null,
    });
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
    if (cached) {
      cacheHit = true;
      const remapped = {
        findings: cached.result.findings.map((f) => ({
          ...f,
          images: f.images.length ? [unit.input.imageId] : [],
        })),
      };
      result = validateResult(remapped, unit.input);
    } else {
      const response = await inferFn(
        unit.config,
        unit.input,
        image,
        workSignal,
      );
      usage = response.usage || {};
      result = validateResult(response.result, unit.input);
    }
    if (control.signal.aborted) throw new Error("aborted");
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
    return true;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    if (!unit?.id) throw e;
    if (e.providerUsage) usage = usageFrom(e.providerUsage);
    const code = safeErrors.has(e.message)
      ? e.message
      : control.signal.aborted
        ? "interrupted"
        : e.message === "aborted" ||
            ["AbortError", "TimeoutError"].includes(e.name)
          ? "request_timeout"
          : "worker_error";
    const permanent =
      e.permanent ||
      ["provider_auth_failed", "provider_not_configured"].includes(code);
    await c.query("BEGIN");
    try {
      const live = (
        await c.query("SELECT state FROM ai_jobs WHERE id=$1 FOR UPDATE", [
          unit.job_id,
        ])
      ).rows[0];
      if (live) {
        const state =
          live.state === "cancelled"
            ? "cancelled"
            : permanent || unit.attempts + 1 >= unit.config.maxAttempts
              ? "failed"
              : "pending";
        await c.query(
          "UPDATE ai_units SET state=$3,error=$4,lease_token=NULL,lease_until=NULL,next_at=now()+($5*interval '1 millisecond') WHERE id=$1 AND lease_token=$2 AND state='running'",
          [
            unit.id,
            unit.leaseToken,
            state,
            code,
            Math.min(120000, retryBaseMs * 2 ** unit.attempts),
          ],
        );
        if (
          (unit.kind === "image" && code.startsWith("image_")) ||
          (unit.kind === "image" &&
            [
              "unsupported_image_host",
              "invalid_image_url",
              "unsafe_image_address",
              "unsupported_image_format",
              "invalid_image_content",
              "total_image_budget",
            ].includes(code))
        )
          await c.query(
            "UPDATE ai_images SET error=$3 WHERE job_id=$1 AND id=$2 AND bytes IS NULL",
            [unit.job_id, unit.input.imageId, code],
          );
        await c.query(
          "UPDATE ai_attempts SET state=$2,ended_at=now(),error=$3,usage=$4 WHERE id=$1",
          [unit.attemptId, state, code, usage],
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
