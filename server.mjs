import {collectionLease} from './server/collection-lease.mjs';
import {logProductionStatus} from "./server/production-status.mjs";
import {pool} from "./server/db.mjs";
import {adminAPI} from "./server/admin-api.mjs";
import {enterpriseAPI} from './server/enterprise-api.mjs';
import {aiAPI} from './server/ai-api.mjs';
import { accounts, requireUser, checkOrigin, canonicalRequest, initializeCsrf, appOrigin } from './server/accounts.mjs';
/**
 * dangdangvoice — QW Pages dynamic server. Collection remains stateless;
 * accounts and owned cloud snapshots use an external PostgreSQL database.
 * Entry: starts HTTP on process.env.HOST/PORT; /healthz first, API next, SPA after.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------ config
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BASE = "https://product.dangdang.com/index.php";
const MAX_BROWSE_PAGES = 37;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

// [scraper] — pid extraction, egress probe, list/detail fetch + cheerio parsing
// [analysis] — lexicon sentiment, themes, keywords, variants, trend, advice
// [store] — jobs/products maps, CSV/JSON import, CSV export builder

// ---------------------------------------------------------------- scraper
import {htmlAccessFailure,parseListResponse,parseDetailHtml,parseProductMeta,retryAfterMs,relayError} from "./server/collection-parser.mjs";



// NOTE: mirrors canonical client logic in src/url.ts  ── edit both together.
// The published bundle may contain exactly one server file (.qw-pages runtime
// contract), so the guard cannot import the client module.
function extractPid(input) {
  const u = String(input || "").trim();
  if (!u) return null;
  if (/^\d{5,}$/.test(u)) return u;
  // host gate FIRST (mirrors src/url.ts): never mine ids from foreign domains
  if (!/^(?:https?:\/\/)?(?:[\w-]+\.)*dangdang\.com(?::\d{1,5})?(?:[/?#]|$)/i.test(u)) return null;
  const m =
    u.match(/\/(\d{5,})\.html/i) ||
    u.match(/[?&](?:pid|product_?id|productid|productId|mainProductId|id|ddkey)=(\d{5,})/i) ||
    u.match(/\/comment\/detail\/\d+\/(\d{5,})\//i);
  if (m) return m[1];
  const runs = (u.match(/\d{5,}\.html/i) || []).map((x) => x.slice(0, -5));
  if (runs.length) return runs.sort((a, b) => b.length - a.length)[0];
  const runs2 = u.match(/\d{5,}/g);
  return runs2 ? runs2.sort((a, b) => b.length - a.length)[0] : null;
}

// ---- request-scoped cookie jar, exchanged as an opaque array through the client.
// The WAF challenge page itself issues acw_tc/secret_key cookies; replaying them
// keeps the JSON endpoint in observe mode. Nothing sticky lives on the server,
// so any FC instance can serve any step.
function jarFromList(list) {
  const jar = new Map();
  for (const c of Array.isArray(list) ? list : []) {
    if (c && c.s && c.n && c.v) jar.set(`${c.s}|${c.n}`, String(c.v).slice(0, 4096));
  }
  return jar;
}
function jarToList(jar) {
  const out = [];
  for (const [key, v] of jar) {
    const i = key.lastIndexOf("|");
    out.push({ s: key.slice(0, i), n: key.slice(i + 1), v });
  }
  return out.slice(0, 40);
}
function absorbCookies(jar, res, reqHost) {
  let lines = [];
  try { lines = res.headers.getSetCookie ? res.headers.getSetCookie() : []; } catch { /* ignore */ }
  for (const line of lines) {
    const parts = String(line).split(";");
    const kv = parts[0];
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const name = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    if (!name || !value) continue;
    const domAttr = parts.slice(1).map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("domain="));
    const scope = domAttr ? domAttr.split("=")[1].replace(/^\.*/, "") : reqHost;
    jar.set(`${scope}|${name}`, value);
  }
}
function jarHeaderFor(jar, host) {
  const out = [];
  for (const [key, value] of jar) {
    const i = key.lastIndexOf("|");
    const scope = key.slice(0, i), name = key.slice(i + 1);
    if (host === scope || host.endsWith(`.${scope}`)) out.push(`${name}=${value}`);
  }
  return out.join("; ");
}

async function scopedFetch(jar, url, opts = {}) {
  const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || "";
  const headers = {
    "user-agent": UA,
    "accept-language": "zh-CN,zh;q=0.9",
    ...(opts.ajx ? { "ajax-request": "yes", referer: opts.referer || "https://product.dangdang.com/" } : opts.referer ? { referer: opts.referer } : {}),
  };
  const cookie = jarHeaderFor(jar, host);
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { headers, redirect: "follow", signal: opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(opts.timeout ?? 15_000)]):AbortSignal.timeout(opts.timeout ?? 15_000) });
  absorbCookies(jar, res, host);
  const contentType=(res.headers.get('content-type')||'').split(';')[0].trim().toLowerCase().slice(0,120);
  if (!res.ok) { await res.body?.cancel(); throw Object.assign(new Error('upstream_http_error'), {code:`upstream_http_${res.status}`,httpStatus:res.status,retryAfterMs:retryAfterMs(res.headers.get('retry-after')),contentType}); }
  const data=opts.bytes?Buffer.from(await res.arrayBuffer()):await res.text();
  opts.onResponse?.({httpStatus:res.status,contentType,responseLength:data.length,responseLengthUnit:opts.bytes?'bytes':'characters',retryAfterMs:retryAfterMs(res.headers.get('retry-after'))});
  return data;
}

function listUrlFor(pid, pageIndex) {
  const q = new URLSearchParams({
    r: "comment/list", productId: pid, mainProductId: pid, mediumId: "0",
    pageIndex: String(pageIndex), sortType: "1", filterType: "1", isSystem: "1",
    tagId: "0", tagFilterCount: "0", template: "publish",
  });
  return `${BASE}?${q}`;
}

