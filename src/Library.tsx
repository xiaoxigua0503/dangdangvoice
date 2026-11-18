/* dangdangvoice 评论记录库 — every collected product in one searchable table.
   Today's store = this browser's archive (auto-saved on every run, offline-capable).
   Row shape is already the future db-table one-to-one (product_id · product_name ·
   comment + meta), so enabling the Pages database only swaps the data source. */
import { useMemo, useState } from "react";
import type { ArchiveEntry } from "./api";

interface Row {
  pid: string; pname: string; savedAt: number; source: string;
  cid: string | null; text: string; text_full?: string | null; score: number | null;
  date: string | null; variant: string | null; user: string | null; level: string | null;
  has_img: boolean; is_auto?: boolean; sentiment?: string; detail_url?: string | null;
}
const SENT: Record<string, string> = { pos: "正面", neu: "中性", neg: "负面" };
const SRC: Record<string, string> = { relay: "在线采集", sample: "内置样例", import: "导入", browser: "浏览器抓取(旧)", live: "在线采集" };

export function Library({ entries, currentPid, onOpen }: {
  entries: ArchiveEntry[]; currentPid: string | null; onOpen: (e: ArchiveEntry) => void;
}) {
  const [kw, setKw] = useState("");
  const [pid, setPid] = useState("");
  const [pname, setPname] = useState("");
  const [sent, setSent] = useState("");
  const [src, setSrc] = useState("");
  const [onlyImg, setOnlyImg] = useState(false);
  const [noAuto, setNoAuto] = useState(false);
  const [page, setPage] = useState(1);
  const [expand, setExpand] = useState<string | null>(null);
  const SIZE = 20;

  const rows = useMemo<Row[]>(() => entries.flatMap((e) => (e.comments || []).map((c, i) => ({
    pid: e.product.pid, pname: e.product.name || `商品 ${e.product.pid}`,
    savedAt: e.savedAt, source: e.product.source || "relay",
    cid: c.cid || `${e.product.pid}-${i}`, text: c.text, text_full: c.text_full, score: c.score,
    date: c.date, variant: c.variant, user: c.user, level: c.level,
    has_img: !!c.has_img, is_auto: c.is_auto, sentiment: c.sentiment, detail_url: c.detail_url,
  }))), [entries]);

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase(), p = pid.trim().toLowerCase(), n = pname.trim().toLowerCase();
    let out = rows;
    if (k) out = out.filter((r) => `${r.text || ""} ${r.text_full || ""}`.toLowerCase().includes(k));
    if (p) out = out.filter((r) => r.pid.toLowerCase().includes(p));
    if (n) out = out.filter((r) => r.pname.toLowerCase().includes(n));
    if (sent) out = out.filter((r) => r.sentiment === sent);
    if (src) out = out.filter((r) => (SRC[r.source] ? r.source : r.source) === src);
    if (onlyImg) out = out.filter((r) => r.has_img);
    if (noAuto) out = out.filter((r) => !r.is_auto);
    return [...out].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [rows, kw, pid, pname, sent, src, onlyImg, noAuto]);

  const pages = Math.max(1, Math.ceil(filtered.length / SIZE));
  const safe = Math.min(page, pages);
  const shown = filtered.slice((safe - 1) * SIZE, (safe - 1) * SIZE + SIZE);
  const reset = () => setPage(1);
  const chips: [string, string][] = [["全部情绪", ""], ["正面", "pos"], ["中性", "neu"], ["负面", "neg"]];
  const srcChips: [string, string][] = [["全部来源", ""], ["在线采集", "relay"], ["内置样例", "sample"], ["导入", "import"]];

  return (
    <div className="library">
      <p className="lib-banner">数据源＝本浏览器档案库：每次采集/导入自动入库，离线可用；这里仅显示本设备记录；登录后的云端历史单独显示，可手动复制本地档案到当前账户。</p>
      <div className="lib-stats mono">{entries.length} 个商品 · {rows.length} 条评论记录 · 当前命中 <b>{filtered.length}</b> 条</div>
      <div className="lib-filter">
        <label>关键词<input className="q" type="search" placeholder="评论内容，如：印刷 / 物流 / 安东尼"
          value={kw} onChange={(e) => { setKw(e.target.value); reset(); }} /></label>
        <label>商品编号<input className="q q-pid mono" type="search" placeholder="pid" value={pid}
          onChange={(e) => { setPid(e.target.value); reset(); }} /></label>
        <label>商品名<input className="q q-name" type="search" placeholder="商品名关键字" value={pname}
          onChange={(e) => { setPname(e.target.value); reset(); }} /></label>
      </div>
      <div className="lib-filter row2">
        <div className="chips">{chips.map(([lbl, v]) => (
          <button key={v} type="button" className={`chip ${sent === v ? "on" : ""}`}
            onClick={() => { setSent(v); reset(); }}>{lbl}</button>))}</div>
        <div className="chips">{srcChips.map(([lbl, v]) => (
          <button key={v} type="button" className={`chip ${src === v ? "on" : ""}`}
            onClick={() => { setSrc(v); reset(); }}>{lbl}</button>))}</div>
        <div className="chips">
          <button type="button" className={`chip ${onlyImg ? "on" : ""}`} onClick={() => { setOnlyImg(!onlyImg); reset(); }}>📷 仅晒图</button>
          <button type="button" className={`chip ${noAuto ? "on" : ""}`} onClick={() => { setNoAuto(!noAuto); reset(); }}>排除默认好评</button>
          {currentPid && (
            <button type="button" className={`chip ${pid === currentPid ? "on" : ""}`}
              onClick={() => { setPid(pid === currentPid ? "" : currentPid); reset(); }}>仅当前商品 #{currentPid}</button>
          )}
        </div>
      </div>
      <div className="lrec">
        <div className="lrec-h mono"><span>商品</span><span>情绪</span><span>日期</span><span>评论记录</span></div>
        {shown.map((r, i) => {
          const key = `${r.pid}/${r.cid ?? i}`;
          const body = r.text_full || r.text || "（系统默认好评，无文字）";
          return (
            <article key={key} className={`lr ${r.sentiment || ""}`}>
              <button className="lr-prod" title={r.pname} onClick={() => {
                const e = entries.find((x) => x.product.pid === r.pid); if (e) onOpen(e);
              }}>
                <b className="mono">#{r.pid}</b><span>{r.pname}</span>
                <i>{SRC[r.source] || r.source}{r.date ? ` · ${r.date.slice(0, 10)}` : ""}</i>
              </button>
              <span className="lr-sent">
                <em className={`sb ${r.sentiment || "neu"}`}>{SENT[r.sentiment || "neu"]}</em>
                <small className="mono">{r.score ?? "?"}/10</small>
                {r.has_img && <small title="有晒图">📷</small>}
                {r.is_auto && <small className="lr-auto">默认</small>}
              </span>
              <span className="lr-date mono">{r.date || "—"}</span>
              <div className="lr-text">
                <p>{expand === key || body.length < 72 ? body : body.slice(0, 72) + "…"}</p>
                {body.length >= 72 && (
                  <button className="lr-x" onClick={() => setExpand(expand === key ? null : key)}>{expand === key ? "收起" : "展开全文"}</button>
                )}
                {r.detail_url && <a className="lr-link" href={r.detail_url} target="_blank" rel="noopener noreferrer">原评论 ↗</a>}
                {(r.user || r.variant) && <small className="lr-meta">{r.user || "匿名"}{r.level ? ` · ${r.level}` : ""}{r.variant ? ` · ${r.variant}` : ""}</small>}
              </div>
            </article>
          );
        })}
        {!shown.length && <p className="hist-note">{rows.length ? "没有匹配的记录 — 换个筛选组合试试。" : "档案库还是空的 — 采集或导入一个商品，它会自动入库。"}</p>}
      </div>
      <div className="pager">
        <button className="ghost-btn" disabled={safe <= 1} onClick={() => setPage(safe - 1)}>← 上一页</button>
        <span className="mono">{safe} / {pages} 页 · 命中 {filtered.length} 条</span>
        <button className="ghost-btn" disabled={safe >= pages} onClick={() => setPage(safe + 1)}>下一页 →</button>
      </div>
      {entries.length > 0 && (
        <div className="lrec-entrylist">
          <p className="pop-h">入库商品（点击回到该商品声纹台）</p>
          <div className="entrychips">
            {entries.map((e) => (
              <span key={e.product.pid} className="enchip">
                <button onClick={() => onOpen(e)}><b className="mono">#{e.product.pid}</b> {(e.product.name || "未命名").slice(0, 16)} · {e.comments.length} 条</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
