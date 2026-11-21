import {useRef,useState} from 'react';
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

export function AIReviewArticle({report,jobId,showEvidence}:{report:ProductReview;jobId:string;showEvidence:(kind:string,id:string)=>void}) {
 const [filter,setFilter]=useState('exactComments'),[page,setPage]=useState(1),[sourceTab,setSourceTab]=useState<'comments'|'images'>('comments');
 const sourceDialog=useRef<HTMLDialogElement>(null);
 const simple=report.schemaVersion===4;
 const hasArticle=report.hasSynthesis!==false&&(simple?!!report.summary?.trim():!!report.verdict?.text?.trim()&&!!report.paragraphs?.some(p=>p.text?.trim()));
 const citations=[report.verdict,...(report.paragraphs||[]),...(report.imageText||[]),...(report.checks||[])].flatMap(p=>p?.citations||[]);
 const references=simple?{comments:(report.sourceIds||[]).filter(id=>id.startsWith('C')),images:(report.sourceIds||[]).filter(id=>id.startsWith('I'))}:{comments:citations.filter(c=>c.kind==='comment').map(c=>c.id),images:citations.filter(c=>c.kind==='image').map(c=>c.id)};
 references.comments=[...new Set(references.comments)];references.images=[...new Set(references.images)];
 const allSources=[...references.comments.map(id=>({kind:'comment' as const,id})),...references.images.map(id=>({kind:'image' as const,id}))];
 const hasEvidence=hasArticle&&(references.comments.length>0||references.images.length>0);
 function refs(items:Citation[]) {return <span className="ai-citations">{items.map((c,i)=><button type="button" key={c.kind+c.id+i} title="查看原始来源" aria-label={`查看${c.kind==='comment'?'评论':c.kind==='metadata'?'商家资料':'图片'}证据 ${i+1}`} onClick={()=>showEvidence(c.kind,c.id)}>{c.kind==='comment'?'评':c.kind==='metadata'?'商':'图'} {i+1}</button>)}</span>}
 const p=(item:Paragraph,key:string)=><p key={key}>{item.text} {refs(item.citations||[])}</p>;
 const q=report.quality;
 const filters=q?[
  {key:'exactComments',label:'重复评论',kind:'comment',groups:q.exactComments},
  {key:'nearComments',label:'相似评论',kind:'comment',groups:q.nearComments},
  {key:'defaults',label:'默认评价',kind:'comment',groups:q.defaults.map(x=>[x])},
  {key:'lowInformation',label:'简短评论',kind:'comment',groups:q.lowInformation.map(x=>[x])},
  {key:'exactImages',label:'重复图片',kind:'image',groups:q.exactImages},
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

     {simple&&!!report.considerations?.length&&<aside className="ai-review-checks"><h3>购买前确认</h3>{report.considerations.map((text,i)=><p key={i}>{text}</p>)}</aside>}
     {!!report.imageText?.length&&<section className="ai-review-photos" aria-label="图文对照"><h3>评论与图片对照</h3>{report.imageText.map((item,i)=><div className="ai-photo-observation" key={i}>{p(item,'photo'+i)}</div>)}</section>}
     {!!report.checks?.length&&<aside className="ai-review-checks"><h3>购买前确认</h3>{report.checks.map((item,i)=>p(item,'check'+i))}</aside>}
     {!!allSources.length&&<div className="ai-source-strip"><span>相关来源</span>{allSources.slice(0,4).map((source,i)=><button className="chip" key={source.kind+source.id} onClick={()=>showEvidence(source.kind,source.id)}>{source.kind==='comment'?'评':'图'} {i+1}</button>)}<button className="ghost-btn" onClick={()=>sourceDialog.current?.showModal()}>查看全部来源（{allSources.length}）</button></div>}
    </div>
    {hasEvidence&&<AIEvidenceRail jobId={jobId} references={references} showEvidence={showEvidence}/>}
   </div>}
  </article>
  <dialog ref={sourceDialog} className="ai-source-dialog" onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}><div className="source-dialog-head"><h3>相关原始证据</h3><button className="ghost-btn" onClick={()=>sourceDialog.current?.close()}>关闭</button></div><div className="chips" role="tablist" aria-label="来源类型">{(['comments','images'] as const).map(tab=><button className={`chip ${sourceTab===tab?'on':''}`} role="tab" aria-selected={sourceTab===tab} key={tab} onClick={()=>setSourceTab(tab)}>{tab==='comments'?'评论':'图片'}（{references[tab].length}）</button>)}</div><div className="source-grid">{references[sourceTab].map((id,i)=><button className="chip" key={id} onClick={()=>{sourceDialog.current?.close();showEvidence(sourceTab==='comments'?'comment':'image',id);}}>{sourceTab==='comments'?'原始评论':'买家图片'} {i+1}</button>)}</div>{!references[sourceTab].length&&<p>暂无此类来源</p>}</dialog>
  <details className="ai-review-quality"><summary>评论与图片质量</summary>
   <p>以下线索仅供参考，不代表评价虚假；重复来源不作为独立证据。</p>
   {report.qualityWarning&&<p>程序质量诊断暂不可用，不影响综合解读。原始来源仍可查看。</p>}
   <div className="chips">{filters.filter(f=>f.groups.length>0).map(f=><button className={`chip ${filter===f.key?'on':''}`} key={f.key} onClick={()=>{setFilter(f.key);setPage(1)}}>{f.label} · {f.groups.length}{f.key.includes('exact')||f.key==='nearComments'?' 组':' 条'}</button>)}</div>
   {active&&active.groups.length>0&&<><p>{active.label}：{active.groups.length} {filter==='defaults'||filter==='lowInformation'?'条':'组'}。评论分母为快照 {report.scope?.comments} 条；图片统计范围为已下载图片，不包含未读条目。</p>
   {active.groups.slice((page-1)*20,page*20).map((group,i)=><div className="ai-quality-group" key={i}><span>{(page-1)*20+i+1}. {group.length>1?`${group.length} 个原始来源`:'原始来源'}</span>{group.map((id,j)=><button className="chip" key={id+j} onClick={()=>showEvidence(active.kind,id)}>查看{active.kind==='image'?'图片':'评论'} {j+1}</button>)}</div>)}
   {!active.groups.length&&<p>本次规则未检出此类线索。</p>}
   {active.groups.length>20&&<div className="pager"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>{page} 页</span><button disabled={page*20>=active.groups.length} onClick={()=>setPage(page+1)}>下一页</button></div>}</>}
   {!!q?.repeatedImageUrls?.length&&<><h3>重复图片来源</h3>{q.repeatedImageUrls.map(i=><p key={i.id}>相同地址出现 {i.occurrences} 次，关联 {i.comments.length} 条评论。<button className="chip" onClick={()=>showEvidence('image',i.id)}>查看图片及全部关联评论</button></p>)}</>}
   {!!report.qualitySignals?.length&&report.qualitySignals.map((item,i)=><div key={i}><small>{item.kind==='image_similar'?'可能近似图片 · AI 视觉推断（不是字节相同）':'AI 内容推断 · 需查看原文核对'}</small>{p(item,'signal'+i)}</div>)}
   {!!report.unread?.length&&<><h3>未读图片条目</h3>{report.unread.map((i,n)=><p key={i.id}>图片 {n+1} · 未能读取 <button className="chip" onClick={()=>showEvidence('image',i.id)}>查看原始条目</button></p>)}</>}
  </details>
 </>;
}

export function AIReviewScope({report}:{report:ProductReview}) {
 return <div className="ai-review-scope">
  {report.scope&&<p>采集范围：{report.scope.comments} 条评论 · {report.scope.imageReferences} 个图片来源。{report.scope.siteTotal!=null&&`当当页面显示的评价总量为 ${report.scope.siteTotal}，不等于本次分析量。`}</p>}
  {!!report.scope?.unreadImages&&<p>另有 {report.scope.unreadImages} 个图片条目未读。</p>}
  {report.blocked&&<p>当前数据超出可处理范围，尚未分析 {report.blocked.unprocessed.comments} 条评论、{report.blocked.unprocessed.images} 张图片，请联系管理员。</p>}
 </div>;
}
