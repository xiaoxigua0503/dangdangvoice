import { useEffect, useRef, useState } from "react";
import { api, postJson } from "./api";
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
  product: { note_sample?: string; note_partial?: string };
  id: string;
  state: string;
  model: string;
  provider: string;
  mock: boolean;
  coverage: { comments: Count; images: Count; units: Count; complete: boolean };
  createdAt: string;
  report: { generatedAt: string; partial: boolean; method: string } | null;
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
  queued: "等待 worker",
  running: "分析中",
  completed: "任务已结束",
  cancelled: "已取消",
};
const errorText: Record<string, string> = {
  request_timeout: "处理超时",
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
export function AIReport({
  user,
  runId,
}: {
  user: User | null;
  runId: string | null;
}) {
  const [preview, setPreview] = useState<any>(null),
    [jobId, setJobId] = useState(""),
    [job, setJob] = useState<Job | null>(null),
    [history, setHistory] = useState<
      { id: string; state: string; model: string }[]
    >([]),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false),
    [category, setCategory] = useState("overview"),
    [page, setPage] = useState(1),
    [findings, setFindings] = useState<Finding[]>([]),
    [total, setTotal] = useState(0),
    [evidence, setEvidence] = useState<any>(null);
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
    void Promise.all([
      api(`/api/ai/runs/${runId}/preview`, { signal: c.signal }),
      api<{ rows: typeof history }>(`/api/ai/runs/${runId}/jobs`, {
        signal: c.signal,
      }),
    ])
      .then(([p, h]) => {
        if (c.signal.aborted) return;
        setPreview(p);
        setHistory(h.rows);
        if (h.rows.length) setJobId(h.rows[0].id);
      })
      .catch((e) => {
        if (!c.signal.aborted) setMsg(e.message);
      });
    return () => c.abort();
  }, [runId, user?.id, user?.plan, user?.verified]);
  useEffect(() => {
    if (!jobId) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const j = await api<Job>("/api/ai/jobs/" + jobId, { signal: c.signal });
        if (c.signal.aborted) return;
        setJob(j);
        if (["queued", "running"].includes(j.state))
          timer = setTimeout(() => void tick(), 2500);
      } catch (e) {
        if (!c.signal.aborted) {
          setJob(null);
          setFindings([]);
          setEvidence(null);
          setMsg((e as Error).message);
        }
      }
    }
    void tick();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [jobId, busy]);
  useEffect(() => {
    setFindings([]);
    if (!job?.report) return;
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
  async function act(action: "start" | "cancel" | "retry") {
    if (
      action === "start" &&
      !confirm(
        `将处理全部 ${preview.comments} 条评论、${preview.images} 个图片地址，共 ${preview.units} 个分批单元。${preview.provider === "mock" ? "当前为本地 mock，不是真实 AI。" : "将向配置的模型服务发送证据并可能产生费用。"}是否继续？`,
      )
    )
      return;
    setBusy(true);
    setMsg("");
    try {
      const r = await postJson<{ id?: string }>(
        action === "start" ? "/api/ai/jobs" : `/api/ai/jobs/${jobId}/${action}`,
        action === "start" ? { runId } : {},
      );
      if (!alive.current) return;
      if (r.id) {
        setJobId(r.id);
        setJob(null);
        setPage(1);
      }
      setEvidence(null);
    } catch (e) {
      if (alive.current) setMsg((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function showEvidence(kind: string, id: string) {
    try {
      const e = await api(
        `/api/ai/jobs/${jobId}/evidence?${kind}=${encodeURIComponent(id)}`,
        { signal: controller.current.signal },
      );
      if (alive.current) setEvidence(e);
    } catch (e) {
      if (alive.current) setMsg((e as Error).message);
    }
  }
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
  if (!runId)
    return (
      <section className="ai-report">
        <h2 className="serif">AI 深度分析 · Pro</h2>
        <p>
          请先将当前完整结果保存到云端，或从云端历史恢复一份记录，再开始 AI
          分析。AI 只读取属于你的云端快照。
        </p>
      </section>
    );
  return (
    <section className="ai-report" aria-label="AI 深度分析报告">
      <p className="eyebrow">PRO · MULTIMODAL EVIDENCE REPORT</p>
      <h2 className="serif">AI 深度分析</h2>
      <p>
        与基础词典分析独立。报告依据本次已保存的全量数据，不代表站点全部评论；照片仅用于可见细节观察，不能据此断言正版或盗版。
      </p>
      {preview && (
        <div className="ai-preflight">
          <b>
            全量范围：{preview.comments} 条评论 · {preview.images} 个图片地址 ·{" "}
            {preview.units} 个处理单元
          </b>
          <p>{preview.notice}</p>
          {preview.missingImageReferences > 0 && (
            <p className="ai-warning">
              另有 {preview.missingImageReferences}{" "}
              条晒图评论没有图片地址，实际图片总张数无法确定；这些线索会列为未覆盖，不会冒充已分析。
            </p>
          )}
          {preview.sourceNotices?.map((n: string, i: number) => (
            <p className="ai-warning" key={i}>
              采集范围说明：{n}
            </p>
          ))}
          <p>
            每张图片最多 {Math.round(preview.limits.imageBytes / 1024 / 1024)}{" "}
            MB，任务图片总量最多{" "}
            {Math.round(preview.limits.totalImageBytes / 1024 / 1024)}{" "}
            MB；不支持的地址、格式或下载失败会留下明确失败记录。下载后按内容哈希核对重复图片，唯一图片总数可能相应减少。
          </p>
          <p>
            任务限制：每账户每日最多 {preview.jobLimits.daily}{" "}
            个新任务，同时最多 {preview.jobLimits.active}{" "}
            个任务。含全部自动与手动重试的理论请求上限为 {preview.maxRequests}{" "}
            次，每次最多输出 {preview.jobLimits.maxOutputTokens}{" "}
            token；实际费用取决于服务商计费和用量。
          </p>
          <p>
            模型：{preview.model} ·{" "}
            {preview.provider === "mock"
              ? "本地 mock · 未执行真实 AI 推理"
              : preview.provider}
          </p>
          {preview.blocked ? (
            <p role="alert">
              超过全量处理容量，未启动。请管理员调整限制，不会降级抽样。
            </p>
          ) : !preview.ready ? (
            <p role="alert">模型服务尚未配置密钥，未执行 AI 推理。</p>
          ) : (
            <button
              className="go"
              disabled={
                busy || job?.state === "running" || job?.state === "queued"
              }
              onClick={() => void act("start")}
            >
              开始全量 AI 分析 / 读取已有任务
            </button>
          )}
        </div>
      )}
      {history.length > 0 && (
        <label>
          已保存的 AI 任务
          <select
            aria-label="已保存的 AI 任务"
            value={jobId}
            onChange={(e) => {
              setJob(null);
              setEvidence(null);
              setJobId(e.target.value);
              setPage(1);
            }}
          >
            {history.map((j) => (
              <option key={j.id} value={j.id}>
                {j.model} · {states[j.state] || j.state} · {j.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p role="status">{msg}</p>
      {job && (
        <>
          {[job.product.note_sample, job.product.note_partial]
            .filter(Boolean)
            .map((n, i) => (
              <p className="ai-warning" key={i}>
                采集范围说明：{n}
              </p>
            ))}
          <div className="ai-coverage">
            <h3>
              {states[job.state]} ·{" "}
              {job.coverage.complete ? "覆盖完整" : "覆盖尚未完整"}
            </h3>
            {job.mock && (
              <p className="ai-warning">
                本地 mock 测试报告，未进行真实文本或图片推理，不可作为购买依据。
              </p>
            )}
            {(!job.coverage.complete || job.report?.partial) && (
              <p className="ai-warning">
                部分结果：仍有未完成、失败或取消的证据。任务结束不代表覆盖完整。
              </p>
            )}
            {job.coverage.images.missingReferences ? (
              <p className="ai-warning">
                有 {job.coverage.images.missingReferences}{" "}
                条晒图线索缺少图片地址，实际图片总数无法确定。下方只统计已提供图片条目。
              </p>
            ) : null}
            <dl>
              {[
                ["评论", job.coverage.comments],
                ["去重图片", job.coverage.images],
                ["处理单元", job.coverage.units],
              ].map(([name, value]) => {
                const v = value as Count;
                return (
                  <div key={name as string}>
                    <dt>{name as string}</dt>
                    <dd>
                      {v.completed} / {v.total} 完成 · {v.failed} 失败/取消
                    </dd>
                  </div>
                );
              })}
            </dl>
            <progress
              value={job.coverage.units.completed + job.coverage.units.failed}
              max={Math.max(1, job.coverage.units.total)}
            />
            <p>
              模型：{job.model} · 分析时间：
              {job.report
                ? new Date(job.report.generatedAt).toLocaleString("zh-CN")
                : "进行中"}{" "}
              · 处理尝试 {job.usage.attempts} 次 · 缓存命中{" "}
              {job.usage.cache_hits} 次 · 已记录输入/输出 token：
              {job.usage.prompt_tokens} / {job.usage.completion_tokens}
            </p>
            <p>
              恢复历史报告不会重新调用模型。重试只处理未成功的单元，可能新增服务费用。退出登录不会自动取消后台任务；如需停止处理，请先取消任务。
            </p>
            {["queued", "running"].includes(job.state) && (
              <button
                className="ghost-btn"
                disabled={busy}
                onClick={() => void act("cancel")}
              >
                取消 AI 任务
              </button>
            )}
            {(job.errorsTotal > 0 || job.state === "cancelled") && (
              <button
                className="ghost-btn"
                disabled={busy}
                onClick={() => void act("retry")}
              >
                重试失败 / 取消项
              </button>
            )}
          </div>
          {job.report && (
            <>
              <p>{job.report.method}</p>
              <nav className="ai-sections" aria-label="报告章节">
                {sections.map(([id, label]) => (
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
              </nav>
              <h3>{sections.find(([id]) => id === category)?.[1]}</h3>
              {findings.map((f) => (
                <article className="ai-finding" key={f.id}>
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
                        查看 {q.commentId}
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
                        评论 {id}
                      </button>
                    ))}
                    {f.images.map((id) => (
                      <button
                        className="chip"
                        key={id}
                        onClick={() => void showEvidence("image", id)}
                      >
                        图片 {id.slice(0, 9)}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
              {!findings.length && (
                <p>
                  本章节没有经过证据校验的实质发现；不会补写没有依据的结论。
                </p>
              )}
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
            </>
          )}
          {job.errorsTotal > 0 && (
            <details>
              <summary>查看失败项（{job.errorsTotal} 项）</summary>
              <p>下方最多列出 100 项，覆盖计数包含全部失败项。</p>
              {job.failures.map((f) => (
                <p key={f.id}>
                  {f.kind === "image" ? "图片" : "文本"}：
                  {errorText[f.error] || "处理未完成，请重试或联系管理员"}{" "}
                  {f.comment_ids.map((id) => (
                    <button
                      className="chip"
                      key={id}
                      onClick={() => void showEvidence("comment", id)}
                    >
                      {id}
                    </button>
                  ))}
                </p>
              ))}
            </details>
          )}
          {evidence && (
            <aside className="ai-evidence" aria-label="原始证据">
              <button className="ghost-btn" onClick={() => setEvidence(null)}>
                关闭证据
              </button>
              {evidence.comment && (
                <>
                  <h3>
                    评论 {evidence.comment.id} · 原评论编号{" "}
                    {evidence.comment.source_id || "未提供"}
                  </h3>
                  <p className="ai-source-text">{evidence.comment.data.text}</p>
                  {evidence.comment.data.text_full !==
                    evidence.comment.data.text && (
                    <p className="ai-source-text">
                      {evidence.comment.data.text_full}
                    </p>
                  )}
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
                      关联图片 {i.id.slice(0, 9)}
                    </button>
                  ))}
                </>
              )}
              {evidence.image && (
                <>
                  <h3>图片证据 {evidence.image.id}</h3>
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
                      关联评论 {c.id}
                    </button>
                  ))}
                </>
              )}
            </aside>
          )}
        </>
      )}
    </section>
  );
}
