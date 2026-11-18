import {AIReport} from './AIReport';
import {UpgradeDialog} from './UpgradeDialog';
import { Account, CloudHistory } from './Account';
import type { User } from './Account';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Desk } from "./Desk";
import { Library } from "./Library";
import { briefRows } from "./widgets";
import {
  analyzeServer, api, archiveList, archiveRemove, archiveSave, buildCsvLocal, buildPayloadJson,
  csvRowsToComments, fmt, guessPid, normalizeProductInput, payloadFromJson, postJson, relay, resetCookies, PassRequired,
  taskQueueAdd, taskQueueList, taskQueueRemove, taskQueueTouch, QUEUE_MAX_TRIES,
} from "./api";
import type { Analysis, ArchiveEntry, CommentInput, CommentRow, JobState, Product, QueuedTask } from "./api";
import { SAMPLE_BY_PID } from "./samples";

const bell = (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
    <defs>
      <symbol id="ico-bell" viewBox="0 0 24 24">
        <path d="M12 2a6 6 0 0 1 6 6v4l2 3H4l2-3V8a6 6 0 0 1 6-6z" />
        <circle cx="12" cy="19" r="2.2" />
      </symbol>
      <symbol id="ico-wave" viewBox="0 0 24 24">
        <path d="M3 12h2l2-6 3 14 3-11 2 5 2-3h4" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      </symbol>
    </defs>
  </svg>
);

const STAGES = [
  { key: "warming", zh: "链接→商品号→预热通道", en: "prime + cookies" },
  { key: "listing", zh: "翻页抓列表", en: "comment/list" },
  { key: "detailing", zh: "进详情页读全文", en: "comment/detail" },
  { key: "analyzing", zh: "本地情感引擎", en: "lexicon-blend" },
  { key: "done", zh: "洞察出炉", en: "insights" },
];

const egrText = (s: string) => (s === "clear" ? "畅通" : s === "waf" ? "被风控" : "未测");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const freshJob = (): JobState => ({
  status: "running", phase: "warming", pages_done: 0, pages_total: 0, comments_done: 0,
  details_done: 0, details_total: 0, error: null, log: [],
});

