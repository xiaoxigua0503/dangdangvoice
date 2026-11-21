import type { Analysis, CommentRow } from "./api";
import { fmt } from "./api";
import { Voiceprint } from "./Voiceprint";

export function esc(s: string): string {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

export function buyerPulse(a: Analysis): number {
  let pulse = (a.pos_rate ?? 0) * 72 + ((a.avg_score ?? 6) / 10) * 28 * 0.55;
  pulse -= Math.min(20, (a.red_flag_count ?? 0) * (400 / Math.max(1, a.total)));
  return Math.round(Math.max(2, Math.min(98, pulse)));
}

export function Gauge({ a }: { a: Analysis }) {
  const pulse = buyerPulse(a);
  const len = 251.3;
  const verdict = pulse >= 72 ? "值得入手" : pulse >= 55 ? "看需求" : pulse >= 40 ? "谨慎" : "先避一避";
  return (
    <div className="gauge-box">
      <p className="eyebrow">购买脉搏指数</p>
      <svg viewBox="0 0 200 112" role="img" aria-label="购买脉搏指数">
        <path className="g-track" d="M20 102a80 80 0 0 1 160 0" />
        <path className="g-fill" d="M20 102a80 80 0 0 1 160 0"
          style={{ strokeDashoffset: len - (len * pulse) / 100 }} />
        <text className="serif" x="100" y="88" textAnchor="middle">{pulse}</text>
        <text x="100" y="106" textAnchor="middle">{verdict} · BUYER PULSE</text>
      </svg>
      <p className="gauge-note">
        综合情感 {Math.round((a.pos_rate ?? 0) * 100)}%↑ / {Math.round((a.neg_rate ?? 0) * 100)}%↓，红线
        {a.red_flag_count ?? 0} 条 · 默认好评占 {Math.round((a.auto_share ?? 0) * 100)}%
      </p>
    </div>
  );
}

export function SentiBar({ a }: { a: Analysis }) {
  const tot = Math.max(1, a.total);
  const seg: [string, number, string][] = [["pos", a.labels.pos, "正面"], ["neu", a.labels.neu, "中性"], ["neg", a.labels.neg, "负面"]];
  return (
    <div className="senti-bar">
      {seg.map(([k, n, label]) => (
        <div key={k} className={`sb ${k}`} style={{ flexGrow: Math.max(0.06, n / tot) }}>
          <b>{Math.round((n / tot) * 100)}%</b><span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function briefRows(a: Analysis): [string, string][] {
  if (!a.total) return [["…", "尚未采集"]];
  const out: [string, string][] = [];
  if (a.digest) out.push(["摘要", a.digest]);
  out.push(["样本", `共 ${fmt(a.total)} 条评论：${fmt(a.meaningful)} 条文字评论，${fmt(a.auto_reviews)} 条为系统默认（${Math.round((a.auto_share || 0) * 100)}%）。`]);
  if (a.avg_score) out.push(["评分", `平均 ${a.avg_score}/10；文字情感 ${Math.round((a.pos_rate || 0) * 100)}% 正面、${Math.round((a.neg_rate || 0) * 100)}% 负面。`]);
  if (a.themes?.length) {
    const bad = (a.top_neg_themes || []).slice(0, 2).map((t) => t.theme).join("、") || "无明显集中槽点";
    out.push(["话题", `高频集中在 ${a.themes.slice(0, 2).map((t) => t.theme).join("、")}；负面声音主要落在 ${bad}。`]);
  }
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

export function Brief({ a }: { a: Analysis }) {
  return (
    <div className="brief-list">
      <dl>{briefRows(a).filter(([k])=>k!=="摘要").map(([k, v]) => (<div key={k} className="br-row"><dt>{k}</dt><dd>{v}</dd></div>))}</dl>
    </div>
  );
}

const COLORS = ["#D7351F", "#E76F22", "#E9A13B", "#2A9D8F", "#3B6FB0", "#7C5CBF", "#177B54", "#B93A5B"];

export function Themes({ a }: { a: Analysis }) {
  const tot = Math.max(1, a.total);
  return (
    <div className="themes">
      {(a.themes || []).length ? a.themes.map((t, i) => (
        <div key={t.theme} className="th" style={{ "--c": COLORS[i % COLORS.length] } as React.CSSProperties}>
          <b>{t.theme}</b>
          <span className="th-neg">差评率 {Math.round(t.neg_rate * 100)}%</span>
          <span className="th-n">{t.count} 次提及 · {t.pos}正/{t.neg}负</span>
          <i className="th-fill" style={{ width: `${Math.min(100, (t.count / tot) * 240)}%` }} />
        </div>
      )) : <p className="hist-note">暂无主题 — 需要更多带文字评论。</p>}
    </div>
  );
}

function kwHtml(list: [string, number][], cls: "pos" | "neg") {
  return list.slice(0, 16).map(([w, n]) => (
    <span key={w} className={`kb ${cls}`}>
      <span style={{ fontSize: `${12 + Math.min(14, n * 1.35)}px` }}>{w}</span><i>{n}</i>
    </span>
  ));
}

export function Keywords({ a }: { a: Analysis }) {
  return (
    <div className="kw-cols">
      <div>
        <h4 className="kw-pos">好评挂在嘴边</h4>
        <div className="kws">{a.pos_words?.length ? kwHtml(a.pos_words, "pos") : "—"}</div>
      </div>
      <div>
        <h4 className="kw-neg">差评里的词</h4>
        <div className="kws">{a.neg_words?.length ? kwHtml(a.neg_words, "neg") : "—"}</div>
      </div>
    </div>
  );
}

export function Hist({ a }: { a: Analysis }) {
  const entries = Object.entries(a.score_hist || {});
  const maxN = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <>
      <div className="hist">
        {entries.map(([sc, n]) => (
          <div key={sc} className="hb">
            <span className="n">{fmt(n)}</span>
            <div className="bar" style={{ height: `${Math.max(3, (n / maxN) * 82)}px` }} />
            <span className="s">{sc}/10</span>
          </div>
        ))}
      </div>
      <p className="hist-note">在 {fmt(a.total)} 条评论里，<b>{fmt(a.auto_reviews)}</b> 条是系统默认好评（占
        {Math.round((a.auto_share || 0) * 100)}%）—— 可查看文字评论 {fmt(a.meaningful)} 条；晒图 {fmt(a.image_reviews)} 条。</p>
    </>
  );
}

export function VariantsTrend({ a }: { a: Analysis }) {
  return (
    <>
      {!!a.variants?.length?<table className="varns">
        <thead><tr><th>购买版本</th><th>条数</th><th>平均分</th><th>差评率</th></tr></thead>
        <tbody>
          {(a.variants || []).slice(0, 6).map((v) => (
            <tr key={v.variant}>
              <td title={v.variant}>{v.variant.slice(0, 18)}{v.variant.length > 18 ? "…" : ""}</td>
              <td className="mono">{v.n}</td>
              <td className={`mono ${v.avg >= 8 ? "good" : v.avg < 6 ? "bad" : ""}`}>{v.avg}</td>
              <td className={`mono ${v.neg_rate > 0.25 ? "bad" : ""}`}>{Math.round(v.neg_rate * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>:<p>评论未标注版本信息</p>}
      <Trend trend={a.trend || []} />
    </>
  );
}

export function Trend({ trend }: { trend: Analysis["trend"] }) {
  const W = 360, H = 70, pad = 26;
  if (!trend.length) {
    return <svg className="trend" viewBox={`0 0 ${W} ${H}`}><text x="180" y="38" textAnchor="middle" fill="#6A564F" fontSize="11">近月评论太少，趋势待积累</text></svg>;
  }
  const xs = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, trend.length - 1);
  const ys = (m: number) => H - 18 - ((m - 0.3) / 0.7) * (H - 30);
  const pts = trend.map((t, i) => [xs(i), ys(t.mood)] as const);
  const line = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ");
  const every = Math.ceil(trend.length / 6);
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="近月情感趋势">
      <path className="line" d={line} />
      {pts.map((q, i) => (
        <circle key={i} className="dot" cx={q[0]} cy={q[1]} r="3">
          <title>{`${trend[i].month} · n=${trend[i].n} · mood=${trend[i].mood}`}</title>
        </circle>
      ))}
      {trend.map((t, i) => (i % every === 0 ? <text key={t.month} className="ml" x={pts[i][0]} y="68">{t.month}</text> : null))}
    </svg>
  );
}

export function Advice({ a }: { a: Analysis }) {
  const rec = a.recommendations || { buyers: [], sellers: [] };
  return (
    <>
      <section className="panel advice buy reveal in">
        <p className="eyebrow">买家情报站</p>
        {rec.buyers.map((b) => (
          <div key={b.title} className={`card ${b.risk ? "risk" : ""}`}>
            <span className="ic">{b.icon}</span><b>{b.title}</b><p>{b.body}</p>
          </div>
        ))}
      </section>
      <section className="panel advice sell reveal in">
        <p className="eyebrow">卖家行动清单</p>
        <ol>
          {rec.sellers.map((s) => (
            <li key={s.action}>
              <b>{s.action}</b>
              <span>为什么：{s.why}<br />怎么做：{s.how}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export function RedFlags({ a }: { a: Analysis }) {
  if (!a.red_flag_count) return null;
  return (
    <section className="panel reveal in" id="flags">
      <p className="eyebrow">红线清单</p>
      {a.red_flags.slice(0, 6).map((f, i) => (
        <div key={i} className="rf">
          {f.flags.map((x) => <span key={x} className="rf-tag">{x}</span>)}
          <span>{f.date && <i className="mono rf-date">{f.date}</i>} {f.text}</span>
        </div>
      ))}
    </section>
  );
}

export function Voice({ items }: { items: CommentRow[] }) {
  return (
    <section className="voiceprint reveal in">
      <div className="vp-head">
        <p className="eyebrow">评论声纹</p>
        <p className="vp-legend">
          <i className="lg pos" />正面 <i className="lg neu" />中性 <i className="lg neg" />负面 ·
          柱高=字数 · 横轴=时间 · 白点=晒图
        </p>
      </div>
      <Voiceprint items={items} />
    </section>
  );
}

/* ── V18 panels (fully optional-field guarded) ── */
const pct = (v: number) => (v * 100).toFixed(0) + "%";

export function Aspects({ a }: { a: Analysis }) {
  if (!a.aspects?.length) return null;
  return (
    <section className="panel reveal in">
      <p className="eyebrow">属性级满意度</p>
      <div className="aspects">
        {a.aspects.map((x) => (
          <div key={x.zh} className={`asp ${x.satisfaction < 40 ? "asp-bad" : x.satisfaction >= 75 ? "asp-good" : ""}`}
            title={(x.qn || []).slice(0, 2).join(" / ") || "无该属性负面摘录"}>
            <div className="asp-top"><b>{x.zh}</b><span className="mono">{x.mentions}提及 · 满意{x.satisfaction}</span></div>
            <div className="asp-bar" aria-hidden="true">
              <i className="p" style={{ width: `${x.satisfaction}%` }} />
              <i className="n" style={{ width: `${100 - x.satisfaction}%` }} />
            </div>
            <span className="asp-sub mono">正{x.pos}·中{x.neu}·负{x.neg}</span>
          </div>
        ))}
        {a.aspect_rate != null && <p className="asp-note">属性引擎覆盖了 {pct(a.aspect_rate || 0)} 的文字评论</p>}
      </div>
    </section>
  );
}

export function QualityDigest({ a }: { a: Analysis }) {
  const q = a.quality;
  if (!q) return null;
  const chip = (label: string, val: string, bad?: boolean) => (
    <span key={label} className={`qm ${bad ? "bad" : ""}`}><b>{val}</b><i>{label}</i></span>
  );
  return (
    <section className="panel reveal in">
      <p className="eyebrow">口碑数据体检</p>
      <div className="qm-grid">
        {chip("文字均长", q.avgLen + " 字")}
        {chip("长评率", pct(q.longRate))}
        {chip("晒图率", pct(q.imgRate))}
        {chip("重复文本率", pct(q.dupRate), q.dupRate > 0.06)}
        {chip("提问数", String(q.questionCount))}
        {q.recent30Rate != null && chip("30天新增", pct(q.recent30Rate))}
        {q.gap != null && q.gap > 0 && chip("水分指数", "+" + (q.gap * 10).toFixed(1), q.gap > 0.08)}
        {q.defaultShare > 0.3 && chip("默认好评", pct(q.defaultShare), true)}
      </div>
      {q.velocity?.length ? (
        <div className="velo" aria-label="近四个月评论节奏">
          {[...q.velocity].reverse().map((v, i) => (
            <div key={i} className="vb"><i style={{ width: `${Math.min(100, v * 90 / Math.max(1, ...q.velocity!))}%` }} /><span className="mono">{v}</span></div>
          ))}
          <span className="velo-l mono">← 新 · 近期节奏（每30天）· 旧 →</span>
        </div>
      ) : null}
    </section>
  );
}

export function NlpDigest({ a }: { a: Analysis }) {
  const hasG = !!a.golden?.length, hasF = !!a.faq?.length;
  if (!a.digest && !hasG && !hasF) return null;
  return (
    <section className="panel reveal in digest-card">
      <p className="eyebrow">评论摘要</p>
      {a.digest && <p className="dg-text">{a.digest}</p>}
      <div className="gd-grid">
        {(a.golden || []).map((g) => (
          <blockquote key={g.text.slice(0, 14)} className={`gd gd-${g.k}`}>
            “{g.text}”<cite>{g.k === "pos" ? "金牌好评" : "代表性差评"}</cite>
          </blockquote>
        ))}
      </div>
      {hasF && (
        <div className="faq">
          <span className="faq-h mono">FAQ 候选（买家的提问）</span>
          {a.faq!.map((f) => (
            <span key={f.topic} className="chip faq-c" title={f.sample}>{f.topic} × {f.count}</span>
          ))}
        </div>
      )}
    </section>
  );
}
