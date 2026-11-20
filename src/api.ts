import { canonicalProductUrl } from "./url";
export { guessPid, extractProductId, canonicalProductUrl, normalizeProductInput, isDangdangLink } from "./url";
/* dangdangvoice client core: stateless step API calls + local data tools.
   The browser is the orchestrator; the server may answer from any instance. */

export interface CommentRow {
  cid: string | null; text: string; text_full?: string | null; score: number | null;
  date: string | null; variant: string | null; user: string | null; level: string | null;
  has_img: boolean; is_auto?: boolean; sentiment?: "pos" | "neu" | "neg"; sentiment_conf?: number; detail_url?: string | null;
  pics?: { th: string; big?: string }[] | null;
}
export interface CommentInput {
  pid?: string | null; cid?: string | null; text?: string; text_full?: string | null; score?: number | null;
  date?: string | null; variant?: string | null; user?: string | null; level?: string | null;
  has_img?: boolean | number; detail_url?: string | null;
  pics?: { th: string; big?: string }[] | null;
}
export interface Recommendation {
  buyers: { icon: string; title: string; body: string; risk?: boolean }[];
  sellers: { action: string; why: string; how: string }[];
}
export interface Analysis {
  total: number; meaningful: number; auto_reviews: number; auto_share: number; image_reviews: number;
  avg_score: number | null; labels: { pos: number; neu: number; neg: number };
  pos_rate: number; neg_rate: number; score_hist: Record<string, number>;
  themes: { theme: string; count: number; pos: number; neu: number; neg: number; neg_rate: number }[];
  top_neg_themes: { theme: string; n: number }[];
  pos_words: [string, number][]; neg_words: [string, number][];
  red_flags: { text: string; flags: string[]; date: string | null }[]; red_flag_count: number;
  variants: { variant: string; n: number; avg: number; neg_rate: number }[];
  trend: { month: string; n: number; mood: number }[];
  examples_pos: string[]; examples_neg: string[];
  recommendations?: Recommendation; engine_version?: string; engine?: string; note_partial?: string; note_sample?: string;
  aspects?: { zh: string; mentions: number; pos: number; neu: number; neg: number; satisfaction: number; quotes: string[]; qn: string[] }[];
  aspect_rate?: number;
  quality?: { avgLen: number; longRate: number; dupRate: number; questionCount: number; exclRate: number; imgRate: number;
    recent30Rate: number | null; recent90Rate: number | null; velocity: number[] | null;
    defaultShare: number; avgStar: number | null; dictPos: number | null; gap: number | null };
  faq?: { topic: string; count: number; sample: string }[];
  golden?: { k: string; text: string }[];
  digest?: string;
  site?: { total_comment_num?: string | null; pageCount?: string | null; average_score?: string | null } & Record<string, unknown>;
}
export interface Product {
  pid: string; name: string | null; price?: string | null; image?: string | null;
  description?: string | null; specifications?: Record<string,string>;
  variants?: unknown; publisher?: string | null; author?: string | null; isbn?: string | null;
  url?: string; source: string; analysis: Analysis;
  comments_count: number; collected_at: number;
  site?: { total_comment_num?: string | number | null; pageCount?: string | number | null } & Record<string, unknown>;
}
export interface JobState {
  status: "running" | "done" | "error" | "cancelled" | "queued";
  phase: "warming" | "listing" | "detailing" | "analyzing" | "done";
  pages_done: number; pages_total: number; comments_done: number;
  details_done: number; details_total: number; error: string | null; log: string[];
}
export interface CookieItem { s: string; n: string; v: string }
export interface RelayResp {
  ok: boolean; action: string; blocked: boolean; code?: string;
  summary?: Record<string, string | number>;
  items?: CommentRow[];
  fields?: Partial<CommentRow> & { product_name?: string | null; price?: string | null; image?: string | null };
  meta?: { name?: string | null; description?: string | null; specifications?: Record<string,string>; blocked?: boolean };
  pid?: string; cookies?: CookieItem[]; err?: string;
}

export class PassRequired extends Error { constructor() { super("需要访问口令 / passphrase required"); this.name = "PassRequired"; } }

