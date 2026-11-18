import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import { createServer as httpServer } from "node:http";
import { execFileSync } from "node:child_process";
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    "TEST_DATABASE_URL must point to an isolated real PostgreSQL database",
  );
const admin = new pg.Pool({ connectionString: database });
const schema = "test_" + randomUUID().replaceAll("-", "");
await admin.query(`CREATE SCHEMA ${schema}`);
const dburl = new URL(database);
dburl.searchParams.set("options", `-c search_path=${schema}`);
process.env.DATABASE_URL = dburl.toString();
process.env.NODE_ENV = "test";
process.env.APP_BASE_URL = "http://127.0.0.1:53187";
process.env.MAIL_TRANSPORT = "capture";
process.env.PORT = "53187";
process.env.HOST = "127.0.0.1";
delete process.env.DDV_ACCESS_PASSPHRASE;
execFileSync(process.execPath, ["server/migrate.mjs"], { env: process.env });
execFileSync(process.execPath, ["server/migrate.mjs"], { env: process.env }); // repeatable migration runner
const { server } = await import("../server.mjs");
if (!server.listening)
  await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { capturedMail } = await import("../server/accounts.mjs");
const { pool } = await import("../server/db.mjs");
const digest = (t) => createHash("sha256").update(t).digest("hex");
const pass = "Test secure password 163!";
function client() {
  return {
    cookie: "",
    async req(
      path,
      body,
      method = body === undefined ? "GET" : "POST",
      origin = process.env.APP_BASE_URL,
    ) {
      const r = await fetch(base + path, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          cookie: this.cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.headers.get("set-cookie"))
        this.cookie = r.headers.get("set-cookie").split(";")[0];
      return { status: r.status, data: await r.json(), headers: r.headers };
    },
  };
}
function lastToken() {
  return new URL(capturedMail.at(-1).text.split("\n")[1]).hash.slice(1);
}
async function signup(c, email) {
  const r = await c.req("/api/auth/signup", { email, password: pass });
  assert.equal(r.status, 200);
  return lastToken();
}
async function login(c, email, password = pass) {
  const r = await c.req("/api/auth/login", { email, password });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  return r.data.user;
}
test("real PostgreSQL account lifecycle and owner-isolated complete snapshots", async () => {
  const a = client(),
    b = client(),
    anon = client();
  assert.equal(
    (await anon.req("/api/relay", { action: "list", pid: "1" })).status,
    401,
  );
  assert.equal((await anon.req("/api/history")).status, 401);
  assert.equal(
    (await anon.req("/api/auth/signup", { email: "bad", password: "short" }))
      .status,
    422,
  );
  let verification = await signup(a, "Reader@QQ.com");
  assert.equal(capturedMail.at(-1).to, "reader@qq.com");
  assert.match(capturedMail.at(-1).subject, /验证/);
  const firstMailCount = capturedMail.length;
  assert.equal(
    (
      await a.req("/api/auth/signup", {
        email: "reader@qq.com",
        password: pass,
      })
    ).status,
    200,
  );
  assert.equal(capturedMail.length, firstMailCount + 1);
  let u = await login(a, "reader@qq.com");
  assert.equal(u.verified, false);
  assert.equal(
    (await a.req("/api/relay", { action: "list", pid: "1" })).status,
    403,
  );
  assert.equal((await a.req("/api/history")).status, 403);
  assert.equal(
    (await a.req("/api/auth/resend", { email: u.email })).status,
    200,
  );
  verification = lastToken();
  await pool.query(
    "UPDATE email_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [digest(verification)],
  );
  assert.equal(
    (await a.req("/api/auth/verify", { token: verification })).status,
    400,
  );
  await a.req("/api/auth/resend", { email: u.email });
  verification = lastToken();
  assert.equal(
    (await a.req("/api/auth/verify", { token: verification })).status,
    200,
  );
  assert.equal(
    (await a.req("/api/auth/verify", { token: verification })).status,
    400,
  );
  assert.equal((await a.req("/api/auth/me")).data.user.verified, true);
  assert.equal(
    (
      await a.req("/api/relay", {
        action: "prime",
        url: "https://taobao.com/item.htm?id=29871753",
      })
    ).status,
    422,
  );
  process.env.DDV_ACCESS_PASSPHRASE = "test-owner-gate";
  try {
    assert.equal((await a.req("/api/session")).data.gated, true);
    assert.equal(
      (
        await a.req("/api/relay", {
          action: "prime",
          url: "https://taobao.com/item.htm?id=29871753",
        })
      ).data.error,
      "pass_required",
    );
    assert.equal(
      (
        await anon.req("/api/analyze", {
          comments: [{ text: "印刷清晰", score: 10 }],
        })
      ).status,
      200,
    );
    const gate = await fetch(base + "/api/session", {
      method: "POST",
      headers: {
        origin: process.env.APP_BASE_URL,
        "content-type": "application/json",
      },
      body: JSON.stringify({ passphrase: "test-owner-gate" }),
    });
    const response = await fetch(base + "/api/relay", {
      method: "POST",
      headers: {
        origin: process.env.APP_BASE_URL,
        "content-type": "application/json",
        cookie: a.cookie + "; " + gate.headers.get("set-cookie").split(";")[0],
      },
      body: JSON.stringify({
        action: "prime",
        url: "https://taobao.com/item.htm?id=29871753",
      }),
    });
    assert.equal(response.status, 422);
  } finally {
    delete process.env.DDV_ACCESS_PASSPHRASE;
  }

  const vb = await signup(b, "other@163.com");
  await b.req("/api/auth/verify", { token: vb });
  const ub = await login(b, "other@163.com");
  const comments = Array.from({ length: 601 }, (_, i) => ({
    cid: String(i),
    text: "列表全文 " + i,
    text_full: "完整评论 印刷清晰 " + i,
    score: 10,
    date: "2026-11-18",
    variant: "精装",
    user: "读者",
    level: "金卡",
    has_img: true,
    is_auto: false,
    sentiment: "pos",
    detail_url: "https://comment.dangdang.com/comment/detail/0/123/" + i,
    pics: [
      {
        th: "https://img.ddimg.cn/a_p.jpg",
        big: "https://img.ddimg.cn/a_e.jpg",
      },
    ],
  }));
  const product = {
    pid: "123",
    name: "测试图书",
    url: "https://product.dangdang.com/123.html",
    image: "https://img.ddimg.cn/book.jpg",
    price: "25.00",
    source: "import",
    collected_at: Date.now(),
    comments_count: 601,
    site: { pageCount: 37 },
    analysis: {
      total: 601,
      engine: "lexicon-blend (portable)",
      note_partial: "部分采集",
      note_sample: "测试样例",
      site: { total_comment_num: 1000 },
    },
  };
  const snap = { ownerId: u.id, key: randomUUID(), product, comments };
  assert.equal(
    (await a.req("/api/history", snap, "POST", "https://attacker.invalid"))
      .status,
    403,
  );
  assert.equal((await b.req("/api/history", snap)).status, 409);
  const parallelSaves = await Promise.all([
    a.req("/api/history", snap),
    a.req("/api/history", snap),
  ]);
  assert.equal(parallelSaves[0].data.id, parallelSaves[1].data.id);
  const r = await a.req("/api/history", snap);
  assert.equal(r.status, 200);
  const id = r.data.id;
  assert.equal((await a.req("/api/history", snap)).data.id, id);
  const restored = await a.req("/api/history/" + id);
  assert.deepEqual(restored.data.comments, comments);
  assert.deepEqual(restored.data.product, product);
  assert.equal((await b.req("/api/history/" + id)).status, 404);
  assert.equal(
    (await b.req("/api/history/" + id, undefined, "DELETE")).status,
    404,
  );
  assert.equal((await b.req("/api/history")).data.total, 0);
  assert.equal(
    (await a.req("/api/history?q=" + encodeURIComponent("清晰"))).data.total,
    1,
  );
  assert.equal((await a.req("/api/history?source=relay")).data.total, 0);
  assert.equal((await a.req("/api/history?page=2")).data.rows.length, 0);
  const second = await a.req("/api/history", { ...snap, key: randomUUID() });
  assert.notEqual(second.data.id, id);
  assert.equal((await a.req("/api/history")).data.total, 2);
  assert.equal(
    (await a.req("/api/history/" + id, undefined, "DELETE")).status,
    200,
  );
  assert.equal((await a.req("/api/history/" + id)).status, 404);
  await pool.query(
    "INSERT INTO saved_runs(id,user_id,idempotency_key,product,engine_version) SELECT gen_random_uuid(),$1,gen_random_uuid(),$2,'lexicon-blend/18' FROM generate_series(1,21)",
    [u.id, product],
  );
  assert.equal((await a.req("/api/history")).data.rows.length, 20);
  assert.equal((await a.req("/api/history?page=2")).data.rows.length, 2);

  const staleCookie = a.cookie;
  await a.req("/api/auth/logout", {});
  a.cookie = staleCookie;
  assert.equal((await a.req("/api/auth/me")).data.user, null);
  await login(a, "reader@qq.com");
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [u.id],
  );
  assert.equal((await a.req("/api/history")).status, 401);
  await login(a, "reader@qq.com");
  const parallel = client();
  await login(parallel, "reader@qq.com");
  await a.req("/api/auth/forgot", { email: u.email });
  const expired = lastToken();
  await pool.query(
    "UPDATE email_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [digest(expired)],
  );
  assert.equal(
    (await a.req("/api/auth/reset", { token: expired, password: pass + "new" }))
      .status,
    400,
  );
  await a.req("/api/auth/forgot", { email: u.email });
  const reset = lastToken();
  assert.equal(
    (await a.req("/api/auth/reset", { token: reset, password: pass + "new" }))
      .status,
    200,
  );
  assert.equal(
    (await a.req("/api/auth/reset", { token: reset, password: pass + "new" }))
      .status,
    400,
  );
  assert.equal((await parallel.req("/api/auth/me")).data.user, null);
  assert.equal(
    (await a.req("/api/auth/login", { email: u.email, password: pass })).status,
    401,
  );
  await login(a, u.email, pass + "new");
  const unknown = await b.req("/api/auth/forgot", {
    email: "nobody@example.com",
  });
  assert.equal(unknown.status, 200);
  const known = await b.req("/api/auth/forgot", { email: ub.email });
  assert.deepEqual(unknown.data, known.data);
  const db = await pool.query("SELECT password_hash FROM users WHERE id=$1", [
    u.id,
  ]);
  assert.match(db.rows[0].password_hash, /^scrypt\$/);
  assert.ok(!db.rows[0].password_hash.includes(pass));
  assert.equal(
    (await pool.query("SELECT token_hash FROM sessions")).rows.some(
      (r) => r.token_hash === a.cookie.split("=")[1],
    ),
    false,
  );
  for (let i = 0; i < 8; i++)
    await anon.req("/api/auth/forgot", { email: "rate@example.com" });
  assert.equal(
    (await anon.req("/api/auth/forgot", { email: "rate@example.com" })).status,
    429,
  );
});
test("SMTP unavailable is reported and failed email tokens are removed", async () => {
  process.env.MAIL_TRANSPORT = "smtp";
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
  const { accounts } = await import("../server/accounts.mjs?smtp-failure-test");
  const server = httpServer(async (req, res) => {
    await accounts(
      req,
      res,
      new URL(req.url, "http://localhost"),
      async (req) => {
        let b = "";
        for await (const c of req) b += c;
        return b;
      },
      (res, status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      },
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const before = Number(
      (await pool.query("SELECT count(*) FROM email_tokens")).rows[0].count,
    );
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/auth/forgot`,
      {
        method: "POST",
        headers: {
          origin: process.env.APP_BASE_URL,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "other@163.com" }),
      },
    );
    assert.equal(r.status, 503);
    assert.match((await r.json()).msg, /未确认送达/);
    assert.equal(
      Number(
        (await pool.query("SELECT count(*) FROM email_tokens")).rows[0].count,
      ),
      before,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env.MAIL_TRANSPORT = "capture";
  }
});

test("production sessions set Secure cookies", async () => {
  const oldBase = process.env.APP_BASE_URL;
  process.env.NODE_ENV = "production";
  process.env.APP_BASE_URL = "https://voice.example.cn";
  process.env.MAIL_TRANSPORT = "smtp";
  const { accounts } =
    await import("../server/accounts.mjs?production-cookie-test");
  const endpoint = httpServer(async (req, res) => {
    await accounts(
      req,
      res,
      new URL(req.url, "http://localhost"),
      async (req) => {
        let b = "";
        for await (const c of req) b += c;
        return b;
      },
      (res, status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      },
    );
  });
  await new Promise((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  try {
    const r = await fetch(
      `http://127.0.0.1:${endpoint.address().port}/api/auth/login`,
      {
        method: "POST",
        headers: {
          origin: process.env.APP_BASE_URL,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "other@163.com", password: pass }),
      },
    );
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie"), /; Secure/);
  } finally {
    await new Promise((resolve) => endpoint.close(resolve));
    process.env.NODE_ENV = "test";
    process.env.APP_BASE_URL = oldBase;
    process.env.MAIL_TRANSPORT = "capture";
  }
});

