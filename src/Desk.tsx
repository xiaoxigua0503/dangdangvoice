import { Advice, Aspects, Brief, Gauge, Hist, Keywords, NlpDigest, QualityDigest, RedFlags, SentiBar, Themes, VariantsTrend, Voice } from "./widgets";
import type { CommentRow, Product } from "./api";
import { PhotoWall } from "./PhotoWall";

export function Desk({ product: p, comments, listeningPid }: { product: Product; comments: CommentRow[]; listeningPid?: string | null }) {
  const a = p.analysis;
  return (
    <main id="desk" className="desk">
      <div className="desk-in">
        {listeningPid && (
          <div className="listening-note" role="status">
            <span className="ln-dot" aria-hidden="true" />
            <b>正在聆听 #{listeningPid}</b> —— 通道窗口未开，排队自动重试中；下方暂时呈现上一个完成分析的商品（#{p.pid}）。窗口一开这里会自动换成新商品的全部数据。
          </div>
        )}
        <section className="ribbon reveal in" id="prod-head">
          {p.image
            ? <img id="p-img" src={p.image} alt="商品图" referrerPolicy="no-referrer" />
            : <div id="p-img" aria-hidden="true" className="img-fallback">书</div>}
          <div className="p-meta">
            <p className="eyebrow">商品分析 <span className={`src-tag ${p.source}`}>{p.source === "import" ? "导入数据" : p.source === "sample" ? "内置样例" : p.source === "browser" ? "浏览器直接抓取" : "在线采集"}</span></p>
            <h2 className="serif">{p.name || `商品 ${p.pid}`}</h2>
            <p className="p-sub">
              <span className="mono">{p.price ? `当当价 ${p.price}` : ""}</span>
              <a className="plink" href={p.url || `https://product.dangdang.com/${p.pid}.html`} target="_blank" rel="noopener noreferrer">在当当打开 ↗</a>
            </p>
          </div>
          <div className="p-score">
            <b className="serif">{a.avg_score ?? "—"}</b>
            <span>平均分 / <i className="mono">10</i></span>
            <em className="mono">{fmtN(a.total)} 条已分析 · {Number(a.site?.total_comment_num || 0) > 0 ? `全站 ${fmtN(Number(a.site!.total_comment_num))} 条（可翻阅 ${(a.site!.pageCount ?? "?")} 页）` : ""}</em>
            {(a.note_partial || a.note_sample) && <p className="partial-chip">{a.note_sample || a.note_partial}</p>}
          </div>
        </section>

        <section className="verdict-card reveal in" id="insight">
          <Gauge a={a} />
          <Brief a={a} />
          <SentiBar a={a} />
        </section>

        <Voice items={comments} />

        <div className="grid2">
          <section className="panel reveal in">
            <p className="eyebrow">大家到底在聊什么</p>
            <Themes a={a} />
          </section>
          <section className="panel reveal in">
            <p className="eyebrow">高频词谱</p>
            <Keywords a={a} />
          </section>
        </div>

        <div className="grid2">
          <section className="panel reveal in">
            <p className="eyebrow">分数形状</p>
            <Hist a={a} />
          </section>
          <section className="panel reveal in">
            <p className="eyebrow">版本口碑 / 近期风向</p>
            <VariantsTrend a={a} />
          </section>
        </div>

        {(a.aspects?.length || a.quality) && (
          <div className="grid2">
            <Aspects a={a} />
            <QualityDigest a={a} />
          </div>
        )}
        <NlpDigest a={a} />
        <PhotoWall comments={comments} productName={p.name} />

        <RedFlags a={a} />

        <div className="grid2">
          <Advice a={a} />
        </div>


      </div>
    </main>
  );
}

const fmtN = (n?: number | null) => (n ?? 0).toLocaleString("en-US");