// ---------------------------------------------------------------- analysis
// Deterministic portable engine: curated Dangdang-domain lexicon + star prior.
const NEG = {
  盗版: 0.45, 假冒: 0.4, 假货: 0.4, 影印: 0.35, 复印: 0.3, 模糊: 0.28, 不清楚: 0.25,
  错字: 0.3, 错别字: 0.3, 漏页: 0.35, 缺页: 0.35, 掉色: 0.3, 破损: 0.25, 烂: 0.3,
  脏: 0.2, 折: 0.12, 皱: 0.2, 慢: 0.18, 太久: 0.22, 失望: 0.35, 差: 0.22, 垃圾: 0.45,
  贵: 0.12, 不值: 0.25, 后悔: 0.35, 退款: 0.25, 投诉: 0.3, 色差: 0.25, 味道: 0.2,
  刺鼻: 0.25, 劣质: 0.4, 质量差: 0.45, 不推荐: 0.4, 别买: 0.45, 凑活: 0.3, 凑合: 0.25,
  变形: 0.25, 划痕: 0.2, 污渍: 0.25, 翘边: 0.2, 散架: 0.35, 少了: 0.2, 发错: 0.3,
};
const POS = {
  很好: 0.2, 不错: 0.18, 正版: 0.22, 清晰: 0.2, 完整: 0.12, 满意: 0.25, 喜欢: 0.2,
  推荐: 0.18, 好评: 0.25, 实惠: 0.18, 便宜: 0.15, 快: 0.12, 包装好: 0.2, 精致: 0.18,
  精美: 0.18, 完好: 0.15, 全新: 0.12, 感谢: 0.15, 完美: 0.3, 惊喜: 0.25, 值得: 0.2,
  优质: 0.22, 棒: 0.2, 赞: 0.2, 好看: 0.18, 厚实: 0.15, 顺畅: 0.15, 给力: 0.2,
};
const NEG_PAT = /(不[太好行]|没有|没什么|欠缺|有点失望|不太满意|不喜欢|并不是)/;
const THEMES = {
  内容质量: ["内容", "印刷", "纸张", "纸质", "装帧", "排版", "质量", "清晰", "模糊", "错别字", "色彩", "版本", "翻译", "编排"],
  正版真伪: ["正版", "盗版", "假冒", "假货", "影印", "复印", "真伪", "鉴定", "授权"],
  价格: ["价格", "便宜", "实惠", "贵", "划算", "性价比", "优惠", "活动", "打折", "值"],
  物流: ["物流", "快递", "发货", "配送", "到货", "速度", "运输", "邮寄", "送到"],
  包装: ["包装", "完好", "破损", "盒子", "塑封", "纸箱", "压", "褶皱"],
  服务: ["客服", "服务", "态度", "售后", "退", "换", "投诉", "商家"],
};
const RED_FLAGS = ["盗版", "影印", "复印", "缺页", "漏页", "质量差", "假货", "掉色", "散架"];
const AUTO_RE = /(默认好评|系统默认|此用户未发现|暂未填写|此用户未填写)/;
const FUNC_CHARS = new Set("的了是在和也都就我你他她它与人这那有没不么呢吗啊呀很更太还及或等着到之为以于而且但被把让给做去来对能可能会应该要是那样此".split(""));
const STOP = new Set(["可以", "没有", "什么", "这样", "那么", "自己", "一个", "一直", "一般", "不是", "就是", "还是", "已经", "觉得", "感觉", "应该", " book".trim(), "商品", "东西", "购买", "使用", "当当", "评论"]);

const NEGATORS = ["不", "没", "无", "别", "难", "缺乏"];
const AMPLIFIERS = ["很", "非常", "太", "超", "特别", "真", "十分", "尤其", "越"];
const DIMINISHERS = ["有点", "有些", "稍微", "略有", "一点"];
function _polarityOf(pre, v) {
  const negated = NEGATORS.some((n) => pre.includes(n));
  const amp = AMPLIFIERS.some((n) => pre.includes(n)) ? 1.3 : DIMINISHERS.some((n) => pre.includes(n)) ? 0.6 : 1;
  return { val: v * amp, negated };
}
// scanLex: window-aware, occurrence-aware lexicon pass. "不模糊" reads positive,
// "有点贵" is a softened complaint; multiple distinct complaints accumulate.
function scanLex(text) {
  let pos = 0, neg = 0, terms = 0;
  for (const [w, v] of Object.entries(POS)) {
    for (let i = text.indexOf(w); i > -1; i = text.indexOf(w, i + w.length)) {
      const pre = text.slice(Math.max(0, i - 4), i);
      const { val, negated } = _polarityOf(pre, v);
      if (negated) neg += val * 0.7; else pos += val;
      terms++;
    }
  }
  for (const [w, v] of Object.entries(NEG)) {
    for (let i = text.indexOf(w); i > -1; i = text.indexOf(w, i + w.length)) {
      const pre = text.slice(Math.max(0, i - 4), i);
      const { val, negated } = _polarityOf(pre, v);
      if (negated) pos += val * 0.7; else neg += val * (pre.includes("太") || pre.includes("又") ? 1.15 : 1);
      terms++;
    }
  }
  return { pos, neg, terms };
}
function lexScore(text) {
  if (!text) return 0.5;
  const { pos, neg, terms } = scanLex(text);
  if (!terms) {
    if (/[?？]{2,}/.test(text) && /[!！]/.test(text)) return 0.42;
    if (/[!！]{2,}/.test(text)) return 0.58;
    return 0.5;
  }
  let sc = 0.5 + 0.42 * Math.tanh((pos - neg) * 2.4);
  if (NEG_PAT.test(text) && sc >= 0.5) sc -= 0.04;
  return Math.max(0.02, Math.min(0.98, sc));
}
const rateNorm = (score) => (score == null ? null : Math.max(0, Math.min(1, score / 10)));
const isAuto = (text) => AUTO_RE.test(text || "") || !(text || "").trim();