// No CSRF values in localStorage/sessionStorage. Refresh the host-only cookie before
// each mutation so page refreshes, server restarts and concurrent tabs need no stale cache.
let csrfInitialization: Promise<string>|null=null;
export function initializeCsrf(_signal?: AbortSignal): Promise<string> {
  // Coalesce first-page requests: two token initializations must not race to set different cookies.
  if(!csrfInitialization) {
    csrfInitialization=(async()=>{
      const r=await fetch('/api/auth/csrf',{credentials:'same-origin',cache:'no-store'});
      const body=await r.json();
      if(!r.ok || !/^[a-f0-9]{64}$/.test(body.csrfToken||'')) throw new Error(body.msg||'安全凭据初始化失败，请刷新页面');
      return body.csrfToken as string;
    })().finally(()=>{csrfInitialization=null;});
  }
  return csrfInitialization;
}
export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const headers=new Headers(opts?.headers);
  if(!['GET','HEAD','OPTIONS'].includes((opts?.method||'GET').toUpperCase())) {
    headers.set('x-csrf-token',await initializeCsrf(opts?.signal||undefined));
  }
  const r = await fetch(path, {...opts,headers,credentials:'same-origin'});
  if (!r.ok) {
    let d: any = {};
    try { d = await r.json(); } catch { /* ignore */ }
    if (r.status===401 && d.error!=="pass_required") window.dispatchEvent(new Event("ddv-auth-expired"));
    if (d.error === "pass_required") throw new PassRequired();
    throw Object.assign(new Error(d.msg || d.error || r.statusText),{status:r.status});
  }
  return r.json() as Promise<T>;
}

export const postJson = <T = unknown>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/* ---------------- egress cookie relay (opaque, browser-held) ------------- */
const CK_KEY = "ddv-…s-v2";
let egressCookies: CookieItem[] = (() => {
  try { const v = JSON.parse(sessionStorage.getItem(CK_KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
})();
function persistCookies() {
  try { sessionStorage.setItem(CK_KEY, JSON.stringify(egressCookies.slice(0, 40))); } catch { /* ignore */ }
}
export function resetCookies() { egressCookies = []; persistCookies(); }

export async function relay(action: "prime" | "list" | "detail", payload: Record<string, unknown>): Promise<RelayResp> {
  const r = await api<RelayResp>("/api/relay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload, cookies: egressCookies }),
  });
  if (Array.isArray(r.cookies)) { egressCookies = r.cookies.slice(0, 40); persistCookies(); }
  return r;
}

export async function analyzeServer(comments: CommentInput[], name: string | null, site?: unknown) {
  return api<{ analysis: Analysis; comments: CommentRow[]; brief: [string, string][] }>(
    "/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comments, name, site }) });
}

/* ---------------- local CSV / payload parsing ---------------- */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], q = false;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

export function csvRowsToComments(text: string): { rows: CommentInput[]; name: string | null; pid: string | null } {
  const raw = parseCsv(text);
  if (!raw.length) return { rows: [], name: null, pid: null };
  const head = raw[0].map((h) => h.trim().toLowerCase());
  const ix = (n: string) => head.indexOf(n);
  const out: CommentInput[] = [];
  let name: string | null = null, pid: string | null = null;
  if (ix("comment_id") >= 0 && (ix("product_id") >= 0 || ix("text_list") >= 0)) {
    for (const r of raw.slice(1)) {
      if (!name && ix("product_name") >= 0) name = r[ix("product_name")] || null;
      if (!pid && ix("product_id") >= 0) pid = r[ix("product_id")] || null;
      out.push({
        pid: r[ix("product_id")] || null, cid: r[ix("comment_id")] || null,
        user: r[ix("user")] || null, level: r[ix("level")] || null,
        score: +r[ix("score_10")] || null, date: r[ix("date")] || null,
        variant: r[ix("variant")] || null, has_img: r[ix("has_image")] === "1",
        detail_url: r[ix("detail_url")] || null,
        text: ix("text_list") >= 0 ? r[ix("text_list")] || "" : r[ix("text_full")] || "",
        text_full: r[ix("text_full")] || "",
      });
    }
  } else {
    const pidAt = head.findIndex((h) => /product_?id/.test(h));
    const txtAt = head.findIndex((h) => /text|内容|评论/.test(h));
    if (txtAt < 0) throw new Error("CSV 需要 comment/text 列（使用 dangdangvoice 导出格式）");
    for (const r of raw.slice(1)) {
      if (pidAt >= 0 && !pid) pid = r[pidAt] || null;
      out.push({ pid: pidAt >= 0 ? r[pidAt] : null, text: r[txtAt] || "" });
    }
  }
  return { rows: out, name, pid };
}

export function payloadFromJson(text: string): { rows: CommentInput[]; pid: string | null; name: string | null; price: string | null; image: string | null; url: string | null; metadata: Pick<Product,"description"|"specifications"|"site"|"variants"|"publisher"|"author"|"isbn"> } {
  const o = JSON.parse(text);
  const list: CommentInput[] = Array.isArray(o) ? o : (o.comments || o.items || []);
  let pid: string | null = o?.product?.pid || list.find((r: CommentInput) => r.pid)?.pid || null;
  return {
    metadata: {description:o?.product?.description, specifications:o?.product?.specifications,site:o?.product?.site,variants:o?.product?.variants,publisher:o?.product?.publisher,author:o?.product?.author,isbn:o?.product?.isbn},
    rows: list.map((r: CommentInput) => ({ ...r })),
    pid: String(pid || "") || null,
    name: o?.product?.name || null, price: o?.product?.price || null,
    image: o?.product?.image || null, url: o?.product?.url || null,
  };
}

/* ---------------- misc local tools ---------------- */
export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-US");

export function buildCsvLocal(pid: string, name: string, rows: CommentRow[]): string {
  const head = ["product_id", "product_name", "comment_id", "user", "level", "score_10", "date",
    "variant", "has_image", "is_default_review", "sentiment", "text_list", "text_full", "detail_url"];
  const q = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => [pid, name, r.cid, r.user, r.level, r.score, r.date, r.variant,
    r.has_img ? 1 : 0, r.is_auto ? 1 : 0, r.sentiment || "", r.text, r.text_full || "", r.detail_url || ""].map(q).join(","));
  return "\uFEFF" + head.join(",") + "\n" + body.join("\n") + "\n";
}

export interface ArchivedProduct extends Omit<Product, "analysis"> { analysis?: Analysis /* live-run snapshot */ }
export interface ArchiveEntry {
  cloudKey?: string;
  cloudRunId?: string;
  savedAt: number;
  product: ArchivedProduct;
  comments: CommentRow[];
}
const ARCHIVE_KEY = ["ddv", "archive", "v1"].join("-") + "-2";

/* migration: earlier on-disk corruption mangled the stored key literal;
   absorb any ddv-*archive*-v1-shaped keys found in localStorage */
function absorbLegacyKeys(list: ArchiveEntry[]): ArchiveEntry[] {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === ARCHIVE_KEY || !k.startsWith("ddv-") || !k.endsWith("-v1")) continue;
      const v = localStorage.getItem(k);
      if (!v) continue;
      try {
        const legacy = JSON.parse(v) as ArchiveEntry[];
        for (const e of Array.isArray(legacy) ? legacy : []) {
          if (e?.product?.pid && !list.some((x) => x.product.pid === e.product.pid)) list.unshift(e);
        }
        localStorage.removeItem(k);
      } catch { /* not ours */ }
    }
  } catch { /* ignore */ }
  return list;
}
const ARCHIVE_CAP = 5;
const ARCHIVE_ITEM_MAX = 440;

