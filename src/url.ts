/* dangdangvoice URL handling — THE canonical client implementation for
 * recognizing Dangdang product links, extracting the product id, and
 * normalizing to the canonical desktop URL. Used for intake validation and
 * by the relay queue; the crawler itself still only consumes the numeric pid,
 * so fetch/parse/analyze behavior is untouched.
 *
 * Accepted shapes:
 *   https://product.dangdang.com/30113481.html                    desktop
 *   https://product.m.dangdang.com/product.php?pid=30113481&…     mobile (new)
 *   https://m.dangdang.com/product.php?product_id=30113481        mobile (legacy)
 *   https://www|item|e|shop.dangdang.com/{id}.html?…              any dd host
 *   comment.dangdang.com/comment/detail/0/{pid}/{cid}             detail paste
 *   product.dangdang.com/30113481.html  (without https://)        schemeless
 *   30113481                                                       bare id
 */

const DANGDANG_HOST = /^(?:https?:\/\/)?(?:[\w-]+\.)*dangdang\.com(?::\d{1,5})?(?:[/?#]|$)/i;

export function isDangdangLink(raw: string): boolean {
  return DANGDANG_HOST.test(String(raw || "").trim());
}

export function extractProductId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{5,}$/.test(s)) return s;                       // bare product id always OK
  if (!isDangdangLink(s)) return null;                    // reject foreign domains explicitly
  const m =
    s.match(/\/(\d{5,})\.html/i) ||
    s.match(/[?&](?:pid|product_?id|productId|mainProductId|ddkey)=(\d{5,})/i) ||
    s.match(/\/comment\/detail\/\d+\/(\d{5,})\//i);
  if (m) return m[1];
  const runs = s.match(/\d{5,}/g);                        // long ids live in the path (share links)
  return runs ? runs.sort((a, b) => b.length - a.length)[0] : null;
}

export function canonicalProductUrl(pid: string): string {
  return `https://product.dangdang.com/${pid}.html`;
}

export type Normalized =
  | { ok: true; pid: string; canonical: string }
  | { ok: false; code: "empty" | "not_dangdang" | "no_id"; msg: string };

export function normalizeProductInput(raw: string): Normalized {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, code: "empty", msg: "先粘贴一个当当商品链接或直接输入商品编号 / paste a dangdang product url or id" };
  const pid = extractProductId(s);
  if (!pid) {
    if (!isDangdangLink(s)) {
      return { ok: false, code: "not_dangdang", msg: "不是当当链接 —— 仅支持 *.dangdang.com 商品链接（product / product.m / m / www / item / e，可省略 https://）" };
    }
    return { ok: false, code: "no_id", msg: "未能从该当当链接取到商品编号 —— 支持 {编号}.html 桌面链接、/product.php?pid=…（手机版）、?product_id=… 或直接粘贴 5 位以上编号" };
  }
  return { ok: true, pid, canonical: canonicalProductUrl(pid) };
}

/* legacy name kept for existing imports (App hint, importText fallback) */
export const guessPid = extractProductId;