function classify(text, score) {
  const lex = lexScore(text || "");
  const parts = [{ p: lex, w: (text || "").trim().length > 1 ? 0.55 : 0.35 }];
  const rn = rateNorm(score);
  if (rn != null) parts.push({ p: rn, w: 0.45 });
  const conf = parts.reduce((a, x) => a + x.p * x.w, 0) / parts.reduce((a, x) => a + x.w, 0);
  return conf >= 0.63 ? ["pos", conf] : conf <= 0.42 ? ["neg", conf] : ["neu", conf];
}

function ngrams(text, bucket, maxN) {
  const clean = (text || "").replace(/[\s\p{P}\p{S}]+/gu, " ");
  for (const run of clean.split(" ")) {
    if (run.length < 2) continue;
    for (let n = 2; n <= Math.min(3, run.length, 4); n++) {
      for (let i = 0; i + n <= run.length; i++) {
        const g = run.slice(i, i + n);
        if (STOP.has(g)) continue;
        if ([...g].every((c) => FUNC_CHARS.has(c))) continue;
        if (/^\d+$/.test(g)) continue;
        bucket.set(g, (bucket.get(g) || 0) + 1);
      }
    }
  }
}

function keywordsFrom(comments) {
  const pos = new Map(); const neg = new Map();
  for (const c of comments) {
    if (c.is_auto || (c.text_full || c.text || "").trim().length < 4) continue;
    ngrams(c.text_full || c.text || "", c.sentiment === "pos" ? pos : c.sentiment === "neg" ? neg : new Map(), 3);
  }
  const top = (m) => [...m.entries()].filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length * b[1] - a[0].length * a[1])
    .slice(0, 24).map(([w, n]) => [w, n]);
  // drop substrings dominated by longer equal-count grams
  const dedupe = (list) => list.filter(([w, n]) => !list.some(([v, vn]) => v !== w && v.length > w.length && v.includes(w) && vn >= n));
  return [dedupe(top(pos)), dedupe(top(neg))];
}

function analyze(comments) {
  const total = comments.length;
  if (!total) return {
    total: 0, meaningful: 0, auto_reviews: 0, auto_share: 0, image_reviews: 0, avg_score: null,
    labels: { pos: 0, neu: 0, neg: 0 }, pos_rate: 0, neg_rate: 0, score_hist: {}, themes: [],
    top_neg_themes: [], pos_words: [], neg_words: [], red_flags: [], red_flag_count: 0,
    variants: [], trend: [], examples_pos: [], examples_neg: [], engine: "lexicon-blend (portable)",
  };
  const labels = { pos: 0, neu: 0, neg: 0 };
  const themeCounter = new Map(); const themeLabel = new Map(); const negThemes = new Map();
  const redFlags = []; let autoCt = 0; let imgCt = 0;
  const byVariant = new Map(); const monthly = new Map(); const scoreHist = new Map();
  const rated = []; const examplesPos = []; const examplesNeg = [];
  for (const c of comments) {
    const text = c.text_full || c.text || "";
    if (c.is_auto) autoCt++;
    if (c.has_img) imgCt++;
    if (c.score != null) { rated.push(c.score); scoreHist.set(c.score, (scoreHist.get(c.score) || 0) + 1); }
    labels[c.sentiment] = (labels[c.sentiment] || 0) + 1;
    for (const [th, kws] of Object.entries(THEMES)) {
      if (kws.some((k) => text.includes(k))) {
        themeCounter.set(th, (themeCounter.get(th) || 0) + 1);
        if (!themeLabel.has(th)) themeLabel.set(th, { pos: 0, neu: 0, neg: 0 });
        themeLabel.get(th)[c.sentiment]++;
        if (c.sentiment === "neg") negThemes.set(th, (negThemes.get(th) || 0) + 1);
      }
    }
    if (c.sentiment === "neg" && RED_FLAGS.some((r) => text.includes(r))) {
      redFlags.push({ text: text.slice(0, 120), flags: RED_FLAGS.filter((r) => text.includes(r)), date: c.date });
    }
    if (c.variant) {
      if (!byVariant.has(c.variant)) byVariant.set(c.variant, { n: 0, sum: 0, neg: 0 });
      const v = byVariant.get(c.variant);
      v.n++; v.sum += c.score ?? 6; if (c.sentiment === "neg") v.neg++;
    }
    const m = (c.date || "").slice(0, 7);
    if (m && /^[0-9]{4}-[0-9]{2}$/.test(m)) {
      if (!monthly.has(m)) monthly.set(m, { n: 0, sum: 0 });
      const mm = monthly.get(m); mm.n++; mm.sum += rateNorm(c.score) ?? 0.5;
    }
    if (text.length > 12) {
      if (c.sentiment === "pos" && examplesPos.length < 12) examplesPos.push(text);
      if (c.sentiment === "neg" && examplesNeg.length < 12) examplesNeg.push(text);
    }
  }
  const [posW, negW] = keywordsFrom(comments);
  const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
  const themes = [...themeCounter.entries()].sort((a, b) => b[1] - a[1]).map(([th, n]) => {
    const ld = themeLabel.get(th);
    return { theme: th, count: n, pos: ld.pos, neu: ld.neu, neg: ld.neg, neg_rate: +(ld.neg / n).toFixed(3) };
  });
  const meaningful = comments.filter((c) => !c.is_auto).length;
  return {
    total, meaningful, auto_reviews: autoCt, auto_share: +(autoCt / total).toFixed(3),
    image_reviews: imgCt, avg_score: avg ? +avg.toFixed(2) : null, labels,
    pos_rate: +(labels.pos / total).toFixed(3), neg_rate: +(labels.neg / total).toFixed(3),
    score_hist: Object.fromEntries([...scoreHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])),
    themes, top_neg_themes: [...negThemes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([theme, n]) => ({ theme, n })),
    pos_words: posW, neg_words: negW,
    red_flags: redFlags.slice(0, 20), red_flag_count: redFlags.length,
    variants: [...byVariant.entries()].filter(([, d]) => d.n >= 3)
      .map(([variant, d]) => ({ variant, n: d.n, avg: +(d.sum / d.n).toFixed(2), neg_rate: +(d.neg / d.n).toFixed(3) }))
      .sort((a, b) => b.n - a.n),
    trend: [...monthly.entries()].filter(([, d]) => d.n >= 2).sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
      .map(([month, d]) => ({ month, n: d.n, mood: +(d.sum / d.n).toFixed(3) })),
    examples_pos: examplesPos, examples_neg: examplesNeg,
    engine: "lexicon-blend (portable)",
  };
}

