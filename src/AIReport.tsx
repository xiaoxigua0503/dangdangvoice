import {AIReviewArticle,AIReviewScope} from "./AIReviewArticle";
import type {ProductReview} from "./AIReviewArticle";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type {Product} from "./api";
import {AIEvidenceRail} from "./AIEvidenceRail";
import type { User } from "./Account";
interface Finding {
  id: string;
  category: string;
  aspect: string;
  title: string;
  body: string;
  uncertainty: string;
  priority: string;
  comments: string[];
  images: string[];
  quotes: { commentId: string; text: string }[];
}
interface Count {
  total: number;
  completed: number;
  failed: number;
  missingReferences?: number;
}
interface Job {
  runId: string;
  product: { pid?:string; name?:string; image?:string|null; price?:string|null; sellerMetadata?:Record<string,unknown>; note_sample?: string; note_partial?: string };
  id: string;
  state: string;
  model: string;
  provider: string;
  compatibleWorker?:boolean;pipelineVersion?:string;
  mock: boolean;
  delivery?:{downloaded:number};delivered?:{comments:number;images:number};providerRequests?:number;providerRequestLimit?:number;
  coverage: { comments: Count; images: Count; units: Count; complete: boolean };
  createdAt: string;
  progress?: {pending:number;running:number;retrying:number;expired:number;next_retry_at:string|null;last_activity_at:string|null;latestError:string|null;stage?:string};
  report: ProductReview | null;
  categories: { category: string; count: number }[];
  failures: {
    id: string;
    kind: string;
    error: string;
    image_id: string;
    comment_ids: string[];
  }[];
  errorsTotal: number;
  usage: {
    attempts: number;
    prompt_tokens: string;
    completion_tokens: string;
    cache_hits: number;
  };
}
const sections = [
  ["overview", "执行概览"],
  ["strength", "优势与好评"],
  ["problem", "反复出现的问题"],
  ["aspect", "分方面观察"],
  ["conflict", "反馈冲突与不确定性"],
  ["buyer", "买家建议"],
  ["seller", "卖家优先行动"],
] as const;
const states: Record<string, string> = {
  queued: "等待分析",
  running: "分析中",
  completed: "已结束",
  partial: "部分结果",
  failed: "未能生成综合解读",
  cancelled: "已取消",
};
const errorText: Record<string, string> = {
  provider_model_unavailable: "当前模型不可用，按允许列表选择或已停止",
  provider_models_unavailable: "没有能接收同一完整图文数据的可用配置模型",
  provider_request_budget: "已达到本任务请求预算，停止自动处理",
  context_budget_unconfirmed: "保守上下文上界超过预算，无法确认完整输入能容纳；未抽样或调用模型",
  context_budget_exceeded: "完整输入或综合摘要超过单次预算，未截断或抽样",
  model_limits_unverified: "当前模型或端点的官方限制尚未核实",
  unsupported_evidence_claim: "结论超出可验证的图文证据",
  request_timeout: "处理超时",
  provider_timeout: "模型请求超时",
  provider_network_error: "分析服务暂时无法连接，请稍后重试",
  provider_quota_exhausted: "模型账户余额或配额不足",
  image_timeout: "图片下载超时",
  worker_error: "分析暂未完成，请稍后重试",
  unsupported_image_host: "图片地址不在允许的当当图片域名内",
  invalid_image_url: "图片地址无效或缺失",
  image_not_found: "图片不存在",
  image_unavailable: "图片暂不可用",
  image_download_error: "图片下载失败",
  image_size_limit: "图片超过单图大小限制",
  image_pixel_limit: "图片超过像素限制",
  unsupported_image_format: "图片格式不支持",
  invalid_image_content: "图片内容无效",
  total_image_budget: "超过任务图片存储限制",
  invalid_reference: "模型引用了不存在的证据",
  invented_quote: "模型引文无法匹配原文",
  unsupported_statistics: "模型输出了未经程序计算的统计",
  definitive_authenticity_claim: "模型做出了无依据的真伪断言",
  invalid_structure: "模型输出格式未通过校验",
  provider_auth_failed: "模型密钥或权限有误",
  provider_not_configured: "模型服务未配置",
  provider_rate_limit: "模型服务限流",
  provider_http_error: "模型服务请求失败",
  provider_output_incomplete: "模型输出未完整结束",
  retry_exhausted: "重试次数已用尽",
  worker_interrupted: "worker 曾中断",
  interrupted: "任务执行中断",
  cancelled: "已取消",
};
function describeError(code:string) {
  const http=code.match(/^(provider|image)_http_(\d{3})$/);
  return http ? `${http[1]==='image'?'图片下载':'模型 API'}返回 HTTP ${http[2]}` : errorText[code] || "暂未完成处理，请稍后重试或联系管理员";
}
export function AIReport({
  user,
  runId,
  snapshotProduct,
}: {
  user: User | null;
  runId: string | null;
  snapshotProduct?:Product|null;
}) {
  const [preview, setPreview] = useState<any>(null),
    [jobId, setJobId] = useState(()=>{const id=new URLSearchParams(location.search).get("aiJob")||"";return /^[a-f0-9-]{36}$/.test(id)?id:"";}),
    [job, setJob] = useState<Job | null>(null),
    [history, setHistory] = useState<
      { id: string; run_id:string; pid:string; name:string; state: string; model: string; created_at?:string; createdAt?:string }[]
    >([]),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false),
    [category, setCategory] = useState("overview"),
    [page, setPage] = useState(1),
    [findings, setFindings] = useState<Finding[]>([]),
    [total, setTotal] = useState(0),
    [evidence, setEvidence] = useState<any>(null);
  const [historyPage,setHistoryPage]=useState(1),[historyTotal,setHistoryTotal]=useState(0),[scope,setScope]=useState('all'),[refresh,setRefresh]=useState(0);
  const selected=useRef(jobId), intent=useRef(0);
  const [historyError,setHistoryError]=useState('');
  const evidenceDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(evidence)evidenceDialog.current?.showModal();},[evidence]);
  function choose(id:string) {const url=new URL(location.href);url.searchParams.set('aiJob',id);window.history.replaceState(null,'',url);intent.current++;selected.current=id;setJobId(id);setJob(null);setFindings([]);setTotal(0);setEvidence(null);setPage(1);setMsg('');setBusy(false);}
  const alive = useRef(true);
  const controller = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    controller.current = new AbortController();
    return () => {
      alive.current = false;
      controller.current.abort();
    };
  }, []);
  useEffect(() => {
    if (!runId || user?.plan !== "pro" || !user.verified) return;
    const c = new AbortController();
    setPreview(null);
    void api(`/api/ai/runs/${runId}/preview`,{signal:c.signal}).then(p=>{if(!c.signal.aborted)setPreview(p);}).catch(e=>{if(!c.signal.aborted)setMsg(e.message);});
    return () => c.abort();
  }, [runId, user?.id, user?.plan, user?.verified]);
  useEffect(()=>{
    if(!user?.verified||user.plan!=='pro')return;
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function load(){
      try {
        const h=await api<{rows:typeof history;total:number}>(`/api/ai/jobs?page=${historyPage}${scope==='current'&&runId?'&runId='+runId:''}`,{signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});
        if(c.signal.aborted)return;
        setHistory(h.rows);setHistoryTotal(h.total);setHistoryError('');
        // A new saved snapshot must never silently display a different product's report.
        const matching=runId?h.rows.find(row=>row.run_id===runId):h.rows[0];
        if(!selected.current&&matching)choose(matching.id);
      }catch(e){if(!c.signal.aborted)setHistoryError('历史记录暂时加载失败，请重试');}
      if(!c.signal.aborted)timer=setTimeout(()=>void load(),8000);
    }
    void load();return()=>{c.abort();clearTimeout(timer);};
  },[user?.id,runId,historyPage,scope,refresh]);
  useEffect(() => {
    if (!jobId) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const j = await api<Job>("/api/ai/jobs/" + jobId, { signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)]) });
        if (c.signal.aborted) return;
        setJob(j);
        setHistory(rows=>rows.map(row=>row.id===j.id?{...row,state:j.state}:row));
        setMsg("");
        if (["queued", "running"].includes(j.state))
          timer = setTimeout(() => void tick(), 2500);
      } catch (e) {
        if (!c.signal.aborted) {
          setMsg("分析状态暂时无法读取，正在重新连接。");
          if(![401,403,404].includes((e as Error & {status?:number}).status||0))timer = setTimeout(() => void tick(), 5000);
        }
      }
    }
    void tick();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [jobId, refresh]);
  useEffect(() => {
    setFindings([]);
    if (!job?.report || (job.report.schemaVersion||0)>=2) return;
    const c = new AbortController();
    void api<{ findings: Finding[]; total: number }>(
      `/api/ai/jobs/${jobId}/report?category=${category}&page=${page}`,
      { signal: c.signal },
    )
      .then((r) => {
        if (!c.signal.aborted) {
          setFindings(r.findings);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setMsg(e.message);
      });
    return () => c.abort();
  }, [job?.report?.generatedAt, jobId, category, page]);
  useEffect(()=>{
    if(!job?.report || (job.report.schemaVersion||0)>=2)return;
    const first=sections.find(([id])=>job.categories.some(c=>c.category===id&&c.count>0));
    setCategory(current=>job.categories.some(c=>c.category===current&&c.count>0)?current:first?.[0]||'overview');
    setPage(1);
  },[job?.report?.generatedAt,jobId]);
  async function act(action: "start" | "cancel" | "retry") {
    const ticket=intent.current;
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ id?: string }>(
        action === "start" ? "/api/ai/jobs" : `/api/ai/jobs/${jobId}/${action}`,
        {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(action === "start" ? {runId} : {}),signal:controller.current.signal},
      );
      if (!alive.current || ticket!==intent.current) return;
      if (r.id) {
        choose(r.id);
        setScope("all");setHistoryPage(1);
      }
      setEvidence(null);
      setRefresh(v=>v+1);
    } catch (e) {
      if (alive.current && ticket===intent.current) setMsg((e as Error).message);
    } finally {
      if (alive.current && ticket===intent.current) setBusy(false);
    }
  }
  async function showEvidence(kind: string, id: string) {
    const ticket=intent.current;
    try {
      const e = await api(
        `/api/ai/jobs/${jobId}/evidence?${kind}=${encodeURIComponent(id)}`,
        { signal: controller.current.signal },
      );
      if (alive.current && ticket===intent.current) setEvidence(e);
    } catch (e) {
      if (alive.current) setMsg((e as Error).message);
    }
  }
  const modernReport=!!job?.report&&(job.report.schemaVersion||0)>=2;
  const hasArticle=!!job?.report&&job.report.hasSynthesis!==false&&(job.report.schemaVersion===4?!!job.report.summary?.trim():!!job.report.verdict?.text?.trim()&&!!job.report.paragraphs?.some(p=>p.text?.trim()));
  const legacyReport=!!job?.report&&!modernReport;
  const processing=!!job&&['queued','running'].includes(job.state);
  const statusLabel=job?(processing?states[job.state]:hasArticle?(job.report?.partial?'部分综合解读':'综合解读已生成'):legacyReport&&job.categories.some(c=>c.count>0)?'旧版证据报告':['completed','partial'].includes(job.state)?'暂未生成综合解读':states[job.state]||job.state):'';
  const canRetry=!!job&&(job.errorsTotal>0||job.state==='cancelled')&&(job.providerRequests||0)<(job.providerRequestLimit||3);
  const currentProduct=job&&job.runId===runId?snapshotProduct:null;
  const productImage=job?.product.image||currentProduct?.image;
  const metadata:Record<string,unknown>={...(currentProduct?{price:currentProduct.price,author:currentProduct.author,publisher:currentProduct.publisher,specifications:currentProduct.specifications}:{}),...job?.product.sellerMetadata};
  const metadataText=(value:unknown):string=>typeof value==='string'||typeof value==='number'?String(value):Array.isArray(value)?value.filter(v=>typeof v==='string'||typeof v==='number').join(' / '):'';
  const productMeta=[['价格',metadataText(metadata.price||job?.product.price)],['作者',metadataText(metadata.author)],['出版社',metadataText(metadata.publisher)],['版本',metadataText(metadata.variants)],...Object.entries(metadata.specifications&&typeof metadata.specifications==='object'?metadata.specifications:{}).map(([key,value])=>[key,metadataText(value)])].filter(([,value])=>value);
  if (!user)
    return (
      <section className="ai-report">
        <h2 className="serif">AI 深度分析 · Pro</h2>
        <p>请先登录并验证邮箱。基础分析与公开样例仍可使用。</p>
      </section>
    );
  if (user.plan !== "pro")
    return (
      <section className="ai-report">
        <h2 className="serif">AI 深度分析 · Pro</h2>
        <p>当前套餐：Free。基础分析保持完整可用。</p>
        <p>
          Pro
          提供全部评论与买家秀的独立证据报告。目前仅由管理员开通演示权限，尚未接入支付。
        </p>
      </section>
    );
  if (!user.verified)
    return (
      <section className="ai-report">
        <h2>请先验证邮箱</h2>
        <p>Pro 分析需要已验证的邮箱账户。</p>
      </section>
    );
  return (
    <section id="desk" className="ai-report" aria-label="AI 深度分析报告">
      <header className="ai-report-heading"><p className="eyebrow">AI 深度分析</p></header>
      {!job&&<><header className="ai-product-ribbon"><div><h2>{snapshotProduct?.name||'AI 综合解读'}</h2>{preview&&<p>本次待分析：{preview.comments} 条评论 · {preview.images} 个图片来源</p>}</div></header>{!runId&&<p>请在我的记录中打开一份分析，或保存当前结果。</p>}</>}
      {preview&&!hasArticle&&<div className="ai-preflight">
       {preview.missingImageReferences>0&&<p className="ai-warning">{preview.missingImageReferences} 条晒图评论缺少图片地址，无法读取对应图片。</p>}
       {preview.sourceNotices?.map((n:string,i:number)=><p className="ai-warning" key={i}>{n}</p>)}
       {preview.blocked?<p role="alert">当前数据超出可处理范围，请联系管理员。</p>:!preview.ready?<p role="alert">AI 服务暂未就绪，请稍后再试。</p>:<button className="go" disabled={busy||processing} onClick={()=>void act('start')}>生成 AI 解读</button>}
      </div>}
      {historyError&&<p className="ai-status-message" role="alert">{historyError} <button className="ghost-btn" onClick={()=>setRefresh(v=>v+1)}>重试</button></p>}
      {msg&&<p className="ai-status-message" role="status">{msg}</p>}
      {job && (
        <>
          <header className="ai-product-ribbon">
            {productImage&&/^https:\/\//i.test(productImage)&&<img key={job.id+productImage} className="ai-product-cover" src={productImage} alt="已采集的商品封面" onError={e=>{e.currentTarget.hidden=true;}}/>}
            <div><h2>{job.product.name||currentProduct?.name||'商品综合解读'}</h2>{!!productMeta.length&&<dl className="ai-product-metadata">{productMeta.map(([label,value],i)=><div key={label+i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}{!!productMeta.length&&<small>商品资料由商家提供</small>}{job.runId!==runId&&<small>正在阅读另一份已保存快照</small>}</div>
          </header>
          {[job.product.note_sample, job.product.note_partial]
            .filter(Boolean)
            .map((n, i) => (
              <p className="ai-warning" key={i}>
                采集范围说明：{n}
              </p>
            ))}
          {['queued','running'].includes(job.state)&&<p className="ai-simple-progress" role="status">{job.state==='queued'?'正在等待读取数据':job.progress?.stage==='prepare'?'正在读取数据与图片':job.progress?.stage==='synthesis'?'正在写综合解读':'正在对照评论与图片'}{job.progress?.retrying?' · 正在恢复处理':''}</p>}
          {job.mock&&<p className="ai-warning">本地 mock 演示，未进行真实推理，不可作为购买依据。</p>}
          <div className="ai-task-status"><span role="status">{statusLabel}</span>{processing&&<button className="ghost-btn" disabled={busy} onClick={()=>void act('cancel')}>停止处理</button>}{canRetry&&<button className="ghost-btn" disabled={busy} onClick={()=>void act('retry')}>重试分析</button>}</div>
          {hasArticle&&<p className="ai-analysis-scope">本次分析：{job.coverage.comments.completed} 条评论 · {job.coverage.images.completed} 张图片</p>}
          {(job.coverage.comments.completed<job.coverage.comments.total||job.coverage.images.completed<job.coverage.images.total)&&<p className="ai-warning">{hasArticle?'尚未完成分析':'待分析'}：{Math.max(0,job.coverage.comments.total-job.coverage.comments.completed)} 条评论 · {Math.max(0,job.coverage.images.total-job.coverage.images.completed)} 张图片。</p>}
          {modernReport&&<AIReviewArticle key={job.id+job.report?.generatedAt} jobId={job.id} report={job.report!} showEvidence={(kind,id)=>void showEvidence(kind,id)}/>}
          {!modernReport&&<article className="ai-review-article ai-report-placeholder"><header className="ai-article-header"><span className="ai-article-label">AI 综合解读</span><h2 className="ai-review-verdict">暂未生成综合解读</h2><p>{processing?'正在处理本次评论与图片，请稍候。':legacyReport?'这是一份早期证据报告，可继续阅读下方已保存内容。':'当前没有可显示的有效文章。原始数据与任务记录仍保留。'}</p></header></article>}
          {job.report && (job.report.schemaVersion||0)<2 && (
            <article className="ai-review-article ai-legacy-article"><span className="ai-article-label">旧版证据报告</span>
              <p>{job.report.method}</p>
              <details className="ai-legacy-navigation"><summary>选择旧版报告章节</summary><nav className="ai-sections" aria-label="报告章节">
                {sections.filter(([id])=>job.categories.some(c=>c.category===id&&c.count>0)).map(([id, label]) => (
                  <button
                    className={`chip ${category === id ? "on" : ""}`}
                    key={id}
                    onClick={() => {
                      setCategory(id);
                      setPage(1);
                    }}
                  >
                    {label} ·{" "}
                    {job.categories.find((c) => c.category === id)?.count || 0}
                  </button>
                ))}
              </nav></details>
              <h3>{sections.find(([id]) => id === category)?.[1]}</h3>
              <div className={`ai-reading-layout${findings.some(f=>f.comments.length||f.images.length)?'':' ai-reading-layout--solo'}`}><div className="ai-reading-main ai-review-prose">{findings.map((f) => (
                <section className="ai-legacy-section" key={f.id}>
                  <small>
                    {f.aspect} ·{" "}
                    {f.priority === "high"
                      ? "优先处理"
                      : f.priority === "medium"
                        ? "建议跟进"
                        : "持续观察"}
                  </small>
                  <h4>{f.title}</h4>
                  <p>{f.body}</p>
                  <p className="ai-uncertainty">不确定性：{f.uncertainty}</p>
                  {f.quotes.map((q, i) => (
                    <blockquote key={i}>
                      “{q.text}”{" "}
                      <button
                        className="chip"
                        onClick={() =>
                          void showEvidence("comment", q.commentId)
                        }
                      >
                        查看原评
                      </button>
                    </blockquote>
                  ))}
                  <div className="chips">
                    {f.comments.map((id) => (
                      <button
                        className="chip"
                        key={id}
                        onClick={() => void showEvidence("comment", id)}
                      >
                        查看原评
                      </button>
                    ))}
                    {f.images.map((id) => (
                      <button
                        className="chip"
                        key={id}
                        onClick={() => void showEvidence("image", id)}
                      >
                        查看图片
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {!findings.length && (
                <p>
                  本章节没有经过证据校验的实质发现；不会补写没有依据的结论。
                </p>
              )}
              </div><AIEvidenceRail jobId={job.id} references={{comments:findings.flatMap(f=>f.comments),images:findings.flatMap(f=>f.images)}} showEvidence={(kind,id)=>void showEvidence(kind,id)}/></div>
              <div className="pager">
                <button
                  className="ghost-btn"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>
                  {page} 页 · {total} 项发现（仅发现分页，输入数据没有抽样）
                </span>
                <button
                  className="ghost-btn"
                  disabled={page * 20 >= total}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </article>
          )}
          <details className="ai-coverage" key={job.id}><summary>报告信息</summary>
           {job.report&&<AIReviewScope report={job.report}/>}
           <p>模型：{job.report?.actualModel||job.model} · {job.report?new Date(job.report.generatedAt).toLocaleString('zh-CN'):new Date(job.createdAt).toLocaleString('zh-CN')}</p>
           {!!job.coverage.images.missingReferences&&<p>{job.coverage.images.missingReferences} 条晒图线索缺少图片地址，实际图片总量无法确定。</p>}
           {job.errorsTotal>0&&<p>部分内容未完成处理。{[...new Set(job.failures.map(f=>describeError(f.error)))].join('；')}</p>}
           {job.compatibleWorker===false&&<p>此任务版本较早，已保存的报告仍可阅读；需要重新分析时，请从原记录创建。</p>}
          </details>
          {evidence && (
            <dialog ref={evidenceDialog} className="ai-evidence" aria-label="原始证据" onCancel={()=>setEvidence(null)} onClick={e=>{if(e.target===e.currentTarget)setEvidence(null);}}>
              <button className="ghost-btn" autoFocus onClick={() => setEvidence(null)}>
                关闭证据
              </button>
              {evidence.metadata&&<><h3>商家资料 · 尚未核实</h3><p className="ai-source-text">{evidence.metadata.text}</p></>}
              {evidence.comment && (
                <>
                  <h3>原始评论</h3>
                  <p>{[evidence.comment.data.score!=null?`评分 ${evidence.comment.data.score}`:null,evidence.comment.data.date,evidence.comment.data.variant,evidence.comment.data.is_auto?'默认评价':null].filter(Boolean).join(' · ')}</p><p className="ai-source-text">{evidence.comment.data.text_full||evidence.comment.data.text}</p>
                  {/^https:\/\/comment\.dangdang\.com\//.test(
                    evidence.comment.data.detail_url || "",
                  ) && (
                    <a
                      href={evidence.comment.data.detail_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开当当原评论 ↗
                    </a>
                  )}
                  {evidence.images.map((i: { id: string }) => (
                    <button
                      className="chip"
                      key={i.id}
                      onClick={() => void showEvidence("image", i.id)}
                    >
                      查看关联图片
                    </button>
                  ))}
                </>
              )}
              {evidence.image && (
                <>
                  <h3>买家秀原图</h3>
                  {/^https:\/\/(?:[a-z0-9-]+\.)*ddimg\.cn\//i.test(evidence.image.url||'')&&<a href={evidence.image.url} target="_blank" rel="noreferrer">查看当当原始图片 ↗</a>}
                  {evidence.image.content_hash ? (
                    <a
                      href={`/api/ai/jobs/${jobId}/image/${evidence.image.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/api/ai/jobs/${jobId}/image/${evidence.image.id}`}
                        alt="本次任务保存的买家秀原图，点击查看"
                      />
                    </a>
                  ) : (
                    <p>
                      图片未下载或不可用：
                      {errorText[evidence.image.error] || "尚未读取"}
                    </p>
                  )}
                  <p>
                    图片不构成正版或盗版证明；需结合授权、版本与正规核验渠道。
                  </p>
                  {evidence.comments.map((c: { id: string }) => (
                    <button
                      className="chip"
                      key={c.id}
                      onClick={() => void showEvidence("comment", c.id)}
                    >
                      查看关联评论
                    </button>
                  ))}
                </>
              )}
            </dialog>
          )}
        </>
      )}
      <details className="ai-history"><summary>AI 历史报告</summary>
        <label>历史范围 <select aria-label="AI 历史范围" value={scope} onChange={e=>{setScope(e.target.value);setHistoryPage(1);}}><option value="all">我的全部商品与快照</option><option value="current">当前云端快照</option></select></label>
        <label>已保存的 AI 任务
          <select aria-label="已保存的 AI 任务" value={jobId} onChange={e=>choose(e.target.value)}>
            {!jobId&&<option value="">请选择任务</option>}
            {jobId&&!history.some(j=>j.id===jobId)&&<option value={jobId}>{job?.product.name||'所选任务'} · {job?statusLabel:'正在读取'}</option>}
            {history.map(j=><option key={j.id} value={j.id}>#{j.pid} {j.name} · {j.id===jobId?statusLabel||states[j.state]:states[j.state]||j.state}{j.created_at||j.createdAt?` · ${new Date((j.created_at||j.createdAt)!).toLocaleString('zh-CN')}`:''}</option>)}
          </select>
        </label>

        <div className="pager"><button className="ghost-btn" disabled={historyPage===1} onClick={()=>setHistoryPage(p=>p-1)}>上一页任务</button><span>{historyPage} 页 · {historyTotal} 个任务</span><button className="ghost-btn" disabled={historyPage*20>=historyTotal} onClick={()=>setHistoryPage(p=>p+1)}>下一页任务</button><button className="ghost-btn" onClick={()=>setRefresh(v=>v+1)}>刷新任务状态</button></div>
      </details>
      <p className="ai-reading-footnote">AI 解读仅供参考，可查看原始评论与图片核对。</p>
    </section>
  );
}
