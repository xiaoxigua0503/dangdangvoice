import {useState} from 'react';
import {AIEvidenceRail} from './AIEvidenceRail';
export interface Citation {kind:'comment'|'image'|'metadata';id:string;quote:string|null;visibleText:string|null}
interface Paragraph {text:string;citations:Citation[];statistics?:string[]}
export interface ProductReview {
 summary?:string;headline?:string;considerations?:string[];sourceIds?:string[];
 actualModel?:string|null;actualEndpointHost?:string|null;blocked?:{code:string;unprocessed:{comments:number;images:number}}|null;qualityWarning?:string|null;
 providerAttempts?:{attempt:string;model:string|null;endpointHost?:string;fallbackReason?:string|null;error?:string|null;httpStatus?:number;providerCode?:string;cached?:boolean;skipped?:{model:string;reason:string}[];selection?:{skipped:{model:string;reason:string}[]}}[];
 schemaVersion?:number;generatedAt:string;partial:boolean;method:string;hasSynthesis?:boolean;empty?:boolean;
 verdict?:Paragraph;paragraphs?:Paragraph[];imageText?: (Paragraph & {relation:string})[];checks?:Paragraph[];
 qualitySignals?:(Paragraph & {kind:string})[];
 sourceCatalog?:Record<string,{kind:string;text?:string;field?:string}>;
 quality?:{exactComments:string[][];nearComments:string[][];nearMethod:string;comparedPairs:number;defaults:string[];lowInformation:string[];exactImages:string[][];repeatedImageUrls?:{id:string;occurrences:number;comments:string[]}[]};
 scope?:{comments:number;substantive:number;defaults:number;imageReferences:number;uniqueImages:number;unreadImages:number;siteTotal:string|number|null};
 unread?:{id:string;comments:string[];error:string}[];strategy?:string;stages?:number;timings?:{kind:string;ms:string}[];totalMs?:number;
}
const countLabels:Record<string,string>={comments:'快照评论',substantive:'非默认且至少十二字的评论',defaults:'默认评价',imageReferences:'图片地址',uniqueImages:'成功下载的去重图片',unreadImages:'未读图片条目'};
export function AIReviewArticle({report,jobId,showEvidence}:{report:ProductReview;jobId:string;showEvidence:(kind:string,id:string)=>void}) {
 const [filter,setFilter]=useState('exactComments'),[page,setPage]=useState(1);
 const simple=report.schemaVersion===4;
 const hasArticle=report.hasSynthesis!==false&&(simple?!!report.summary?.trim():!!report.verdict?.text?.trim()&&!!report.paragraphs?.some(p=>p.text?.trim()));
 const citations=[report.verdict,...(report.paragraphs||[]),...(report.imageText||[]),...(report.checks||[])].flatMap(p=>p?.citations||[]);
 const references=simple?{comments:(report.sourceIds||[]).filter(id=>id.startsWith('C')),images:(report.sourceIds||[]).filter(id=>id.startsWith('I'))}:{comments:citations.filter(c=>c.kind==='comment').map(c=>c.id),images:citations.filter(c=>c.kind==='image').map(c=>c.id)};
 const hasEvidence=hasArticle&&(references.comments.length>0||references.images.length>0);
 function refs(items:Citation[]) {return <span className="ai-citations">{items.map((c,i)=><button type="button" key={c.kind+c.id+i} title="查看原始来源" aria-label={`查看${c.kind==='comment'?'评论':c.kind==='metadata'?'商家资料':'图片'}证据 ${i+1}`} onClick={()=>showEvidence(c.kind,c.id)}>{c.kind==='comment'?'评':c.kind==='metadata'?'商':'图'} {i+1}</button>)}</span>}
 const p=(item:Paragraph,key:string)=><p key={key}>{item.text} {refs(item.citations||[])}</p>;
 const q=report.quality;
 const filters=q?[
  {key:'exactComments',label:'相同评论原文',kind:'comment',groups:q.exactComments},
  {key:'nearComments',label:'可能近似评论 · 规则筛查',kind:'comment',groups:q.nearComments},
  {key:'defaults',label:'默认评价 · 原始标记',kind:'comment',groups:q.defaults.map(x=>[x])},
  {key:'lowInformation',label:'短于十二字 · 规则筛查',kind:'comment',groups:q.lowInformation.map(x=>[x])},
  {key:'exactImages',label:'相同图片字节 · SHA-256',kind:'image',groups:q.exactImages},
 ]:[];
 const active=filters.find(f=>f.key===filter);
 return <>
  <article className="ai-review-article" aria-label="商品综合解读">
   <header className="ai-article-header">
    <span className="ai-article-label">AI 综合解读</span>
    {hasArticle?<><h2 className="ai-review-verdict">{simple?report.headline||'商品综合解读':report.verdict?.text}</h2>{!simple&&refs(report.verdict?.citations||[])}<p className="ai-article-subtitle">基于本次保存的评论与买家图片{report.partial?' · 部分解读':''}</p></>:<><h2 className="ai-review-verdict">暂未生成综合解读</h2><p className="ai-article-subtitle">{report.empty?'这份快照没有可读评论。':report.blocked?'完整输入超过字节/图片限制，或尚无法确认符合上下文预算，未调用模型。':'当前没有通过校验的综合解读，原始数据与处理记录仍保留。'}</p></>}

   </header>
   {hasArticle&&<div className={`ai-reading-layout${hasEvidence?'':' ai-reading-layout--solo'}`}>
    <div className="ai-reading-main">
     <div className="ai-review-prose">{simple?report.summary?.split(/\n\s*\n|\n/).filter(text=>text.trim()).map((text,i)=><p key={i}>{text}</p>):report.paragraphs?.filter(item=>item.text?.trim()).map((item,i)=>p(item,'p'+i))}</div>
     {simple&&!!report.sourceIds?.length&&<p className="ai-article-subtitle">相关来源 {refs(report.sourceIds.map(id=>({kind:id.startsWith('C')?'comment':'image',id,quote:null,visibleText:null})))}</p>}
     {simple&&!!report.considerations?.length&&<aside className="ai-review-checks"><h3>购买前确认</h3>{report.considerations.map((text,i)=><p key={i}>{text}</p>)}</aside>}
     {!!report.imageText?.length&&<section className="ai-review-photos" aria-label="图文对照"><h3>评论与图片对照</h3>{report.imageText.map((item,i)=><div className="ai-photo-observation" key={i}>{p(item,'photo'+i)}</div>)}</section>}
     {!!report.checks?.length&&<aside className="ai-review-checks"><h3>购买前确认</h3>{report.checks.map((item,i)=>p(item,'check'+i))}</aside>}
    </div>
    {hasEvidence&&<AIEvidenceRail jobId={jobId} references={references} showEvidence={showEvidence}/>}
   </div>}
  </article>
  <details className="ai-review-quality"><summary>评论与图片质量</summary>
   <p>以下是辅助筛查线索，不证明刷单、虚假评价或任何欺诈。重复来源保留全部原件，不视为多个独立证据。</p>
   {report.qualityWarning&&<p>程序质量诊断暂不可用，不影响综合解读。原始来源仍可查看。</p>}
   <h3>程序对照与规则筛查</h3>
   <div className="chips">{filters.map(f=><button className={`chip ${filter===f.key?'on':''}`} key={f.key} onClick={()=>{setFilter(f.key);setPage(1)}}>{f.label} · {f.groups.length}{f.key.includes('exact')||f.key==='nearComments'?' 组':' 条'}</button>)}</div>
   {filter==='nearComments'&&<p>{q?.nearMethod}。已比较 {q?.comparedPairs} 对候选，未声称检查所有组合。</p>}
   {active&&<><p>{active.label}：{active.groups.length} {filter==='defaults'||filter==='lowInformation'?'条':'组'}。评论分母为快照 {report.scope?.comments} 条；图片分母为已下载图片地址，不包含未读图片。</p>
   {active.groups.slice((page-1)*20,page*20).map((group,i)=><div className="ai-quality-group" key={i}><span>{(page-1)*20+i+1}. {group.length>1?`${group.length} 个原始来源`:'原始来源'}</span>{group.map((id,j)=><button className="chip" key={id+j} onClick={()=>showEvidence(active.kind,id)}>查看{active.kind==='image'?'图片':'评论'} {j+1}</button>)}</div>)}
   {!active.groups.length&&<p>本次规则未检出此类线索。</p>}
   {active.groups.length>20&&<div className="pager"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>{page} 页</span><button disabled={page*20>=active.groups.length} onClick={()=>setPage(page+1)}>下一页</button></div>}</>}
   {!!q?.repeatedImageUrls?.length&&<><h3>重复图片地址 · 程序核对</h3>{q.repeatedImageUrls.map(i=><p key={i.id}>相同地址出现 {i.occurrences} 次，关联 {i.comments.length} 条评论，推理只发送一份。<button className="chip" onClick={()=>showEvidence('image',i.id)}>查看图片及全部关联评论</button></p>)}</>}
   <h3>AI 推断线索</h3>
   {report.qualitySignals?.length?report.qualitySignals.map((item,i)=><div key={i}><small>{item.kind==='image_similar'?'可能近似图片 · AI 视觉推断（不是字节相同）':'AI 内容推断 · 需查看原文核对'}</small>{p(item,'signal'+i)}</div>):<p>没有经过校验的 AI 异常线索；这不等于评价真实性已得到验证。</p>}
   {!!report.unread?.length&&<><h3>未读图片条目</h3>{report.unread.map((i,n)=><p key={i.id}>图片 {n+1} · {i.error} <button className="chip" onClick={()=>showEvidence('image',i.id)}>查看原始条目</button></p>)}</>}
  </details>
 </>;
}