function recommendations(a, name) {
  const buyers = []; const sellers = [];
  const pos = a.pos_rate ?? 0; const neg = a.neg_rate ?? 0;
  if ((a.auto_share ?? 0) > 0.5) buyers.push({ icon: "⚠", title: `${Math.round(a.auto_share * 100)}% 的评论是系统默认好评`, body: "多数买家没有主动写内容，页面综合好评率被这些默认条目抬高。看真实评价时请只看带文字的短评，样本会小很多但更可信。" });
  if (a.avg_score) buyers.push({ icon: "★", title: `平均星级 ${a.avg_score}/10`, body: `在 ${a.meaningful} 条真实文字评论里，${Math.round(pos * 100)}% 偏正面、${Math.round(neg * 100)}% 偏负面。` });
  if ((a.red_flag_count ?? 0) >= 3) buyers.push({ icon: "🚩", title: `${a.red_flag_count} 条涉及真伪或质量红线`, body: "出现盗版/影印/缺页/掉色等关键词，收到后请先核对出版社信息与印刷质量。", risk: true });
  const th = Object.fromEntries((a.themes || []).map((t) => [t.theme, t]));
  if (th["价格"] && th["价格"].neg_rate < 0.2) buyers.push({ icon: "💰", title: "价格口碑良好", body: `${th["价格"].count} 条提到价格，负面比例低，活动入手较划算。` });
  if (th["物流"] && th["物流"].neg_rate > 0.3) buyers.push({ icon: "🚚", title: "物流体验偏慢", body: "物流相关评论里负面占比偏高，赶时间建议自提或关注发货地。", risk: true });
  const best = (a.variants || []).filter((v) => v.n >= 5).sort((x, y) => y.avg - x.avg)[0];
  if (best) buyers.push({ icon: "📚", title: `版本「${best.variant.slice(0, 22)}」口碑最好`, body: `平均分 ${best.avg}（${best.n} 条评论），如选择版本可按此优先。` });
  if (neg < 0.12) buyers.push({ icon: "✅", title: "整体可以入手", body: "真实评论负面占比较低，风险可控。" });
  if (!buyers.length) buyers.push({ icon: "🔍", title: "样本还太少", body: "先跑一次全量采集（或导入 CSV）再判断。" });

  if ((a.auto_share ?? 0) > 0.5) sellers.push({ action: "引导真实晒单", why: `${Math.round(a.auto_share * 100)}% 默认好评会稀释口碑`, how: `晒图奖励 / 追评提醒，把带图率从 ${Math.round((a.image_reviews || 0) / (a.total || 1) * 100)}% 持续抬高` });
  const play = {
    物流: ["换仓或改快递商", "关注 48h 发货达成率与破损率"],
    包装: ["加固包装", "书角护角 + 防水膜，减少运输破损"],
    价格: ["价签策略", "组合优惠替代直接降价，保住利润"],
    内容质量: ["核对批次", "印刷/缺页常集中在批次，找上游复核"],
    正版真伪: ["证明正版", "商品页放授权书/进货凭证，详情页首屏可见"],
    服务: ["培训客服", "差评 24h 内跟进回复，公开处理结果"],
  };
  for (const t of (a.top_neg_themes || []).slice(0, 3)) {
    const p = play[t.theme] || [`改善${t.theme}`, "查看该主题评论原文定位问题"];
    sellers.push({ action: p[0], why: `${t.theme}负面 ${t.n} 次`, how: p[1] });
  }
  if (a.red_flag_count) sellers.push({ action: "优先处理红线评论", why: `${a.red_flag_count} 条涉及真伪/质量关键词`, how: "逐条主动联系、换货，并回复评论以降低对潜在买家影响" });
  if (a.themes?.length) sellers.push({ action: "放大卖点", why: `「${a.themes.slice(0, 2).map((t) => t.theme).join("、")}」提及最多`, how: "把买家好评原话放进详情页主图文案" });
  return { buyers, sellers };
}

logProductionStatus('web');
const host = process.env.HOST || (process.env.VERCEL ? "127.0.0.1" : undefined);
const port = Number(process.env.PORT || (process.env.VERCEL ? 3000 : NaN));
if (!host) throw new Error("HOST is required");
if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error("PORT must be an integer between 1 and 65535");

const clientRoot = fileURLToPath(new URL("./dist/", import.meta.url));
const clientRootPrefix = clientRoot.endsWith(sep) ? clientRoot : `${clientRoot}${sep}`;
const indexPath = resolve(clientRoot, "index.html");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"], [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"],
  [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff" });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");

async function readBody(req, cap = 10_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > cap) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isInsideClientRoot(p) { return p === clientRoot || p.startsWith(clientRootPrefix); }
async function existingFile(p) {
  try { const st = await stat(p); return st.isFile() ? p : null; }
  catch (e) { if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null; throw e; }
}
async function serveAsset(pathname, res, method) {
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return send(res, 400, "Bad path", "text/plain; charset=utf-8"); }
  const rel = decoded.replace(/^\/+/, "") || "index.html";
  const candidate = resolve(clientRoot, rel);
  if (!isInsideClientRoot(candidate)) return send(res, 404, "Not Found", "text/plain; charset=utf-8");
  let file = await existingFile(candidate);
  if (!file && !extname(decoded)) file = await existingFile(indexPath);
  if (!file) return send(res, 404, "Not Found", "text/plain; charset=utf-8");
  const body = method === "HEAD" ? undefined : await readFile(file);
  send(res, 200, body, contentTypes.get(extname(file).toLowerCase()) ?? "application/octet-stream");
}

