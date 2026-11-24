import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import { z } from "zod";
import { pool, transaction } from "./db.mjs";
const scrypt = promisify(scryptCb);
const hash = (t) => createHash("sha256").update(t).digest("hex");
const token = () => randomBytes(32).toString("hex");
const prod = process.env.NODE_ENV === "production";
const base = process.env.APP_BASE_URL || (prod ? "" : "http://localhost:3000");
if (
  prod &&
  pool &&
  (!base.startsWith("https://") || process.env.MAIL_TRANSPORT === "capture")
)
  throw new Error("Production requires HTTPS APP_BASE_URL and SMTP");
const capture = process.env.MAIL_TRANSPORT === "capture" && !prod;
export const capturedMail = []; // development/test only; no HTTP endpoint, no token logging
const transport = capture
  ? null
  : nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: prod && process.env.SMTP_SECURE !== "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const password = z.string().min(12, "密码至少需要 12 个字符").max(128);
const credentials = z.object({ email, password });
const fail = (status, msg) => {
  throw Object.assign(new Error(msg), { status });
};
export const publicUser = (u) =>
  u ? { id: u.id, email: u.email, verified: !!u.verified_at, plan: effectivePlan(u), role: u.role || "user", proExpiresAt: u.pro_expires_at } : null;
export const effectivePro = (u) => !!u && !u.disabled_at && u.plan === 'pro' && (!u.pro_expires_at || new Date(u.pro_expires_at)>new Date());
export const effectivePlan=u=>!!u&&!u.disabled_at&&['pro','enterprise'].includes(u.plan)&&(!u.pro_expires_at||new Date(u.pro_expires_at)>new Date())?u.plan:'free';
export function mailStatus() { return { mode: capture ? 'capture' : 'smtp', configured: !capture && !!(process.env.SMTP_HOST && process.env.MAIL_FROM && process.env.SMTP_USER && process.env.SMTP_PASS), baseUrl: base, hostConfigured: !!process.env.SMTP_HOST, senderConfigured: !!process.env.MAIL_FROM, credentialsConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) }; }
export const appOrigin = new URL(base).origin;
const secureCookies = prod || new URL(base).protocol === 'https:';
const csrfCookieName = secureCookies ? '__Host-ddv_csrf' : 'ddv_csrf';
function readCookie(req, name) {
  return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
}
export function canonicalRequest(req, res) {
  // Never derive trusted origins from Host or X-Forwarded-* headers.
  if (!prod && appOrigin === 'http://localhost:3000' && req.headers.host === '127.0.0.1:3000' && ['GET','HEAD'].includes(req.method)) {
    res.writeHead(307, {location:appOrigin+req.url, 'cache-control':'no-store'});
    res.end(); return true;
  }
  return false;
}
export function initializeCsrf(req, res) {
  if(req.headers.host !== new URL(base).host) fail(403, '请使用站点正式地址打开页面：'+appOrigin);
  if(req.headers.origin && req.headers.origin !== appOrigin) fail(403,'请求来源校验失败，请使用站点正式地址');
  if(req.headers['sec-fetch-site'] === 'cross-site') fail(403,'请求来源校验失败');
  // Host-only, HttpOnly cookie; browser receives the matching value via a same-origin JSON response.
  // HTTPS uses __Host- to prevent sibling domains from planting a parent-domain cookie.
  let value=readCookie(req,csrfCookieName);
  if(!/^[a-f0-9]{64}$/.test(value||''))value=token();
  res.setHeader('set-cookie', `${csrfCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${secureCookies?'; Secure':''}`);
  return value;
}
export function checkOrigin(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  let source = req.headers.origin;
  if (!source && req.headers.referer) {
    try { source = new URL(req.headers.referer).origin; } catch { /* invalid source is denied below */ }
  }
  if (req.headers.host !== new URL(base).host || source !== appOrigin || req.headers['sec-fetch-site'] === 'cross-site' || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || '')))
    fail(403, '请求来源校验失败，请使用 '+appOrigin+' 打开并刷新页面');
  const supplied = req.headers['x-csrf-token'], stored=readCookie(req,csrfCookieName);
  if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!/^[a-f0-9]{64}$/.test(stored||'')||!timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(stored,'hex')))
    throw Object.assign(new Error('安全凭据已过期，请刷新后重试'),{status:403,code:'csrf_invalid'});
}
export async function currentUser(req) {
  if (!pool) return null;
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("ddv_account="))
    ?.slice(12);
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const r = await pool.query(
    "SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(raw)],
  );
  const u=r.rows[0];
  if (!u || u.disabled_at) return null;
  return {...u, plan: effectivePlan(u)};
}
export async function requireUser(req, verified = true) {
  if (!pool) fail(503, "账户服务未配置数据库，暂不可用");
  const u = await currentUser(req);
  if (!u) fail(401, "请先登录账户");
  if (verified && !u.verified_at) fail(403, "请先验证邮箱");
  return u;
}
async function limit(req, action, address = "") {
  const ip =
    process.env.TRUST_PROXY === "true"
      ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
          .split(",")[0]
          .trim()
      : req.socket.remoteAddress;
  for (const [key, max] of [
    [`${action}:ip:${ip}`, 30],
    ...(address ? [[`${action}:email:${address}`, 8]] : []),
  ]) {
    const r = await pool.query(
      `INSERT INTO auth_limits(key,hits,until_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_limits.until_at<now() THEN 1 ELSE auth_limits.hits+1 END,until_at=CASE WHEN auth_limits.until_at<now() THEN now()+interval '15 minutes' ELSE auth_limits.until_at END RETURNING hits`,
      [hash(key)],
    );
    if (r.rows[0].hits > max) fail(429, "操作过于频繁，请 15 分钟后重试");
  }
}
export async function passwordHash(p) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${Buffer.from(await scrypt(p, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 })).toString("hex")}`;
}
async function passwordOk(p, encoded) {
  const [, salt, want] = encoded.split("$");
  const got = await scrypt(p, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(got, Buffer.from(want, "hex"));
}
const dummy = await passwordHash(token());
async function mailToken(u, kind) {
  if (u.email.endsWith('@dangdangvoice.example')) fail(503, "演示登录标识没有真实邮箱，请使用本地凭据登录");
  const raw = token();
  await pool.query(
    "INSERT INTO email_tokens(token_hash,user_id,kind,expires_at) VALUES($1,$2,$3,now()+($4 * interval '1 minute'))",
    [hash(raw), u.id, kind, kind === "verify" ? 1440 : 30],
  );
  const link = new URL(kind === 'verify' ? '/verify-email' : '/reset-password', base);
  link.hash = raw;
  const message = {
    from: process.env.MAIL_FROM,
    to: u.email,
    subject: kind === "verify" ? "当当之声 · 验证邮箱" : "当当之声 · 重置密码",
    text: `请打开以下链接${kind === "verify" ? "验证邮箱（24 小时内有效）" : "重置密码（30 分钟内有效）"}：\n${link}\n链接只能使用一次。如果不是你本人操作，请忽略此邮件。`,
  };
  try {
    if (capture) {
      capturedMail.push(message);
      if (capturedMail.length > 100) capturedMail.shift();
      if (process.env.MAIL_CAPTURE_DIR) {
        await mkdir(process.env.MAIL_CAPTURE_DIR, {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(
          join(process.env.MAIL_CAPTURE_DIR, randomUUID() + ".json"),
          JSON.stringify(message, null, 2),
          { mode: 0o600 },
        );
      }
    } else {
      if (!process.env.SMTP_HOST || !process.env.MAIL_FROM)
        throw new Error("SMTP unavailable");
      await transport.sendMail(message);
    }
  } catch (error) {
    console.error('邮件投递失败', {kind, code: /^[A-Z0-9_]{1,40}$/.test(error?.code||'') ? error.code : 'MAIL_UNAVAILABLE'});
    await pool.query("DELETE FROM email_tokens WHERE token_hash=$1", [
      hash(raw),
    ]);
    fail(503, "邮件发送暂不可用，请稍后重试；本次未确认送达");
  }
}
function cookie(res, raw, age) {
  res.setHeader(
    "set-cookie",
    `ddv_account=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookies ? "; Secure" : ""}`,
  );
}
export async function accounts(req, res, url, readBody, json) {
  const path = url.pathname;
  if (!path.startsWith("/api/auth/") && !path.startsWith("/api/history"))
    return false;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!pool) fail(503, "账户服务未配置数据库，暂不可用");
    checkOrigin(req);
    if (path === "/api/auth/me" && req.method === "GET") {
      json(res, 200, { user: publicUser(await currentUser(req)) });
      return true;
    }
    let b = {};
    if (req.method === "POST") {
      try {
        b = JSON.parse(
          await readBody(
            req,
            path.startsWith("/api/history") ? 20_000_000 : 8192,
          ),
        );
      } catch {
        fail(400, "请求内容无效或过大");
      }
      b = z.object({}).passthrough().parse(b);
    }
    const action = path.slice("/api/auth/".length);
    if (path.startsWith("/api/auth/") && req.method === "POST") {
      if (action === "logout") {
        const u = await currentUser(req);
        if (u)
          await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
            u.token_hash,
          ]);
        cookie(res, "", 0);
        json(res, 200, { ok: true });
        return true;
      }
      const addr = ["signup", "login", "forgot", "resend"].includes(action)
        ? email.parse(b.email)
        : "";
      await limit(req, action, addr);
      if (['signup','forgot','resend'].includes(action) && !capture && !mailStatus().configured)
        fail(503, '邮件服务尚未配置完成，暂不能发送验证或重置邮件，请联系管理员');
      if (action === "signup") {
        const c = credentials.parse(b);
        const encoded = await passwordHash(c.password);
        const r = await pool.query(
          "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING *",
          [randomUUID(), addr, encoded],
        );
        const u =
          r.rows[0] ||
          (await pool.query("SELECT * FROM users WHERE email=$1", [addr]))
            .rows[0];
        if (!u.verified_at) await mailToken(u, "verify");
        json(res, 200, {
          msg: capture
            ? "开发模式：符合条件的验证邮件仅在本机捕获，未实际发送；已有账户请直接登录。"
            : "如该邮箱可注册，验证邮件将发送至邮箱；已有账户请直接登录。",
        });
        return true;
      }
      if (action === "login") {
        credentials.parse(b);
        const u = (
          await pool.query("SELECT * FROM users WHERE email=$1", [addr])
        ).rows[0];
        if (!(await passwordOk(b.password, u?.password_hash || dummy)) || !u || u.disabled_at)
          fail(401, "邮箱或密码不正确");
        const raw = token();
        await transaction(async (c) => {
          const fresh = (
            await c.query(
              "SELECT password_hash,disabled_at FROM users WHERE id=$1 FOR UPDATE",
              [u.id],
            )
          ).rows[0];
          if (fresh?.password_hash !== u.password_hash || fresh.disabled_at)
            fail(401, "邮箱或密码不正确");
          await c.query(
            "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
            [hash(raw), u.id],
          );
        });
        cookie(res, raw, 604800);
        json(res, 200, { user: publicUser(u) });
        return true;
      }
      if (action === "forgot" || action === "resend") {
        const u = (
          await pool.query("SELECT * FROM users WHERE email=$1", [addr])
        ).rows[0];
        if (u && (action === "forgot" || !u.verified_at))
          await mailToken(u, action === "forgot" ? "reset" : "verify");
        json(res, 200, {
          msg: capture
            ? "开发模式：符合条件的邮件仅在本机捕获，未实际发送，请查看开发捕获目录。"
            : "如果邮箱符合条件，邮件将发送至邮箱，请检查垃圾邮件。",
        });
        return true;
      }
      if (action === "verify" || action === "reset") {
        const parsedToken = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .safeParse(b.token);
        if (!parsedToken.success) fail(400, "链接无效或已失效，请重新申请邮件");
        const raw = parsedToken.data;
        const encoded =
          action === "reset"
            ? await passwordHash(password.parse(b.password))
            : null;
        await transaction(async (c) => {
          const t = (
            await c.query(
              "SELECT user_id FROM email_tokens WHERE token_hash=$1 AND kind=$2 AND expires_at>now()",
              [hash(raw), action === "verify" ? "verify" : "reset"],
            )
          ).rows[0];
          if (!t) fail(400, "链接已失效或已使用，请重新申请邮件");
          // Serialize concurrent reset/verify operations for this account.
          await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            t.user_id,
          ]);
          const consumed = await c.query(
            "DELETE FROM email_tokens WHERE token_hash=$1 AND kind=$2 AND expires_at>now() RETURNING user_id",
            [hash(raw), action === "verify" ? "verify" : "reset"],
          );
          if (!consumed.rowCount)
            fail(400, "链接已失效或已使用，请重新申请邮件");
          if (action === "verify")
            await c.query("UPDATE users SET verified_at=now() WHERE id=$1", [
              t.user_id,
            ]);
          else {
            await c.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
              encoded,
              t.user_id,
            ]);
            await c.query("DELETE FROM sessions WHERE user_id=$1", [t.user_id]);
          }
          await c.query(
            "DELETE FROM email_tokens WHERE user_id=$1 AND kind=$2",
            [t.user_id, action === "verify" ? "verify" : "reset"],
          );
        });
        json(res, 200, {
          msg:
            action === "verify"
              ? "邮箱验证成功，请登录或刷新账户状态"
              : "密码已重置，所有会话已退出，请重新登录",
        });
        return true;
      }
    }
    if (path.startsWith("/api/history")) {
      const u = await requireUser(req);
      const id = path.split("/")[3];
      if (id && !z.string().uuid().safeParse(id).success)
        fail(404, "记录不存在");
      if (req.method === "POST" && !id) {
        const snap = z
          .object({
            key: z.string().uuid(),
            ownerId: z.string().uuid(),
            product: z
              .object({
                pid: z.string().min(1).max(100),
                name: z.string().max(1000).nullable(),
                analysis: z.record(z.string(), z.unknown()),
              })
              .passthrough(),
            comments: z.array(z.record(z.string(), z.unknown())).max(20000),
          })
          .parse(b);
        if (snap.ownerId !== u.id) fail(409, "账户已切换，未保存此任务");
        const saved = await transaction(async (c) => {
          const r = await c.query(
            "INSERT INTO saved_runs(id,user_id,idempotency_key,product,engine_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id",
            [
              randomUUID(),
              u.id,
              snap.key,
              snap.product,
              String(
                snap.product.analysis.engine_version || "lexicon-blend/18",
              ),
            ],
          );
          const run = r.rows[0];
          if (!run)
            return (
              await c.query(
                "SELECT id FROM saved_runs WHERE user_id=$1 AND idempotency_key=$2",
                [u.id, snap.key],
              )
            ).rows[0];
          await c.query(
            "INSERT INTO saved_comments(run_id,ordinal,data) SELECT $1,ordinality-1,value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY",
            [run.id, JSON.stringify(snap.comments)],
          );
          return run;
        });
        json(res, 200, saved);
        return true;
      }
      if (req.method === "GET" && !id) {
        const page = Math.max(
          1,
          Math.min(
            100000,
            Math.floor(Number(url.searchParams.get("page")) || 1),
          ),
        );
        const q = (url.searchParams.get("q") || "").slice(0, 200),
          source = (url.searchParams.get("source") || "").slice(0, 100);
        const args = [u.id, `%${q}%`, source];
        const where = `user_id=$1 AND (product->>'name' ILIKE $2 OR product->>'pid' ILIKE $2 OR EXISTS(SELECT 1 FROM saved_comments c WHERE c.run_id=saved_runs.id AND (c.data->>'text' ILIKE $2 OR c.data->>'text_full' ILIKE $2))) AND ($3='' OR product->>'source'=$3)`;
        const total = (
          await pool.query(
            `SELECT count(*) FROM saved_runs WHERE ${where}`,
            args,
          )
        ).rows[0].count;
        const rows = (
          await pool.query(
            `SELECT id,product->>'pid' pid,product->>'name' name,product->>'source' source,created_at,(SELECT count(*) FROM saved_comments WHERE run_id=saved_runs.id) comments_count FROM saved_runs WHERE ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET $4`,
            [...args, (page - 1) * 20],
          )
        ).rows;
        json(res, 200, { rows, total: Number(total), page });
        return true;
      }
      if (id && ["GET", "DELETE"].includes(req.method)) {
        if (req.method === "DELETE") {
          const r = await pool.query(
            "DELETE FROM saved_runs WHERE id=$1 AND user_id=$2 RETURNING id",
            [id, u.id],
          );
          if (!r.rowCount) fail(404, "记录不存在");
          json(res, 200, { ok: true });
          return true;
        }
        const r = (
          await pool.query(
            "SELECT id,product,created_at,idempotency_key FROM saved_runs WHERE id=$1 AND user_id=$2",
            [id, u.id],
          )
        ).rows[0];
        if (!r) fail(404, "记录不存在");
        const comments = (
          await pool.query(
            "SELECT data FROM saved_comments WHERE run_id=$1 ORDER BY ordinal",
            [id],
          )
        ).rows.map((r) => r.data);
        json(res, 200, {
          cloudKey: r.idempotency_key,
          cloudRunId: r.id,
          product: r.product,
          comments,
          savedAt: new Date(r.created_at).getTime(),
        });
        return true;
      }
    }
    fail(404, "接口不存在");
  } catch (e) {
    json(res, e instanceof z.ZodError ? 422 : e.status || 503, {
      msg:
        e instanceof z.ZodError
          ? path.startsWith("/api/history")
            ? "云记录格式不正确，单份最多支持 20000 条评论"
            : "输入格式不正确，密码需为 12–128 个字符"
          : e.status
            ? e.message
            : "账户服务暂不可用，请稍后重试",
    });
    return true;
  }
}
