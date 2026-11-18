/* PHOTO SCREEN WALL · 买家秀晒图墙 — a signature pattern: every picture from
 * every comment of the current product, one wall. Sources in priority order:
 * live crawl (relay list/detail), bookmarklet harvest, desktop CSV import.
 * Dangdang's photo markup pattern: <li><a><img src="*_p.jpg"
 * data-big-pic="*_e.jpg"></a></li> — preview + original on ddimg.cn CDN.
 * Old archives / imports without pics simply hide the panel (zero crash). */
import { useEffect, useMemo, useState } from "react";
import type { CommentRow } from "./api";

interface Shot { th: string; big: string; cid: string; user: string; date: string | null; sentiment: string; text: string }

export function PhotoWall({ comments, productName }: { comments: CommentRow[]; productName?: string | null }) {
  const [open, setOpen] = useState<number | null>(null);

  const shots = useMemo<Shot[]>(() => {
    const seen = new Set<string>();
    const out: Shot[] = [];
    for (const c of comments) {
      for (const p of (c.pics || [])) {
        const th = (p && p.th) || "";
        if (!th || seen.has(th)) continue;
        seen.add(th);
        out.push({
          th, big: p.big || th, cid: String(c.cid ?? ""),
          user: c.user || "匿名", date: c.date ?? null,
          sentiment: c.sentiment || "neu",
          text: String(c.text_full || c.text || "").slice(0, 90),
        });
      }
    }
    return out;
  }, [comments]);

  const withPics = useMemo(() => shots.length ? new Set(shots.map((s) => s.cid)).size : 0, [shots]);

  useEffect(() => {
    if (open == null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((o) => (o == null ? o : (o + 1) % shots.length));
      if (e.key === "ArrowLeft") setOpen((o) => (o == null ? o : (o - 1 + shots.length) % shots.length));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, shots.length]);

  if (!shots.length) return null;
  const cur = open != null ? shots[open] : null;

  return (
    <section className="panel reveal in photowall">
      <p className="eyebrow">PHOTO SCREEN WALL · 买家秀晒图墙</p>
      <p className="pw-stats mono">{shots.length} 张照片 · 来自 {withPics} 条晒图评论{productName ? ` · ${productName.slice(0, 20)}` : ""}</p>
      <div className="pw-grid">
        {shots.map((s, i) => (
          <button key={s.th} className={`pw-cell s-${s.sentiment}`} onClick={() => setOpen(i)} title={`${s.user} · ${s.date || ""}`}
            aria-label={`查看第 ${i + 1} 张买家秀`}>
            <img src={s.th} alt={`买家秀 ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" />
            <span className="pw-i mono">{i + 1}</span>
          </button>
        ))}
      </div>
      {cur && (
        <div className="pw-lb" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div className="pw-lb-in" onClick={(e) => e.stopPropagation()}>
            <img src={cur.big} alt="买家秀大图" referrerPolicy="no-referrer" />
            <div className="pw-cap">
              <b>{cur.user}</b><span className="mono">{cur.date || ""} · {cur.cid}</span>
              <p>{cur.text || "（无文字）"}</p>
            </div>
            <div className="pw-nav">
              <button onClick={() => setOpen((o) => (o == null ? o : (o - 1 + shots.length) % shots.length))}>← 上一张</button>
              <span className="mono">{(open ?? 0) + 1} / {shots.length}</span>
              <button onClick={() => setOpen((o) => (o == null ? o : (o + 1) % shots.length))}>下一张 →</button>
              <button className="pw-x" onClick={() => setOpen(null)}>关闭 Esc</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