// [routes] — /healthz + /api/* handled before static/SPA fallback below


// ===================== V18 NLP upgrades: ABSA, quality, digest =====================
const ASPECT_DEF = [
  { zh: "印刷质量", kw: ["印刷", "字迹", "清晰", "模糊", "墨", "彩印", "重印", "错字", "错别字", "色差"] },
  { zh: "纸张装帧", kw: ["纸张", "纸质", "页数", "装帧", "精装", "平装", "硬壳", "线装", "胶装", "掉页", "散页", "书脊", "封面", "塑封"] },
  { zh: "内容翻译", kw: ["内容", "翻译", "文笔", "故事", "知识点", "排版", "编排", "插图", "注释", "删减", "章节", "译文"] },
  { zh: "正版真伪", kw: ["正版", "盗版", "影印", "复印", "扫描", "翻拍", "防伪", "授权"] },
  { zh: "物流速度", kw: ["物流", "快递", "发货", "配送", "到货", "运输", "邮寄", "送到", "签收"] },
  { zh: "包装品相", kw: ["包装", "压痕", "磕碰", "破损", "褶皱", "完好", "脏", "湿", "泡沫", "变形"] },
  { zh: "价格促销", kw: ["价格", "便宜", "实惠", "划算", "贵", "优惠", "活动", "打折", "券", "涨价"] },
  { zh: "客服售后", kw: ["客服", "售后", "回复", "处理", "退款", "换货", "投诉", "补偿", "发票"] },
  { zh: "赠品周边", kw: ["赠品", "藏书票", "书签", "明信片", "礼盒", "周边"] },
  { zh: "签名特装", kw: ["签名", "亲签", "钤印", "编号", "特装", "毛边", "刷边", "烫金"] },
];

function aspectScan(comments) {
  const acc = ASPECT_DEF.map((d) => ({ zh: d.zh, mentions: 0, pos: 0, neu: 0, neg: 0, qp: [], qn: [] }));
  let covered = 0;
  const real = comments.filter((c) => !c.is_auto);
  for (const c of real) {
    const t = String(c.text_full || c.text || "").trim();
    if (!t) continue;
    let any = false;
    acc.forEach((A, ai) => {
      const def = ASPECT_DEF[ai];
      let best = null;
      for (const kw of def.kw) {
        for (let i = t.indexOf(kw); i > -1; i = t.indexOf(kw, i + kw.length)) {
          const win = t.slice(Math.max(0, i - 8), Math.min(t.length, i + kw.length + 8));
          const { pos, neg } = scanLex(win);
          const pol = pos > 0.06 && pos >= neg ? "pos" : neg > 0.06 && neg > pos ? "neg" : "neu";
          const rank = pol === "neg" ? 3 : pol === "pos" ? 2 : 1;
          if (!best || rank > best.rank) best = { rank, pol };
          if (pol !== "neu" && t.length >= 10 && t.length <= 160) {
            const q = t.slice(0, 90);
            const arr = pol === "pos" ? A.qp : A.qn;
            if (arr.length < 3 && !arr.includes(q)) arr.push(q);
          }
        }
      }
      if (best) { any = true; A.mentions++; A[best.pol]++; }
    });
    if (any) covered++;
  }
  const items = acc.filter((A) => A.mentions >= 2).map((A) => ({
    zh: A.zh, mentions: A.mentions, pos: A.pos, neu: A.neu, neg: A.neg,
    satisfaction: Math.round(((A.pos + 0.5 * A.neu) / A.mentions) * 100),
    quotes: A.qp.slice(0, 3), qn: A.qn.slice(0, 3),
  })).sort((x, y) => y.mentions - x.mentions || y.neg - x.neg);
  return { items, coverageRate: +(covered / Math.max(1, real.length)).toFixed(3) };
}