test(
  "desktop/mobile account UI, cloud restore, sign-out and late response isolation",
  { skip: process.env.RUN_BROWSER_TESTS !== "1" },
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE
        ? { executablePath: process.env.BROWSER_EXECUTABLE }
        : {}),
      args: ["--no-sandbox"],
    });
    try {
      const c = client(),
        address = "browser@qq.com";
      await signup(c, address);
      const verificationLink = capturedMail.at(-1).text.split("\n")[1];
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(verificationLink);
      await page.getByRole("button", { name: "验证邮箱", exact: true }).click();
      await page
        .getByText("邮箱验证成功，请登录或刷新账户状态", { exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(new URL(page.url()).searchParams.has("auth"), false);
      await page.getByLabel("邮箱（支持 QQ 邮箱、163 邮箱等）").fill(address);
      await page.getByLabel("密码（12–128 个字符）").fill(pass);
      await page
        .getByRole("button", { name: "登录", exact: true })
        .last()
        .click();
      await page
        .getByText(address + " · 邮箱已验证", { exact: true })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page
        .getByRole("button", { name: "体验公开样例（无需登录）" })
        .click();
      await page.locator("#desk").waitFor();
      await page
        .getByRole("button", { name: "保存当前结果 / 重试云端保存" })
        .click();
      await page.getByText("已保存到当前账户云端", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "恢复声纹台", exact: true })
        .first()
        .waitFor();
      // A repeated explicit save uses the same key even after success.
      await page
        .getByRole("button", { name: "保存当前结果 / 重试云端保存" })
        .click();
      await login(c, address);
      assert.equal((await c.req("/api/history")).data.total, 1);
      await page
        .getByRole("button", { name: "恢复声纹台", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page
        .getByRole("button", { name: "登录 / 注册", exact: true })
        .count();
      await page.waitForFunction(() => !document.querySelector("#desk")); // cloud desk clears
      // Sign back in and hold a restore response across logout.
      await page.getByLabel("邮箱（支持 QQ 邮箱、163 邮箱等）").fill(address);
      await page.getByLabel("密码（12–128 个字符）").fill(pass);
      await page
        .getByRole("button", { name: "登录", exact: true })
        .last()
        .click();
      await page
        .getByText(address + " · 邮箱已验证", { exact: true })
        .waitFor();
      let release, started;
      const pending = new Promise((r) => (started = r)),
        hold = new Promise((r) => (release = r));
      await page.route("**/api/history/*", async (route) => {
        const response = await route.fetch();
        started();
        await hold;
        await route.fulfill({ response });
      });
      await page
        .getByRole("button", { name: "恢复声纹台", exact: true })
        .first()
        .click();
      await pending;
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.getByRole("heading", { name: "登录", exact: true }).waitFor();
      release();
      await page.waitForTimeout(300);
      assert.equal(await page.locator("#desk").count(), 0);
      assert.equal(await page.locator(".cloud-history").count(), 0);
      await page.unroute("**/api/history/*");
      await page.getByLabel("邮箱（支持 QQ 邮箱、163 邮箱等）").fill(address);
      await page.getByLabel("密码（12–128 个字符）").fill(pass);
      await page
        .getByRole("button", { name: "登录", exact: true })
        .last()
        .click();
      await page
        .getByText(address + " · 邮箱已验证", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "体验公开样例（无需登录）" })
        .click();
      await page.locator("#desk").waitFor();
      await pool.query(
        "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)",
        [address],
      );
      await page
        .getByRole("button", { name: "保存当前结果 / 重试云端保存" })
        .click();
      await page.getByRole("heading", { name: "登录", exact: true }).waitFor();
      assert.equal(await page.locator("#desk").count(), 1); // expiry preserves unsaved public result
      assert.equal(
        await page.getByRole("button", { name: "⬇ 完整档案 JSON" }).count(),
        1,
      );
      await c.req("/api/auth/forgot", { email: address });
      await page.goto(capturedMail.at(-1).text.split("\n")[1]);
      const replacement = "Browser reset password 163!";
      await page.getByLabel("密码（12–128 个字符）").fill(replacement);
      await page
        .getByRole("button", { name: "设置新密码", exact: true })
        .click();
      await page
        .getByText("密码已重置，所有会话已退出，请重新登录", { exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).hash, "");
      await page.getByLabel("邮箱（支持 QQ 邮箱、163 邮箱等）").fill(address);
      await page.getByLabel("密码（12–128 个字符）").fill(replacement);
      await page
        .getByRole("button", { name: "登录", exact: true })
        .last()
        .click();
      await page
        .getByText(address + " · 邮箱已验证", { exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