export function App({sessionUser,onSessionChange}:{sessionUser:User;onSessionChange:(u:User|null)=>void}) {
  const [upgrade,setUpgrade]=useState(false);
  const [analysisTab,setAnalysisTab]=useState<"basic"|"ai">("basic");
  const [cloudRun,setCloudRun]=useState<{product:Product;id:string;owner:string}|null>(null);
  const [user,setUser]=useState<User|null>(sessionUser);
  const [accountOpen,setAccountOpen]=useState(false);
  const [cloudStatus,setCloudStatus]=useState('');
  const ownerRef=useRef<User|null>(sessionUser);
  const accountEpoch=useRef(0);
  const cloudDesk=useRef(false);
  const pendingTask=useRef<(()=>void)|null>(null);
  const pendingSave=useRef<{owner:string;epoch:number;key:string;product:Product;comments:CommentRow[]}|null>(null);
  function changeUser(next:User|null) {
    const prev=ownerRef.current;
    if(prev?.id!==next?.id) {
      accountEpoch.current++;
      setCloudRun(null);setAnalysisTab("basic");
      if(prev)pendingTask.current=null;
      pendingSave.current=null;setCloudStatus(prev?'账户会话已结束或切换。未上传的结果仍可导出。':'');
      if(cloudDesk.current){genRef.current++;setProduct(null);setComments([]);cloudDesk.current=false;}
    }
    ownerRef.current=next;setUser(next);
    if(next?.verified&&pendingTask.current){const task=pendingTask.current;pendingTask.current=null;task();}
  }
  useEffect(()=>{changeUser(sessionUser);},[sessionUser]);
  useEffect(()=>{ownerRef.current=sessionUser;return()=>{genRef.current++;accountEpoch.current++;ownerRef.current=null;cancelRef.current=true;pendingSave.current=null;pendingTask.current=null;};},[]);
  const saveKeys=useRef(new WeakMap<Product,Map<string,string>>());
  async function saveCloud(p:Product,c:CommentRow[],owner:User|null,epoch:number,key?:string) {
    let keys=saveKeys.current.get(p);if(!keys){keys=new Map();saveKeys.current.set(p,keys);}
    key=key||keys.get(owner?.id||'')||crypto.randomUUID();keys.set(owner?.id||'',key);
    if(!owner?.verified){setCloudStatus('仅保存在本浏览器；登录并验证邮箱后可手动保存');return;}
    if(ownerRef.current?.id!==owner.id||accountEpoch.current!==epoch)return;
    pendingSave.current={owner:owner.id,epoch,key,product:p,comments:c};
    setCloudStatus('正在保存到云端…');
    try { const saved=await postJson<{id:string}>('/api/history',{key,ownerId:owner.id,product:p,comments:c});
      if(accountEpoch.current!==epoch)return false;
      if(productRef.current===p)setCloudRun({product:p,id:saved.id,owner:owner.id});
      window.dispatchEvent(new Event('ddv-cloud-saved'));
      if(pendingSave.current?.key===key){setCloudStatus('已保存到当前账户云端');pendingSave.current=null;}
      return true;
    } catch(e){if(accountEpoch.current===epoch&&pendingSave.current?.key===key)setCloudStatus('云端保存失败：'+(e as Error).message+'。结果仍可导出，可重试保存。');return false;}
  }
  const [gateInfo, setGateInfo] = useState<{ gated: boolean; unlocked: boolean } | null>(null);
  const [unlockedNow, setUnlockedNow] = useState(false);
  const [gateError, setGateError] = useState("");
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(37);
  const [maxDetails, setMaxDetails] = useState(140);
  const [pasteText, setPasteText] = useState("");
  const [collectErr, setCollectErr] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [channel, setChannel] = useState({ list: "unknown", detail: "unknown" });
  const [archive, setArchive] = useState<ArchiveEntry[]>([]);
  const [report, setReport] = useState(false);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const genRef = useRef(0); // newest user-visible owner of desk state
  const intentSeqRef = useRef(0);
  const productRef = useRef<Product | null>(null);
  productRef.current = product;
  const [runPid, setRunPid] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedTask[]>(() => taskQueueList());
  const queueBusyRef = useRef(false);

  /* unified live log — the HH:MM:SS console pattern, fed by every subsystem */
  const [applog, setApplog] = useState<string[]>(() => {
    try { const v = JSON.parse(sessionStorage.getItem(["ddv","log","v1"].join("-")) || "[]"); return Array.isArray(v) ? v.slice(0, 60) : []; } catch { return []; }
  });
  const logEvent = (m: string) => setApplog((prev) => {
    const line = `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${m}`;
    const next = [line, ...prev].slice(0, 60);
    try { sessionStorage.setItem(["ddv", "log", "v1"].join("-"), JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const logSeeded = useRef(false);
  if (!logSeeded.current) { logSeeded.current = true; if (!applog.length) queueMicrotask(() => logEvent("会话就绪 · dangdangvoice 声纹日志开始记录")); }

  // The landing and local tools remain public; owner gate adds a relay restriction.
  const ownerGateLocked = !!gateInfo?.gated && !gateInfo.unlocked && !unlockedNow;
  const gateRequirementRef=useRef(false);
  gateRequirementRef.current=ownerGateLocked;
  const hot = job?.status === "running";
  const pidHint = useMemo(() => guessPid(url), [url]);

  const restoreArchive = useCallback(async (entry: ArchiveEntry, scroll = true, preempt = true) => {
    if (preempt) { genRef.current += 1; cancelRef.current = true; pendingSave.current=null;setCloudStatus(entry.cloudKey?"已恢复云端记录":"已恢复本浏览器记录"); }
    const g = genRef.current; // snapshot ownership; a newer run invalidates us
    try {
      let analysis = entry.product.analysis;
      if (!analysis) {
        const res = await analyzeServer(entry.comments as CommentInput[], entry.product.name ?? null, entry.product.site);
        analysis = res.analysis;
      }
      if (genRef.current !== g) return; // a live run took the desk while we awaited
      const p: Product = { ...entry.product, analysis, comments_count: entry.comments.length } as Product;
      if(entry.cloudKey && ownerRef.current) saveKeys.current.set(p,new Map([[ownerRef.current.id,entry.cloudKey]]));
      if(entry.cloudRunId&&ownerRef.current)setCloudRun({product:p,id:entry.cloudRunId,owner:ownerRef.current.id});
      setComments(entry.comments);
      setProduct(p);
      setJob((prev) => prev && prev.status !== "running" ? { ...prev, status: "done", phase: "done" } : prev);
      if (scroll) document.getElementById("desk")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { setCollectErr("档案恢复失败 — 该商品的存档不完整，请重新采集或导入"); logEvent("档案恢复失败（存档不完整）"); }
  }, []);

  // boot: gate check + restore last browser archive (fully local)
  useEffect(() => {
    (async () => {
      let g = { gated: false, unlocked: true };
      try { g = await api<{ gated: boolean; unlocked: boolean }>("/api/session"); }
      catch { g = { gated: false, unlocked: true }; }
      setGateInfo(g);
      setArchive(archiveList());
      {
        const a = archiveList();
        if (a.length) restoreArchive(a[0], false, false);
      }
    })();
  }, [restoreArchive]);

  /* runLive: full workflow from a task descriptor. Returns true when a desk
     was produced (live or sample). Persists a retry queue otherwise. */
  async function runTask(task: QueuedTask, gentle = false): Promise<boolean> {
    const { pid } = task;
    const taskOwner=ownerRef.current, taskEpoch=accountEpoch.current;
    if(!taskOwner?.verified || (task.ownerId && task.ownerId!==taskOwner.id)) return false;
    cloudDesk.current=false;pendingSave.current=null;setCloudStatus('');
    const maxPages = task.maxPages, maxDetails = task.maxDetails;
    if (runningRef.current) {
      if (gentle) return false;                       // background tick yields to user
      cancelRef.current = true;                       // user pre-empts an in-flight run
      for (let t = 0; t < 16 && runningRef.current; t++) await sleep(500);
      if (runningRef.current) { setCollectErr("上一次任务几秒内未能收尾，稍等再点一次"); return false; }
    }
    const showPanel = !gentle || !productRef.current;  // panel choice at start (display only)
    const deskSwitch = showPanel;                       // used for runPid/job churn
    const myGen = !gentle ? ++genRef.current : genRef.current; // background runs claim NOTHING
    if (deskSwitch) setRunPid(pid);
    runningRef.current = true;
    cancelRef.current = false;
    setCollectErr("");
    let j = freshJob();
    const push = (m: string) => { j = { ...j, log: [...j.log.slice(-40), `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${m}`] }; if (deskSwitch) setJob(j); logEvent(m); };
    const patch = (d: Partial<JobState>) => { j = { ...j, ...d }; if (deskSwitch) setJob(j); };
    if (deskSwitch) setJob(j); else logEvent(`后台队列任务启动 #${task.pid} —— 不打断当前画面`);
    const byCid = new Map<string, CommentInput & { cid: string }>();
    const meta: { name: string | null; price: string | null; image: string | null } = { name: null, price: null, image: null };
    let site: Record<string, unknown> | undefined;
    let firstAnswered = false;      // list endpoint replied (not WAF) on page 1
    let firstBlocked = true;
    let notePartial = "";
    let commitBusy = false;
    const prodOf = (analysis: Analysis): Product => ({
      pid, name: meta.name, price: meta.price, image: meta.image,
      url: task.url || `https://product.dangdang.com/${pid}.html`, analysis, source: "relay",
      comments_count: analysis.total, collected_at: Date.now(),
    });
    const commitLive = async () => { // progressive live desk
      if (genRef.current !== myGen || commitBusy || !byCid.size) return;
      commitBusy = true;
      try {
        const r2 = await analyzeServer([...byCid.values()], meta.name, site);
        if (genRef.current !== myGen) return;
        if (notePartial) r2.analysis.note_partial = notePartial;
        setComments(r2.comments); setProduct(prodOf(r2.analysis));
      } catch { /* transient analyze hiccups are retried at next checkpoint */ }
      finally { commitBusy = false; }
    };
    try {
      // -- phase 0: warm the WAF channel; product meta from the real page
      {
        if (!gentle) push("预热当当通道（真实商品页 + cookie 会话）…");
        try {
          const pr = await relay("prime", { pid });
          setChannel((c) => ({ ...c, list: pr.blocked ? c.list : "clear" }));
          if (pr.meta?.name) meta.name = pr.meta.name;  // canonical: title of THE requested id
          if (!gentle) push(meta.name ? `商品页就位：${meta.name.slice(0, 22)}` : "商品页通道受阻，继续按步重试…");
        } catch { if (!gentle) push("预热请求失败，略过"); }
      }

      // -- phase 1: enumerate browseable list pages, per-page ladder
      patch({ phase: "listing" });
      if (gentle) {
        try {
          const probe = await relay("list", { pid, pageIndex: 1 });
          setChannel((c) => ({ ...c, list: probe.blocked ? "waf" : "clear" }));
          if (probe.blocked || !((probe.items || []).length) && Number(probe.summary?.total_comment_num || 0) > 0) {
            setQueue(taskQueueAdd({ pid, url: task.url, maxPages, maxDetails, intentAt: task.intentAt, ownerId: taskOwner?.id }));
            j = { ...j, status: "queued", phase: "listing" }; if (deskSwitch) setJob(j);
            push("重试探测：通道仍未开放 —— 保持排队，下次重试见队列表");
            return false;
          }
        } catch {
          setQueue(taskQueueAdd({ pid, url: task.url, maxPages, maxDetails, intentAt: task.intentAt, ownerId: taskOwner?.id }));
          j = { ...j, status: "queued", phase: "listing" }; if (deskSwitch) setJob(j);
          push("重试探测失败 —— 保持排队");
          return false;
        }
      }
      let pageCount = 1;
      for (let pg = 1; pg <= maxPages; pg++) {
        if (cancelRef.current) { j = { ...j, status: "cancelled", phase: "done" }; if (deskSwitch) setJob(j); setQueue(taskQueueRemove(pid,taskOwner.id)); push("已停止并移出队列"); return false; }
        let got = null as null | Awaited<ReturnType<typeof relay>>;
        for (let attempt = 0; attempt < (gentle ? 1 : 3) && !got; attempt++) {
          let t = null as Awaited<ReturnType<typeof relay>> | null;
          try { t = await relay("list", { pid, pageIndex: pg }); }
          catch (e) { if (e instanceof PassRequired) throw e; t = null; }
          if (t && !t.blocked) { setChannel((c) => ({ ...c, list: "clear" })); got = t; }
          else {
            if (t) setChannel((c) => ({ ...c, list: "waf" }));
            if (attempt < 2) { push(`第${pg}页${t ? "被风控" : "中继抖动"}，等待后重试 ${attempt + 1}/2…`); await sleep(rnd(3200, 6200) * (attempt + 1)); await relay("prime", { pid }).catch(() => undefined); }
            else push(`第${pg}页仍不可达 —— 先用已有数据继续`);
          }
        }
        if (!got) { firstBlocked = true; notePartial = `⚠ 风控拦截：列表翻到第 ${pg - 1} 页停止`; break; }
        if (pg === 1) { firstAnswered = true; firstBlocked = false; }
        if (pg === 1) {
          site = {
            total_comment_num: (got.summary?.total_comment_num as string) ?? null,
            pageCount: (got.summary?.pageCount as string) ?? null,
            average_score: (got.summary?.average_score as string) ?? null,
            total_crazy_count: (got.summary?.total_crazy_count as string) ?? null,
            total_indifferent_count: (got.summary?.total_indifferent_count as string) ?? null,
            total_detest_count: (got.summary?.total_detest_count as string) ?? null,
          };
          pageCount = Math.min(maxPages, Math.max(1, Number(got.summary?.pageCount ?? 1) || 1));
          patch({ pages_total: pageCount });
          const total = Number(got.summary?.total_comment_num ?? 0);
          const n1 = (got.items || []).length;
          if (pageCount <= 1 && total > n1)
            push(`注意：当当评论模板对本商品只提供 ${n1} 条翻阅（站点总数 ${total}，可翻页数=${got.summary?.pageCount}）—— 这是站方深度上限，不是漏采`);
        }
        for (const it of got.items || []) if (it.cid) byCid.set(String(it.cid), { ...it, cid: String(it.cid) });
        patch({ pages_done: pg, comments_done: byCid.size });
        push(`第${pg}页 ✓ +${(got.items || []).length} 条`);
        if (pg === 1 || pg % 6 === 0) void commitLive();
        if (pg >= pageCount) break;
        await sleep(rnd(450, 950));
      }
      if (!byCid.size) {
        const tot0 = Number((site || {}).total_comment_num || 0);
        if (firstAnswered && !firstBlocked && tot0 === 0) {
          const zero = { total: 0, meaningful: 0, auto_reviews: 0, auto_share: 0, image_reviews: 0,
            avg_score: null, labels: { pos: 0, neu: 0, neg: 0 }, pos_rate: 0, neg_rate: 0, score_hist: {},
            themes: [], top_neg_themes: [], pos_words: [], neg_words: [], red_flags: [], red_flag_count: 0,
            variants: [], trend: [], examples_pos: [], examples_neg: [], engine: "lexicon-blend (portable)",
            note_sample: "通道正常但该商品编号没有可翻阅的公开评论（站点计数 0 条）。可能是错误编号或已下架商品，请核对链接。" } as unknown as Analysis;
          const prodZ: Product = { ...prodOf(zero) };
          if ((gentle ? !productRef.current : genRef.current === myGen)) { setComments([]); setProduct(prodZ); setRunPid(null); }
          else logEvent(`#${pid} 站点可翻阅评论为 0（已移出队列，未切换画面）`);
          j = { ...j, status: "done", phase: "done" }; if (deskSwitch) setJob(j);
          push("完成 ✓（商品评论为空，已如实标注）");
          void saveCloud(prodZ,[],taskOwner,taskEpoch);
          setQueue(taskQueueRemove(pid,taskOwner.id));
          return true;
        }
        const smp = SAMPLE_BY_PID[pid];
        if (!smp) {
          // channel inside a WAF window: keep the task queued instead of dying
          setQueue(taskQueueAdd({ pid, url: task.url, maxPages, maxDetails, intentAt: task.intentAt, ownerId: taskOwner?.id }));
          j = { ...j, status: "queued" as JobState["status"], error: null };
          push("实时通道处于风控窗口 —— 任务已进入自动重试队列（最长约 10 分钟，关页也不丢）");
          if (deskSwitch) setJob(j);
          return false;
        }
        push("实时通道被占 —— 改用本商品内置真实样例（当日实测采集）完整走分析流程");
        Object.assign(meta, { name: smp.product.name, price: smp.product.price, image: smp.product.image });
        const resS = await analyzeServer(smp.comments as CommentInput[], smp.product.name, smp.product.analysis?.site ?? smp.product.site);
        resS.analysis.note_sample = `本结果来自内置真实样例（${new Date(smp.savedAt).toLocaleDateString("zh-CN")} 由同一管线实测采集），非本次实时抓取`;
        const prodS: Product = {
          pid, name: meta.name, price: meta.price, image: meta.image,
          url: url.trim() || `https://product.dangdang.com/${pid}.html`,
          source: "sample", analysis: resS.analysis, comments_count: resS.comments.length, collected_at: Date.now(),
        };
        if (gentle ? !productRef.current : genRef.current === myGen) { setComments(resS.comments); setProduct(prodS); }
        else { try { archiveSave(prodS, resS.comments); setArchive(archiveList()); } catch { /* ignore */ } logEvent(`队列任务 #${pid} 以内置真实数据入库（未切换画面，可在评论记录库查看）`); }
        try { archiveSave(prodS, resS.comments); setArchive(archiveList()); } catch { /* ignore */ }
        void saveCloud(prodS,resS.comments,taskOwner,taskEpoch);
        j = { ...j, status: "done", phase: "done", comments_done: resS.comments.length }; if (deskSwitch) setJob(j); setRunPid(null); push("完成 ✓（已当场改用内置真实数据，见顶部标记）");
        setQueue(taskQueueRemove(pid,taskOwner.id));
        document.getElementById("desk")?.scrollIntoView({ behavior: "smooth" });
        return true;
      }

      // -- phase 2: detail pages (full text + reliable meta)
      patch({ phase: "detailing" });
      const all = [...byCid.values()];
      const truncated = all.filter((c) => (c.text || "").length >= 70 && c.detail_url).slice(0, maxDetails);
      const isExactDetail = (u?: string | null) => !!u && (u as string).includes(`/0/${pid}/`);
      const needMeta = () => !meta.price || !meta.image;   // title already trusted from prime; identity only from exact pages
      const extras = all.filter((c) => isExactDetail(c.detail_url) && !truncated.some((t) => t.cid === c.cid)).slice(0, 3);
      const targets = [...truncated, ...(needMeta() ? extras : [])].filter((c) => c.detail_url);
      patch({ details_total: targets.length });
      for (let i = 0; i < targets.length; i++) {
        if (cancelRef.current) { j = { ...j, status: "cancelled", phase: "done" }; if (deskSwitch) setJob(j); setQueue(taskQueueRemove(pid,taskOwner.id)); push("已停止并移出队列"); return false; }
        const c = targets[i];
        try {
          const d = await relay("detail", { detailUrl: c.detail_url });
          setChannel((ch) => ({ ...ch, detail: d.blocked ? "waf" : "clear" }));
          const f = d.fields as Record<string, unknown> | undefined;
          if (d.blocked || !f) { if (i === 0) push("详情通道受阻，跳过全文精读"); }
          else {
            const cur = byCid.get(String(c.cid));
            if (cur) {
              if (f.text_full && String(f.text_full).length >= (cur.text || "").length) cur.text_full = String(f.text_full);
              if (f.score != null && cur.score == null) cur.score = f.score as number;
              if (f.date && !cur.date) cur.date = String(f.date);
              if (f.user && !cur.user) cur.user = String(f.user);
              if (f.level && !cur.level) cur.level = String(f.level);
              if (f.has_img) cur.has_img = true;
              if (Array.isArray(f.pics) && f.pics.length && (!(cur as { pics?: unknown[] }).pics || (cur as { pics?: unknown[] }).pics!.length < f.pics.length)) (cur as { pics?: unknown[] }).pics = f.pics;
            }
            if (isExactDetail(c.detail_url as string | null)) {  // NEVER adopt a variant SKU's identity
              if (f.product_name && !meta.name) meta.name = String(f.product_name);
              if (f.image) meta.image = String(f.image);
              if (f.price) meta.price = String(f.price);
            }
          }
        } catch { /* skip one */ }
        patch({ details_done: i + 1, comments_done: byCid.size });
        if ((i + 1) % 10 === 0) { push(`详情全文 ${i + 1}/${targets.length}`); void commitLive(); }
        await sleep(rnd(240, 480));
      }

      // -- phase 3: stateless analysis on the server engine
      patch({ phase: "analyzing" });
      push("本地词典 + 星级引擎分析中…");
      const res = await analyzeServer([...byCid.values()], meta.name, site);
      if (notePartial) res.analysis.note_partial = notePartial;
      const prod: Product = { ...prodOf(res.analysis), url: url.trim() || `https://product.dangdang.com/${pid}.html` };
      try { archiveSave(prod, res.comments); setArchive(archiveList()); } catch { /* ignore */ }
      setQueue(taskQueueRemove(pid,taskOwner.id));
      void saveCloud(prod,res.comments,taskOwner,taskEpoch);
      const claimLive = gentle ? !productRef.current : genRef.current === myGen;
      if (!claimLive) {
        logEvent(`队列任务 #${pid} 完成并入库（${res.comments.length} 条）—— 未切换当前画面，可在「评论记录库」查看`);
        if (!productRef.current) { setComments(res.comments); setProduct(prod); patch({ status: "done", phase: "done", comments_done: res.comments.length }); }
        return true;
      }
      if (genRef.current !== myGen) return true;
      setComments(res.comments);
      setProduct(prod);
      patch({ status: "done", phase: "done", comments_done: res.comments.length });
      setRunPid(null);
      push("完成 ✓ 已同时写入浏览器档案");
      document.getElementById("desk")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    } catch (e) {
      if (e instanceof PassRequired) { setGateInfo({ gated: true, unlocked: false }); setJob(null); return false; }
      const msg = String((e as Error)?.message || e).slice(0, 300);
      setQueue(taskQueueAdd({ pid, url: task.url, maxPages, maxDetails, intentAt: task.intentAt, ownerId: taskOwner?.id }));
      patch({ status: "queued" as JobState["status"], error: null });
      push("× " + msg + " —— 已保留在队列，稍后自动重试");
      return false;
    } finally {
      runningRef.current = false;
    }
  }

  /* the intake form entry */
  function submitTask(u: string, mp: number, md: number) {
    const norm = normalizeProductInput(u);
    if (!norm.ok) { setCollectErr(norm.msg); logEvent(`投递被拒：${norm.msg}`); return; }
    if(!ownerRef.current?.verified){pendingTask.current=()=>submitTask(u,mp,md);setAccountOpen(true);document.getElementById('account')?.scrollIntoView();setCollectErr('请登录并验证邮箱，随后将继续本次采集');return;}
    if(gateRequirementRef.current){pendingTask.current=()=>submitTask(u,mp,md);setCollectErr('站点管理员已启用采集口令，请在账户区输入站点口令');setAccountOpen(true);return;}
    const iq = ++intentSeqRef.current;
    void runTask({ pid: norm.pid, url: norm.canonical, maxPages: mp, maxDetails: md, addedAt: 0, lastTry: 0, tries: 0, intentAt: iq, ownerId: ownerRef.current.id });
  }

  /* queue daemon: while this tab lives, retry each queued task at widening
     windows; on page open, any leftover queue resumes too */
  useEffect(() => {
    const tick = async () => {
      if (queueBusyRef.current || runningRef.current || !ownerRef.current?.verified) return;
      const now = Date.now();
      const due = taskQueueList()
        .filter((t) => !!t.ownerId && t.ownerId===ownerRef.current?.id)
        .filter((t) => now - t.lastTry > Math.min(120_000, 20_000 * (2 ** Math.min(t.tries % 3, 3))))
        .sort((a, b) => a.lastTry - b.lastTry);
      const t = due[0];
      if (!t) return;
      if (t.tries >= QUEUE_MAX_TRIES) {
        setQueue(taskQueueRemove(t.pid,t.ownerId));
        logEvent(`#${t.pid} 多次重试仍在封窗，已移出队列`);
        setCollectErr(`#${t.pid} 长期处于风控封窗 —— 已移出队列。建议：用「导入模式」或桌面版导出后「导入模式」。`);
        return;
      }
      queueBusyRef.current = true;
      const ck = t.tries === 0 ? t : { ...t }; // marker copy
      taskQueueTouch(t.pid,false,t.ownerId);
      setQueue(taskQueueList());
      try {
        const u2 = ck.url || `https://product.dangdang.com/${ck.pid}.html`;
        const el = document.getElementById("url"); if (el) { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!; set.call(el, u2); el.dispatchEvent(new Event("input", { bubbles: true })); }
        const ownIntent = (ck.intentAt || 0) > 0 && ck.intentAt === intentSeqRef.current;
        if (ownIntent) logEvent(`正在为你最近提交的 #${ck.pid} 重试通道…`);
        await runTask(ck, ownIntent ? false : true);
      } finally { queueBusyRef.current = false; }
    };
    const id = window.setInterval(() => { void tick(); }, 15_000);
    const first = window.setTimeout(() => void tick(), 14_000); // let boot restore settle first
    return () => { window.clearInterval(id); window.clearTimeout(first); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importText(text: string, kindHint?: "csv" | "json") {
    setCollectErr("");
    const importOwner=ownerRef.current, importEpoch=accountEpoch.current;
    cloudDesk.current=false;pendingSave.current=null;setCloudStatus('');
    try {
      if (!text.trim()) throw new Error("内容为空");
      const kind = kindHint || (text.trimStart().startsWith("{") || text.trimStart().startsWith("[") ? "json" : "csv");
      let rows: CommentInput[] = [], name: string | null = null, pid: string | null = null;
      let price: string | null = null, image: string | null = null, fileUrl: string | null = null, site: unknown;
      if (kind === "json") {
        const p = payloadFromJson(text);
        rows = p.rows; name = p.name; pid = p.pid; price = p.price; image = p.image; fileUrl = p.url;
        try { site = (JSON.parse(text) as { product?: { site?: unknown } })?.product?.site; } catch { /* ignore */ }
      } else {
        const p = csvRowsToComments(text);
        rows = p.rows; name = p.name; pid = p.pid;
      }
      if (!rows.length) throw new Error("没有解析出评论行");
      pid = pid || guessPid(url) || null;
      if (!pid) throw new Error("文件里没有 product_id，也无法从网址推断编号");
      const res = await analyzeServer(rows, name, site);
      const prod: Product = {
        pid, name, price, image, url: fileUrl || `https://product.dangdang.com/${pid}.html`,
        source: "import", analysis: res.analysis, comments_count: res.comments.length, collected_at: Date.now(),
      };
      genRef.current += 1; cancelRef.current = true;
      setRunPid(null);
      setComments(res.comments);
      setProduct(prod);
      try { archiveSave(prod, res.comments); setArchive(archiveList()); } catch { /* ignore */ }
      void saveCloud(prod,res.comments,importOwner,importEpoch);
      document.getElementById("desk")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setCollectErr("导入失败： " + String((e as Error)?.message || e)); logEvent(`导入失败：${String((e as Error)?.message || e).slice(0, 60)}`);
    }
  }

  async function showSample() {
    try {
      const e=Object.values(SAMPLE_BY_PID)[0];if(!e)return;
      const r=await analyzeServer(e.comments,e.product.name||null,e.product.site);
      r.analysis.note_sample='公开内置样例 · 非本次实时采集';cloudDesk.current=false;
      await restoreArchive({...e,product:{...e.product,source:'sample',analysis:r.analysis},comments:r.comments});
    } catch(e) {setCollectErr('样例分析失败：'+(e as Error).message);}
  }
  async function copyLocalArchives() {
    if(!confirm('将本浏览器档案复制到当前账户？请确认这些记录属于你。'))return;
    const owner=ownerRef.current,epoch=accountEpoch.current;
    let successful=0,failed=0;
    for(const entry of archiveList()) {
      if(ownerRef.current?.id!==owner?.id||accountEpoch.current!==epoch)break;
      const p={...entry.product,analysis:entry.product.analysis} as Product;
      if(!p.analysis){failed++;continue;}
      const bytes=new TextEncoder().encode(`${owner?.id}:${entry.product.pid}:${entry.savedAt}`);
      const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
      const key=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
      if(await saveCloud(p,entry.comments,owner,epoch,key))successful++;else failed++;
    }
    if(accountEpoch.current===epoch)setCloudStatus(`本浏览器档案复制完成：${successful} 份成功，${failed} 份失败或不完整。可再次复制重试，已成功的记录不会重复入库。`);
  }
  const stageIdx = job ? STAGES.findIndex((x) => x.key === job.phase) : -1;
  const visibleQueue=queue.filter(t=>!t.ownerId||t.ownerId===user?.id);
  const queuePanel = visibleQueue.length > 0;

  return (
    <>
      {upgrade&&<UpgradeDialog onClose={()=>setUpgrade(false)}/>}
      {bell}
      <header className={`mast ${hot ? "hot" : ""}`}>
        <div className="mast-in">
          <a className="brand" href="#top">
            <span className="bells">
              <svg className="bell b1"><use href="#ico-bell" /></svg>
              <svg className="bell b2"><use href="#ico-bell" /></svg>
            </span>
            <span className="brand-txt"><b>当当之声</b><i>DANGDANGVOICE · PAGES</i></span>
          </a>
          <nav className="mast-nav"><a href="#desk" onClick={()=>setAnalysisTab('basic')}>基础分析</a><a href="#desk" onClick={()=>user?.plan==='pro'?setAnalysisTab('ai'):setUpgrade(true)}>AI 深度分析</a>
            <a href="#collect">采集</a><a href="#flow">工序</a><a href="#desk" onClick={()=>setAnalysisTab("basic")}>声纹台</a><a href="#lib">我的记录</a>
          </nav>
          <span className="mast-tag">评论即声音 · Comment as Sound</span>
        </div>
      </header>

      <Account user={user} onChange={u=>{changeUser(u);onSessionChange(u);}} open={accountOpen} setOpen={setAccountOpen}/>
      {accountOpen&&ownerGateLocked&&<section className="account-panel"><p>管理员额外限制：实时采集需站点口令（与个人账户无关）。</p><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await postJson('/api/session',{passphrase:f.get('passphrase')});setUnlockedNow(true);setGateInfo({gated:true,unlocked:true});setGateError('站点口令已通过');gateRequirementRef.current=false;if(pendingTask.current){const task=pendingTask.current;pendingTask.current=null;task();}}catch(e){setGateError((e as Error).message);}}}><input name="passphrase" type="password" required aria-label="站点采集口令"/><button className="ghost-btn">验证站点口令</button></form><p role="status">{gateError}</p></section>}
      <section className="account-panel"><button className="ghost-btn" onClick={()=>void showSample()}>查看示例数据（已标注来源）</button><p role="status">{cloudStatus}</p>{product&&<button className="ghost-btn" onClick={()=>{const v=pendingSave.current;if(v&&v.product===product&&v.owner===ownerRef.current?.id&&v.epoch===accountEpoch.current)void saveCloud(v.product,v.comments,ownerRef.current,v.epoch,v.key);else void saveCloud(product,comments,ownerRef.current,accountEpoch.current);}}>保存当前结果 / 重试云端保存</button>}</section>
        <section id="top" className="hero">
          <div className="hero-in">
            <div className="hero-copy">
              <p className="eyebrow">BOOKSELLER REVIEW FORENSICS · 图书电商评论透视</p>
              <h1 className="serif">把当当的商品页，<br />调成一段<span className="hl-snd">可听的声纹</span>。</h1>
              <p className="lede">粘贴任意当当商品链接 —— 当当之声由<b>浏览器逐页编排</b>、云端无状态中继抓取列表与全文，
                本地词典情感引擎拆穿「好评率」。每段结果同步存入你的浏览器，实例换代也能瞬间找回。</p>
              <div className="status-strip" role="status">
                <span className={`st-pill ${channel.list}`}>列表通道 {egrText(channel.list)}</span>
                <span className={`st-pill ${channel.detail}`}>详情通道 {egrText(channel.detail)}</span>
                <span className="st-note">浏览器编排 · 服务端无作业状态 · 风控拦页自动逐级重试 · 档案存本地。</span>
              </div>
              {!product && archive.length > 0 && (
                <div className="quick-archive" role="region" aria-label="浏览器档案快捷恢复">
                  <p className="qa-h">🗂 浏览器档案 · 离线瞬间找回</p>
                  {archive.slice(0, 3).map((e) => (
                    <div key={e.product.pid} className="qa-row">
                      <button type="button" onClick={() => {cloudDesk.current=false;void restoreArchive(e);}}>
                        <b>{(e.product.name || e.product.pid).slice(0, 26)}</b>
                        <span className="mono"> · {e.comments.length} 条 · {new Date(e.savedAt).toLocaleDateString("zh-CN")}</span>
                      </button>
                      <button type="button" className="hp-del" title="删除本地档案"
                        onClick={() => setArchive(archiveRemove(e.product.pid))}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form id="collect" className="catalog" onSubmit={(e) => { e.preventDefault(); submitTask(url, maxPages, maxDetails); }}>
              <div className="cat-head">
                <span className="cat-no">NO. <b>{(pidHint || "0000").slice(-4)}</b></span>
                <span className="cat-stamp">投递口 / INTAKE</span>
              </div>
              <label className="cat-label" htmlFor="url">商品网址 — Product URL</label>
              <input id="url" value={url} spellCheck={false} autoComplete="off"
                onChange={(e) => { setUrl(e.target.value); setCollectErr(""); }}
                placeholder="https://product.dangdang.com/30049142.html" />
              <p className="cat-help">
                {pidHint
                  ? <>✓ 识别到商品编号 <b className="mono">{pidHint}</b> — product / www / item / m 站点与纯编号都可</>
                  : "支持 product.dangdang.com/{id}.html、m.dangdang.com/product.php?product_id=… 或直接粘贴编号"}
              </p>
              <div className="cat-row">
                <label>翻阅页数 <output>{maxPages === 37 ? "全部(≤37)" : `${maxPages} 页`}</output>
                  <input type="range" min={1} max={37} value={maxPages} onChange={(e) => setMaxPages(+e.target.value)} />
                </label>
                <label>详情精读 <output>{maxDetails === 0 ? "跳过" : `${maxDetails} 条`}</output>
                  <input type="range" min={0} max={370} step={10} value={maxDetails} onChange={(e) => setMaxDetails(+e.target.value)} />
                </label>
              </div>
              <button className="go" type="submit" disabled={hot}>
                <svg className="go-wave"><use href="#ico-wave" /></svg>
                {hot ? "正在听…" : "开始听 — Collect & Analyze"}
              </button>
              {hot && (
                <button className="ghost-btn stop-btn" type="button"
                  onClick={() => { cancelRef.current = true; }}>停止本轮</button>
              )}
              <p className="go-note">礼貌限速 · 通道被占自动排队重试 · 结果即时存入浏览器档案</p>
              {queuePanel && (
                <div className="queue-box" role="status">
                  <p className="qb-h">⏳ 自动重试队列（关页面也不丢，回来继续跑）</p>
                  {visibleQueue.map((t) => (
                    <div key={t.pid} className="qb-row">
                      <span className="mono">#{t.pid}</span>
                      <span>第 {t.tries + 1} 次将在 {Math.max(5, Math.round((20_000 * Math.pow(2, Math.min(t.tries % 3, 3)) - (Date.now() - t.lastTry)) / 1000))}s 后</span>
                      <span className="qb-act">
                        <button type="button" onClick={() => submitTask(t.url || t.pid, t.maxPages, t.maxDetails)}>立即重试</button>
                        <button type="button" className="qb-x" onClick={() => setQueue(taskQueueRemove(t.pid,t.ownerId))}>移出</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {collectErr && <p className="cat-err" role="alert">✗ {collectErr}</p>}

              <details className="import-box">
                <summary>导入模式 — 桌面版 CSV / 完整档案 JSON（离线分析）</summary>
                <input type="file" accept=".csv,.json,.txt" onChange={async (ev) => {
                  const f = ev.target.files?.[0];
                  if (!f) return;
                  await importText(await f.text(), f.name.endsWith(".json") ? "json" : "csv");
                  ev.target.value = "";
                }} />
                <textarea rows={4} placeholder="…或直接粘贴 CSV / JSON 文本" value={pasteText}
                  onChange={(ev) => setPasteText(ev.target.value)} />
                <button type="button" className="ghost-btn" disabled={!pasteText.trim()}
                  onClick={() => importText(pasteText)}>导入并分析</button>
              </details>

            </form>
          </div>
        </section>

        {(job || applog.length > 0) && (
          <section id="flow" className="flow" aria-live="polite">
            <div className="flow-in">
              <div className="flow-title">
                <h2 className="serif">{job && hot ? "声纹正在成形" : job && job.status === "done" ? "本轮日志 · 已完成" : "声纹日志"} <i className="mono">{job?.status === "running" ? runPid || "" : ""}</i></h2>
                {job && hot && <button className="ghost-btn" onClick={() => { cancelRef.current = true; }}>停止</button>}
                {applog.length > 0 && (!job || job.status !== "running") && (
                  <button className="ghost-btn" onClick={() => { setApplog([]); try { sessionStorage.removeItem(["ddv", "log", "v1"].join("-")); } catch { /* ignore */ } }}>清空日志</button>
                )}
              </div>
              {job && (
                <>
                  <ol className="stages">
                    {STAGES.map((stg, i) => {
                      const bad = job.status === "error" || job.status === "cancelled";
                      const cls = bad
                        ? (i <= stageIdx || stageIdx < 0 ? (i === Math.max(stageIdx, 0) ? "err" : "ok") : "")
                        : job.status === "done" ? "ok"
                        : stageIdx > i ? "ok" : stageIdx === i ? (job.status === "queued" ? "cur cur-queued" : "cur") : "";
                      return <li key={stg.key} className={cls}><span className="dot" /><b>{stg.zh}</b><i>{stg.en}</i></li>;
                    })}
                  </ol>
                  <div className="meters">
                    <div className="meter"><b>{job.pages_done}/{job.pages_total || "…"}</b><span>列表页</span></div>
                    <div className="meter"><b className="mono">{fmt(job.comments_done)}</b><span>已收评论</span></div>
                    <div className="meter"><b className="mono">{fmt(job.details_done)}{job.details_total ? `/${job.details_total}` : ""}</b><span>详情全文</span></div>
                  </div>
                  {job.error && <p className="cat-err" role="alert">✗ {job.error}</p>}
                </>
              )}
              <pre className="tail mono">{applog.slice(0, 9).reverse().join("\n")}</pre>
            </div>
          </section>
        )}

        <nav className="analysis-tabs" aria-label="分析模式"><button className={`chip ${analysisTab==='basic'?'on':''}`} onClick={()=>setAnalysisTab('basic')}>基础分析</button><button className={`chip ${analysisTab==='ai'?'on':''}`} onClick={()=>user?.plan==='pro'?setAnalysisTab('ai'):setUpgrade(true)}>AI 深度分析</button></nav>
        {analysisTab==='basic'&&product && <Desk product={product} comments={comments} listeningPid={runPid && runPid !== product.pid ? runPid : null} />}
        {analysisTab==='ai'&&<AIReport key={`${user?.id}:${user?.plan}:${cloudRun?.product===product?cloudRun.id:'none'}`} user={user} runId={cloudRun?.product===product&&cloudRun?.owner===user?.id?cloudRun.id:null}/> }

        {(archive.length > 0 || product || user) && (
          <section id="lib" className="lib">
            <div className="lib-in">
              <p className="eyebrow">COMMENT LIBRARY · 评论记录库 — 所有采集过的商品</p>
              {user&&<CloudHistory key={user.id} user={user} onOpen={e=>{cloudDesk.current=true;void restoreArchive(e);}} onCopy={()=>void copyLocalArchives()}/>}
              <h3>本浏览器记录（仅此设备）</h3>
              <Library entries={archive} currentPid={product ? product.pid : null}
                onOpen={(e) => {cloudDesk.current=false;void restoreArchive(e);}} />
            </div>
          </section>
        )}

        <footer className="foot">
          <div className="foot-in">
            <div className="foot-brand">
              <svg className="bell"><use href="#ico-bell" /></svg>
              <svg className="bell"><use href="#ico-bell" /></svg>
              <b>当当之声 dangdangvoice</b>
            </div>
            <p>浏览器编排 · 无状态中继 · 本地词典 + 星级引擎（可离线复现）· 持久 = 你的浏览器档案 + CSV/JSON 导出。</p>
            {product && (
              <div className="foot-dl">
                <button className="dl" type="button" onClick={() => {
                  const csv = buildCsvLocal(product.pid, product.name || "", comments);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
                  a.download = `dangdangvoice_${product.pid}.csv`; a.click(); URL.revokeObjectURL(a.href);
                }}>⬇ 评论 CSV</button>
                <button className="dl ghost" type="button" onClick={() => {
                  const j = buildPayloadJson(product, comments);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([j], { type: "application/json" }));
                  a.download = `dangdangvoice_${product.pid}_archive.json`; a.click(); URL.revokeObjectURL(a.href);
                }}>⬇ 完整档案 JSON</button>
                <button className="dl ghost" type="button" onClick={() => setReport((v) => !v)}>⎋ 文本速览</button>
                <button className="dl ghost" type="button" onClick={() => { resetCookies(); setChannel({ list: "unknown", detail: "unknown" }); }}>↻ 重置中继会话</button>
              </div>
            )}
            {report && product && <pre className="report mono">{reportText(product)}</pre>}
          </div>
        </footer>
    </>
  );
}

function reportText(p: Product): string {
  const a = p.analysis;
  const lines = [`DANGDANGVOICE 当当之声 · 速览 #${p.pid}`, "──────────────────────────────"];
  if (p.name) lines.push(`【商品】${p.name}`);
  for (const [k, v] of briefRows(a)) lines.push(`【${k}】${v}`);
  if (a.note_sample || a.note_partial) lines.push(`【提示】${a.note_sample || a.note_partial}`);
  const rec = a.recommendations;
  if (rec) {
    lines.push(`【买家】${rec.buyers.slice(0, 3).map((x) => x.title).join(" / ")}`);
    lines.push(`【卖家】${rec.sellers.slice(0, 3).map((x) => x.action).join(" / ")}`);
  }
  return lines.join("\n");
}