const _dayMs = 86400000;
function _dates(comments) {
  return comments.map((c) => Date.parse(String(c.date || "").replace(/\./g, "-"))).filter((v) => Number.isFinite(v));
}
function dupRate(comments) {
  if (comments.length < 6) return 0;
  const norm = comments.map((c) => String(c.text_full || c.text || "").replace(/[\s\p{P}\p{S}]/gu, "")).filter((x) => x);
  if (norm.length < 6) return 0;
  return +(1 - new Set(norm).size / norm.length).toFixed(3);
}
function qualityMetrics(comments, a) {
  const texts = comments.map((c) => String(c.text_full || c.text || "").trim());
  const nonEmpty = texts.filter((x) => x);
  const avgLen = Math.round(nonEmpty.reduce((x, y) => x + y.length, 0) / Math.max(1, nonEmpty.length));
  const longRate = +(comments.filter((c) => { const t = String(c.text_full || c.text || ""); return t.length >= 60; }).length / Math.max(1, comments.length)).toFixed(3);
  const questionCount = texts.filter((x) => /[?？]/.test(x) && x.length > 4).length;
  const exclRate = +(comments.filter((c) => /[!！]/.test(String(c.text_full || c.text || ""))).length / Math.max(1, comments.length)).toFixed(3);
  const imgRate = +(a.image_reviews / Math.max(1, a.total)).toFixed(3);
  const dates = _dates(comments).sort((x, y) => x - y);
  let recent30Rate = null, recent90Rate = null, velocity = null;
  if (dates.length >= 3) {
    const anchor = dates[dates.length - 1];
    recent30Rate = +(dates.filter((d) => d >= anchor - 30 * _dayMs).length / dates.length).toFixed(3);
    recent90Rate = +(dates.filter((d) => d >= anchor - 90 * _dayMs).length / dates.length).toFixed(3);
    if (dates.length >= 6) {
      velocity = [];
      for (let k = 0; k < 4; k++) velocity.push(dates.filter((d) => d < anchor - k * 30 * _dayMs && d >= anchor - (k + 1) * 30 * _dayMs).length);
      velocity.reverse();
    }
  }
  const avgStar = a.avg_score != null ? +(a.avg_score / 10).toFixed(3) : null;
  const dictPos = a.total ? +(a.labels.pos / a.total).toFixed(3) : null;
  const gap = avgStar != null && dictPos != null ? +(avgStar - dictPos).toFixed(3) : null;
  return { avgLen, longRate, dupRate: dupRate(comments), questionCount, exclRate, imgRate,
    recent30Rate, recent90Rate, velocity, defaultShare: a.auto_share, avgStar, dictPos, gap };
}
function faqExtract(comments) {
  const qs = comments.map((c) => String(c.text_full || c.text || "").trim())
    .filter((t) => /[?？]/.test(t) && t.length > 4 && t.length <= 120);
  if (!qs.length) return [];
  const count = new Map();
  for (const t of qs) {
    let topic = "其他";
    for (const def of ASPECT_DEF) { if (def.kw.some((k) => t.includes(k))) { topic = def.zh; break; } }
    const cur = count.get(topic) || { count: 0, sample: t };
    cur.count++; if (t.length < cur.sample.length) cur.sample = t;
    count.set(topic, cur);
  }
  return [...count.entries()].map(([topic, d]) => ({ topic, count: d.count, sample: d.sample.slice(0, 60) }))
    .sort((x, y) => y.count - x.count).slice(0, 4);
}
function goldenQuotes(comments) {
  const out = [];
  const normSeen = new Set();
  const norm = (t) => t.replace(/[\s\p{P}\p{S}]/gu, "");
  for (const k of ["pos", "neg"]) {
    let best = null;
    for (const c of comments) {
      if (c.sentiment !== k || c.is_auto) continue;
      const t = String(c.text_full || c.text || "").trim();
      const L = t.length;
      if (L < 16 || L > 95) continue;
      const nz = norm(t);
      if (nz.length < 8 || normSeen.has(nz)) continue;
      const { pos, neg } = scanLex(t);
      const strength = k === "pos" ? pos - neg : neg - pos;
      if (strength <= 0.1) continue;
      if (!best || strength + Math.min(L, 60) / 120 > best.score) best = { text: t, score: strength + Math.min(L, 60) / 120, nz };
    }
    if (best) { normSeen.add(best.nz); out.push({ k, text: best.text.slice(0, 95) }); }
  }
  return out;
}
function digestText(a, asp, q) {
  const seg = [];
  seg.push(`${a.total} 条评论中 ${a.meaningful} 条为真实文字（默认好评 ${Math.round((a.auto_share || 0) * 100)}%）`);
  const topP = (asp.items || []).filter((x) => x.satisfaction >= 75).sort((x, y) => y.mentions - x.mentions)[0];
  if (topP) seg.push(`口碑最稳：${topP.zh}（${topP.mentions} 次提及，满意度 ${topP.satisfaction}）`);
  const topN = (asp.items || []).filter((x) => x.neg >= 2).sort((x, y) => x.satisfaction - y.satisfaction)[0];
  if (topN) seg.push(`最需要盯：${topN.zh}（差评 ${topN.neg} 条，满意度 ${topN.satisfaction}）`);
  if (q.gap != null && q.gap > 0.08) seg.push(`水分指数 +${(q.gap * 10).toFixed(1)}：星级比文字情绪偏高，好评有通胀`);
  if (q.dupRate > 0.06) seg.push(`重复文本率 ${Math.round(q.dupRate * 100)}%，疑似水评`);
  if (a.red_flag_count) seg.push(`红线关键词 ${a.red_flag_count} 条`);
  if (q.recent30Rate != null && q.recent30Rate > 0.001) seg.push(`近 30 天新增占 ${(q.recent30Rate * 100).toFixed(0)}%，口碑样本在更新`);
  return seg.join("；") + "。";
}
function aspectEnrich(a, comments) {
  try {
    const asp = aspectScan(comments);
    a.aspects = asp.items;
    a.aspect_rate = asp.coverageRate;
    a.quality = qualityMetrics(comments, a);
    a.faq = faqExtract(comments);
    a.golden = goldenQuotes(comments);
    a.digest = digestText(a, asp, a.quality);
  } catch { /* enrichment must never break the core analysis */ }
  return a;
}

// ----------------------------------------------------------------- routes
// Stateless step API: the browser orchestrates, any instance serves any step.
const DETAIL_ALLOWED = /^https:\/\/comment\.dangdang\.com\/comment\/detail\/\d{1,2}\/\d{5,}\/\d{5,}$/;
const relayRate = new Map(); // ip -> [timestamps]

function rateOk(ip) {
  const now = Date.now();
  const arr = (relayRate.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 50) return false;
  arr.push(now);
  relayRate.set(ip, arr);
  if (relayRate.size > 4096) relayRate.clear();
  return true;
}

const lastEgress = { list: "unknown", detail: "unknown", at: 0 };
const note = (ep, ok) => { lastEgress[ep] = ok ? "clear" : "waf"; lastEgress.at = Date.now(); };
function relayFailure(error,action,pid){const result=relayError(error);console.warn('relay_failure '+JSON.stringify({action,pid,code:result.code,httpStatus:result.httpStatus,networkCode:result.diagnostic?.networkCode}));return result;}