export function archiveList(): ArchiveEntry[] {
  let list: ArchiveEntry[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
    list = Array.isArray(v) ? v.filter((e: ArchiveEntry) => e?.product?.pid) : [];
  } catch { list = []; }
  return absorbLegacyKeys(list).slice(0, 6);
}
export function archiveSave(product: Product, comments: CommentRow[]): void {
  try {
    const list = archiveList().filter((e) => e.product.pid !== product.pid);
    list.unshift({ savedAt: Date.now(), product, comments: comments.slice(0, ARCHIVE_ITEM_MAX) });
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, ARCHIVE_CAP)));
  } catch { /* quota / private mode */ }
}
export function archiveRemove(pid: string): ArchiveEntry[] {
  const list = archiveList().filter((e) => e.product.pid !== pid);
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
export function buildPayloadJson(product: Product, comments: CommentRow[]): string {
  return JSON.stringify({ dangdangvoice: 1, exportedAt: new Date().toISOString(), product, comments }, null, 1);
}

/* ---------------- durable task queue (auto-resume across windows/visits) --- */
export interface QueuedTask {
  pid: string; url: string; maxPages: number; maxDetails: number;
  addedAt: number; lastTry: number; tries: number;
  ownerId?: string;
  intentAt?: number; // user-intent sequence when submitted; newest intent may surface its result
}
const QUEUE_KEY = ["ddv","task","queue","v1"].join("-");

export const QUEUE_MAX_TRIES = 40;

export function taskQueueList(): QueuedTask[] {
  try {
    const v = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(v) ? v.filter((t: QueuedTask) => t?.pid) : [];
  } catch { return []; }
}
export function taskQueueAdd(t: Omit<QueuedTask, "addedAt" | "lastTry" | "tries">): QueuedTask[] {
  const list = taskQueueList();
  /* idempotent: an existing entry keeps its accumulated tries / schedule */
  if (!list.some((x) => x.pid === t.pid && x.ownerId === t.ownerId)) {
    list.unshift({ ...t, addedAt: Date.now(), lastTry: 0, tries: 0 });
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
  }
  return taskQueueList();
}
export function taskQueueRemove(pid: string, ownerId?: string): QueuedTask[] {
  const list = taskQueueList().filter((x) => x.pid !== pid || x.ownerId !== ownerId);
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
export function taskQueueTouch(pid: string, ok = false, ownerId?: string): QueuedTask[] {
  const list = taskQueueList();
  for (const t of list) if (t.pid === pid && t.ownerId === ownerId) { t.lastTry = Date.now(); t.tries += 1; }
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(ok ? list.filter((t) => t.pid !== pid || t.ownerId !== ownerId) : list)); }
  catch { /* ignore */ }
  return taskQueueList();
}


