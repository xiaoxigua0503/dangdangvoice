import { useEffect, useRef, useState } from "react";
import type { CommentRow } from "./api";

const COL: Record<string, string> = { pos: "#4CC98B", neu: "#E9A13B", neg: "#F0688A" };
const DIM: Record<string, string> = { pos: "#2B7A56", neu: "#8A6121", neg: "#8C3450" };

interface Bar { x: number; w: number; d: CommentRow; txt: string }

export function Voiceprint({ items }: { items: CommentRow[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Bar[]>([]);
  const [tip, setTip] = useState<{ left: number; top: number; text: string; meta: string } | null>(null);

  const draw = (prog = 1) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight || 150;
    if (!W) return;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,235,205,.22)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 6); ctx.lineTo(W, H - 6); ctx.stroke();
    const sorted = [...items].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const n = sorted.length;
    barsRef.current = [];
    if (!n) return;
    const slot = W / n;
    { // month separators
      let prev = ""; const marks: { x: number; m: string; i: number }[] = [];
      sorted.forEach((d, i) => { const m = (d.date || "").slice(0, 7); if (m && m !== prev) marks.push({ x: i * slot, m, i }); prev = m || prev; });
      if (marks.length > 1) {
        const every = Math.max(1, Math.ceil(marks.length / 8));
        ctx.font = "9px 'IBM Plex Mono', monospace";
        marks.forEach((k, j) => {
          if (j % every) return;
          ctx.strokeStyle = "rgba(255,235,205,.10)";
          ctx.beginPath(); ctx.moveTo(k.x, 16); ctx.lineTo(k.x, H - 6); ctx.stroke();
          ctx.fillStyle = "rgba(216,195,174,.6)";
          ctx.fillText(k.m.slice(2), k.x + 4, 12);
        });
      }
    }
    const bw = Math.max(1.5, Math.min(9, slot * 0.62));
    const shown = Math.min(n, Math.max(1, Math.round(n * prog)));
    for (let i = 0; i < shown; i++) {
      const d = sorted[i];
      const txt = d.text_full || d.text || "";
      const h = Math.min(H - 16, 6 + (Math.log2(txt.length + 1) * (H - 16)) / 7.2);
      const x = i * slot + (slot - bw) / 2;
      const y = H - 6 - h;
      const s = d.sentiment || "neu";
      ctx.fillStyle = d.has_img ? COL[s] : DIM[s];
      ctx.globalAlpha = d.has_img ? 1 : 0.92;
      roundRect(ctx, x, y, bw, h, Math.min(bw / 2, 3));
      if (d.has_img && h > 20) {
        ctx.globalAlpha = 1; ctx.fillStyle = "#FFF3DC";
        ctx.beginPath(); ctx.arc(x + bw / 2, y - 4, 1.8, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      barsRef.current.push({ x: x - slot / 2 + bw / 2, w: slot, d, txt });
    }
  };

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / 900);
      draw(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const hover = (e: React.MouseEvent) => {
    const c = canvasRef.current, wrap = wrapRef.current;
    if (!c || !wrap) return;
    const r = c.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const b = barsRef.current.find((bb) => x >= bb.x && x < bb.x + bb.w);
    if (!b) { setTip(null); return; }
    setTip({
      left: Math.max(8, Math.min(e.clientX - wr.left + 14, wr.width - 330)),
      top: r.top - wr.top + 6,
      text: (b.txt || "（系统默认好评，无文字）").slice(0, 140),
      meta: `${b.d.date || ""} · ${b.d.score ?? "?"}/10 · ${b.d.sentiment || ""}`,
    });
  };

  return (
    <div className="vp-wrap" ref={wrapRef}>
      <canvas id="vpcanvas" ref={canvasRef} onMouseMove={hover} onMouseLeave={() => setTip(null)}
        aria-label="每条评论绘制为一根声音柱" />
      {tip && (
        <div className="vp-tip" style={{ left: tip.left, top: tip.top }}>
          <div>{tip.text}</div>
          <span className="mono">{tip.meta}</span>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + r, y + h, r); ctx.lineTo(x + r, y + r);
  ctx.closePath(); ctx.fill();
}