async function handleApi(url, req, res) {
  const path = url.pathname;
  const seg = path.split("/").filter(Boolean);

  if (path === "/api/status") {
    return json(res, 200, {
      ok: true, durable: "browser-archive", gated: gateEnabled(),
      egress: { list: lastEgress.list, detail: lastEgress.detail },
    });
  }

  if(req.method==='POST'&&path==='/api/collection/lease'){
    try{const owner=await requireUser(req);const body=JSON.parse(await readBody(req,4096));return json(res,200,await collectionLease(pool,owner.id,body));}
    catch(e){return json(res,e.status||(['ZodError','SyntaxError'].includes(e.name)?422:503),{msg:e.status?e.message:'采集协调服务暂不可用，请刷新后重试'});}
  }
  if (req.method === "POST" && path === "/api/relay") {
    const ip = (req.headers["x-forwarded-for"] || "anon").split(",")[0].trim();
    if (!rateOk(ip)) return json(res, 429, { error: "rate_limited", msg: "请求过密，已限速", retryAfterMs:60000 });
    let body;
    try { body = JSON.parse((await readBody(req, 262_144)) || "{}"); } catch { return json(res, 422, { error: "invalid_json" }); }
    const jar = jarFromList(body.cookies);
    const action = String(body.action || "");
    if(!body.leaseToken)return json(res,409,{error:'collection_session_required',msg:'请刷新页面后重新开始采集，本轮需要有效的采集会话'});
    if(body.leaseToken){
      try{const owner=await requireUser(req);const pid=extractPid(body.pid||body.detailUrl);await collectionLease(pool,owner.id,{action:'renew',pid,token:body.leaseToken});}
      catch(e){return json(res,e.status||503,{msg:'本轮采集已停止或失去所有权，请重新提交',error:'collection_lease_lost'});}
    }


    const control=new AbortController();if(req.aborted||res.destroyed)control.abort();
    req.once('aborted',()=>control.abort());res.once('close',()=>{if(!res.writableEnded)control.abort();});
    let upstream={};
    const fetchStep=(url,opts={})=>scopedFetch(jar,url,{...opts,signal:control.signal,onResponse:info=>{upstream=info;}});
    const respond=result=>{result={...result,retryAfterMs:result.retryAfterMs??upstream.retryAfterMs,httpStatus:upstream.httpStatus??result.httpStatus,diagnostic:{...upstream,...result.diagnostic}};if(!result.ok)console.warn('relay_response '+JSON.stringify({stage:action,outcome:result.outcome,code:result.code,...result.diagnostic}));if(action==='list'||action==='detail'){lastEgress[action]=result.blocked?'waf':result.ok?'clear':'unknown';lastEgress.at=Date.now();}return json(res,200,{action,stage:action,...result,cookies:jarToList(jar)});};
    if(action==='prime'){
      const pid=extractPid(body.url||body.pid);if(!pid)return json(res,422,{error:'no_product_id'});
      try{
        const bytes=await fetchStep(`https://product.dangdang.com/${pid}.html`,{referer:'https://www.dangdang.com/',bytes:true,timeout:18000});
        const html=new TextDecoder('gb18030').decode(bytes);
        const failure=htmlAccessFailure(html);if(failure)return respond({...failure,meta:{},pid,httpStatus:200});
        const meta=parseProductMeta(bytes,pid);
        return respond({ok:!!meta.name,outcome:meta.name?'completed':'parse_error',blocked:false,code:meta.name?undefined:'metadata_missing',meta,pid,httpStatus:200});
      }catch(e){return respond({...relayFailure(e,action,pid),meta:{},pid});}
    }
    if(action==='list'){
      const pid=extractPid(body.pid),pageIndex=Math.max(1,Math.min(+body.pageIndex||1,60));if(!pid)return json(res,422,{error:'no_product_id'});
      try{const txt=await fetchStep(listUrlFor(pid,pageIndex),{ajx:true,referer:`https://product.dangdang.com/${pid}.html`});return respond({...parseListResponse(txt),httpStatus:200});}
      catch(e){return respond(relayFailure(e,action,pid));}
    }
    if(action==='detail'){
      const du=String(body.detailUrl||'');if(!DETAIL_ALLOWED.test(du))return json(res,422,{error:'detail_url_not_allowed'});
      try{const txt=await fetchStep(du,{timeout:15000});const failure=htmlAccessFailure(txt);if(failure)return respond({...failure,httpStatus:200});const fields=parseDetailHtml(txt);return respond({ok:!!fields.content_recognized,outcome:fields.text_full?'completed':fields.content_recognized?'partial':'parse_error',blocked:false,code:fields.content_recognized?undefined:'comment_content_missing',fields,httpStatus:200});}
      catch(e){return respond(relayFailure(e,action));}
    }

    return json(res, 422, { error: "unknown_action" });
  }

  if (req.method === "POST" && path === "/api/analyze") {
    let body;
    try { body = JSON.parse((await readBody(req, 12_000_000)) || "{}"); } catch { return json(res, 422, { error: "invalid_json" }); }
    const raw = Array.isArray(body?.comments) ? body.comments : [];
    if (raw.length > 20000) return json(res, 413, {msg:"单次分析最多支持 20000 条评论，请拆分导入；未截断保存"});
    if (!raw.every(c=>c && typeof c === 'object' && !Array.isArray(c) && (c.text == null || typeof c.text === 'string') && (c.text_full == null || typeof c.text_full === 'string'))) return json(res,422,{msg:"评论格式不正确"});
    if (!raw.length) return json(res, 422, { error: "no_comments" });
    const comments = raw.map((c) => {
      const text = c.text_full || c.text || "";
      const [sentiment, conf] = classify(text, c.score);
      return { ...c, sentiment, sentiment_conf: +conf.toFixed(3), is_auto: isAuto(text) };
    });
    const a = analyze(comments);
    a.engine_version = "lexicon-blend/18";
    aspectEnrich(a, comments);
    a.recommendations = recommendations(a, String(body.name || ""));
    if (body.site) a.site = body.site;
    let brief = briefFrom(a, String(body.name || ""));
    return json(res, 200, { ok: true, analysis: a, comments, brief });
  }

  if (seg[0] === "api") return false; // unmatched -> dispatcher 404 JSON
  return false;
}

function briefFrom(a, name) {
  const out = [];
  if (a.digest) out.push(["摘要", a.digest]);
  out.push(["样本", `共 ${a.total} 条：${a.meaningful} 条有真实文字，${a.auto_reviews} 条为系统默认（${Math.round((a.auto_share || 0) * 100)}%）。`]);
  if (a.avg_score) out.push(["评分", `平均 ${a.avg_score}/10；情感 ${Math.round((a.pos_rate || 0) * 100)}% 正面、${Math.round((a.neg_rate || 0) * 100)}% 负面。`]);
  if (a.red_flag_count) out.push(["红线", `${a.red_flag_count} 条提到盗版/缺页/模糊/掉色等关键词。`]);
  if (a.variants?.length) {
    const best = [...a.variants].sort((x, y) => y.avg - x.avg)[0];
    out.push(["版本", `口碑最佳：「${best.variant.slice(0, 16)}」 平均 ${best.avg}（n=${best.n}）。`]);
  }
  if (a.trend?.length) {
    const last = a.trend[a.trend.length - 1];
    out.push(["趋势", `最近统计月 ${last.month}：情感 ${last.mood}，共 ${last.n} 条。`]);
  }
  return out;
}