// Scope belongs in the collapsed processing details, not in the reading surface.
export function AIReviewScope({report}:{report:ProductReview}) {
 const statKeys=[...new Set([report.verdict,...(report.paragraphs||[]),...(report.checks||[])].flatMap(p=>p?.statistics||[]))];
 return <div className="ai-review-scope">
  {report.scope&&<p>本份快照：{report.scope.comments} 条评论，其中 {report.scope.substantive} 条非默认且至少十二字；{report.scope.uniqueImages} 张成功下载的去重图片。{report.scope.unreadImages>0&&`另有 ${report.scope.unreadImages} 个图片条目未读。`}{report.scope.siteTotal!=null&&`站点宣称评价量 ${report.scope.siteTotal}，不等于本次已读量。`}</p>}
  {report.blocked&&<p>未处理：{report.blocked.unprocessed.comments} 条评论、{report.blocked.unprocessed.images} 张可读去重图片；原因 {report.blocked.code}。输入未截断或抽样。</p>}
  {report.actualModel&&<p>实际生成模型：{report.actualModel}{report.actualEndpointHost?` · ${report.actualEndpointHost}`:''}</p>}
  {report.providerAttempts?.map(a=><p key={a.attempt}>尝试 {a.attempt} · {a.model||'无可用模型'}{a.cached?' · 使用私有缓存':''}{a.fallbackReason?` · 切换原因：${a.fallbackReason}`:''}{a.error?` · ${a.error}`:''}{a.httpStatus?` · HTTP ${a.httpStatus}`:''}{a.providerCode?` · ${a.providerCode}`:''}{[...(a.skipped||[]),...(a.selection?.skipped||[])].map(s=>` · 未选用 ${s.model}：${s.reason}`).join('')}</p>)}
  {report.strategy&&<p>{report.strategy}{report.stages&&report.stages>1?` · ${report.stages} 个阅读阶段，综合步骤只使用已校验阶段证据。`:''}</p>}
  {!!statKeys.length&&<><p>正文引用的统计由程序计算，分母为本份快照；图片地址按 URL、去重图片按 SHA-256 统计。</p><dl>{statKeys.map(k=><div key={k}><dt>{countLabels[k]||k}</dt><dd>{report.scope?.[k as keyof NonNullable<ProductReview['scope']>]??'未统计'}</dd></div>)}</dl></>}
 </div>;
}
