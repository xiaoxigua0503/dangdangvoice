import {useState} from 'react';
export interface Citation {kind:'comment'|'image';id:string;quote:string|null;visibleText:string|null}
interface Paragraph {text:string;citations:Citation[];statistics?:string[]}
export interface ProductReview {
 schemaVersion?:number;generatedAt:string;partial:boolean;method:string;hasSynthesis?:boolean;empty?:boolean;
 verdict?:Paragraph;paragraphs?:Paragraph[];imageText?: (Paragraph & {relation:string})[];checks?:Paragraph[];
 qualitySignals?:(Paragraph & {kind:string})[];
 quality?:{exactComments:string[][];nearComments:string[][];nearMethod:string;comparedPairs:number;defaults:string[];lowInformation:string[];exactImages:string[][];repeatedImageUrls?:{id:string;occurrences:number;comments:string[]}[]};
 scope?:{comments:number;substantive:number;defaults:number;imageReferences:number;uniqueImages:number;unreadImages:number;siteTotal:string|number|null};
 unread?:{id:string;comments:string[];error:string}[];strategy?:string;stages?:number;timings?:{kind:string;ms:string}[];totalMs?:number;
}
const countLabels:Record<string,string>={comments:'快照评论',substantive:'非默认且至少十二字的评论',defaults:'默认评价',imageReferences:'图片地址',uniqueImages:'成功下载的去重图片',unreadImages:'未读图片条目'};
export function AIReviewArticle({report,showEvidence}:{report:ProductReview;showEvidence:(kind:string,id:string)=>void}) {
 const [filter,setFilter]=useState('exactComments'),[page,setPage]=useState(1),[statsOpen,setStatsOpen]=useState(false);
 const statKeys=[...new Set([report.verdict,...(report.paragraphs||[]),...(report.checks||[])].flatMap(p=>p?.statistics||[]))];
 function refs(items:Citation[]) {return <span className="ai-citations">{items.map((c,i)=><button key={c.kind+c.id+i} title={c.quote||c.visibleText||'打开原始证据'} aria-label={`查看${c.kind==='comment'?'评论':'图片'}证据 ${i+1}`} onClick={()=>showEvidence(c.kind,c.id)}>{c.kind==='comment'?'评':'图'}{i+1}</button>)}</span>}
 const p=(item:Paragraph,key:string)=><p key={key}>{item.text} {refs(item.citations)}{!!item.statistics?.length&&<button className="ai-scope-reference" aria-label="查看本段统计口径" onClick={()=>setStatsOpen(true)}>范围</button>}</p>;
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
   <p className="eyebrow">购买之前 · 一起读懂评论与买家秀</p>
   {report.hasSynthesis&&report.verdict?<>
    <div className="ai-review-verdict">{p(report.verdict,'verdict')}</div>
    <div className="ai-review-prose">{report.paragraphs?.map((item,i)=>p(item,'p'+i))}</div>
    {!!report.imageText?.length&&<div className="ai-review-photos"><h3>图文对照</h3>{report.imageText.map((item,i)=><div className="ai-photo-observation" key={i}><small>{item.relation==='match'?'可见细节相呼应':item.relation==='conflict'?'可见细节存在差异':'对应关系未明'}</small>{p(item,'photo'+i)}</div>)}</div>}
    {!!report.checks?.length&&<aside className="ai-review-checks"><h3>下单前，值得确认</h3>{report.checks.map((item,i)=>p(item,'check'+i))}</aside>}
   </>:<p role="status">{report.empty?"本份快照没有可读评论，尚无材料生成商品综合解读。":"综合解读尚未通过校验。请展开处理详情查看原因；已读证据仍保留，可重试未完成步骤。"}</p>}
   {report.scope&&<footer className="ai-review-scope">本份快照：{report.scope.comments} 条评论，其中 {report.scope.substantive} 条非默认且至少十二字；{report.scope.uniqueImages} 张成功下载的去重图片。{report.scope.unreadImages>0&&`另有 ${report.scope.unreadImages} 个图片条目未读。`} {report.scope.siteTotal!=null&&`站点宣称评价量 ${report.scope.siteTotal}，不等于本次已读量。`}<br/>{report.strategy}。{report.stages&&report.stages>1?`共 ${report.stages} 个阅读阶段，综合步骤只使用已校验阶段证据。`:''}</footer>}
   {!!statKeys.length&&<details className="ai-scope-detail" open={statsOpen} onToggle={e=>setStatsOpen(e.currentTarget.open)}><summary>查看统计口径</summary><p>以下全部为本份保存快照的程序统计；图片地址按 URL 计，成功下载的唯一图片按 SHA-256 计。站点宣称评价量不作为已读分母。</p><dl>{statKeys.map(k=><div key={k}><dt>{countLabels[k]}</dt><dd>{report.scope?.[k as keyof NonNullable<ProductReview['scope']>] ?? '未统计'}</dd></div>)}</dl></details>}
  </article>
  <details className="ai-review-quality"><summary>查看评论与图片质量</summary>
   <p>以下是辅助筛查线索，不证明刷单、虚假评价或任何欺诈。重复来源保留全部原件，不视为多个独立证据。</p>
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