// ------------------------------------------------------------------- http
import { createHmac, timingSafeEqual } from "node:crypto";

// App-owned access gate. Off unless the owner sets the Page env var
// DDV_ACCESS_PASSPHRASE at runtime. Applies only to live relay requests.
const SESSION_DAYS = 7;
const gateEnabled = () => Boolean(process.env.DDV_ACCESS_PASSPHRASE);
const hmac = (payload) =>
  createHmac("sha256", process.env.DDV_ACCESS_PASSPHRASE || "off").update(String(payload)).digest("hex");

function sessionOk(req) {
  if (!gateEnabled()) return true;
  const raw = parseCookies(req).ddv_s;
  if (!raw) return false;
  const [expiry, sig] = String(raw).split(".");
  const exp = Number(expiry);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const a = Buffer.from(hmac(expiry + "|dangdangvoice"), "hex");
  const b = Buffer.from(String(sig || ""), "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  for (const c of (req.headers.cookie || "").split(";")) {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  }
  return out;
}

const attempts = new Map(); // ip -> {n, until}
function throttled(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return true;
  if (a && a.until <= Date.now()) attempts.delete(ip);
  return false;
}
function noteFail(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 20) { a.until = Date.now() + 15 * 60_000; a.n = 0; }
  attempts.set(ip, a);
}


async function handleGate(req, res, url) {
  if (url.pathname === "/api/session" && req.method === "POST") {
    if (!gateEnabled()) return json(res, 200, { ok: true, gated: false });
    const ip = (req.headers["x-forwarded-for"] || "anon").split(",")[0].trim();
    if (throttled(ip)) return json(res, 429, { error: "too_many_attempts", msg: "尝试过多，15 分钟后再试" });
    let body;
    try { body = JSON.parse((await readBody(req, 8192)) || "{}"); } catch { return json(res, 422, { error: "invalid_json" }); }
    const want = Buffer.from(String(process.env.DDV_ACCESS_PASSPHRASE), "utf8");
    const got = Buffer.from(String(body.passphrase || ""), "utf8");
    const ok = want.length === got.length && timingSafeEqual(want, got);
    if (!ok) { noteFail(ip); return json(res, 401, { error: "wrong_passphrase", msg:"站点采集口令不正确" }); }
    const exp = Date.now() + SESSION_DAYS * 86400_000;
    const sig = hmac(`${exp}|dangdangvoice`);
    res.setHeader("set-cookie", `ddv_s=${exp}.${sig}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return json(res, 200, { ok: true, gated: true });
  }
  if (url.pathname === "/api/session" && req.method === "GET") {
    return json(res, 200, { gated: gateEnabled(), unlocked: sessionOk(req) });
  }
  return false;
}

export async function requestHandler(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://qwenwork.local");
    if(canonicalRequest(req,res)) return;
    if (url.pathname === '/api/auth/csrf' && req.method === 'GET') {
      res.setHeader('Cache-Control','no-store');
      try { return json(res,200,{csrfToken:initializeCsrf(req,res)}); }
      catch(e) { return json(res,e.status||503,{msg:e.status?e.message:'安全凭据初始化失败'}); }
    }
    if (url.pathname === '/readyz' && ['GET','HEAD'].includes(req.method)) {
      res.setHeader('Cache-Control','no-store');
      try {
        if(!pool)throw new Error('unconfigured');
        const r=await pool.query("SELECT 1 FROM schema_migrations WHERE version='008_ai_model_fallback.sql'");
        if(!r.rowCount)throw new Error('migration_required');
        return json(res,200,{status:'ready'});
      } catch { return json(res,503,{status:'not_ready'}); }
    }
    if (url.pathname === "/healthz") {
      return json(res, 200, { status: "ok", ts: Date.now() });
    }
    if (url.pathname === "/api/health") {
      return json(res, 200, { status: "ok" });
    }
    if (url.pathname.startsWith("/api/")) {
      try { checkOrigin(req); } catch(e) { return json(res, e.status, {msg:e.message,code:e.code}); }
    }
    if (await adminAPI(req,res,url,readBody,json)) return;
    if (await enterpriseAPI(req,res,url,readBody,json)) return;
    if (await aiAPI(req,res,url,readBody,json)) return;
    if (await accounts(req,res,url,readBody,json)) return;
    if (url.pathname === "/api/relay") {
      try { await requireUser(req); } catch(e) { return json(res,e.status||503,{msg:e.status?e.message:"账户服务暂不可用"}); }
    }
    if (url.pathname === "/api/session") {
      const handled = await handleGate(req, res, url);
      if (handled !== false) return;
      return json(res, 405, { error: "method_not_allowed" });
    }
    if (gateEnabled() && url.pathname === "/api/relay" && !sessionOk(req)) {
      return json(res, 401, { error: "pass_required", msg: "需要访问口令 / passphrase required" });
    }
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(url, req, res);
      if (handled === false) return json(res, 404, { error: "not_found" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD, POST");
      return send(res, 405, "Method Not Allowed", "text/plain; charset=utf-8");
    }
    await serveAsset(url.pathname, res, req.method);
  } catch (error) {
    console.error("request failed", error?.message);
    if (!res.headersSent) send(res, 500, "Internal Server Error", "text/plain; charset=utf-8");
  }
}
const server = createServer(requestHandler);
if(!process.env.VERCEL)server.listen(port, host, () => console.log(`dangdangvoice listening on ${appOrigin} (bind ${host}:${port})`));

export { server };
