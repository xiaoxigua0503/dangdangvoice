import {useRef,useState} from 'react';
export interface VisualClaim {text:string;commentIds:string[];imageIds:string[]}
export type ReportVisual=
 | {type:'topics';title:string;topics:{label:string;note?:string;commentIds:string[]}[]}
 | {type:'image_observations';title:string;images:{imageId:string;caption:string;relatedCommentIds?:string[]}[]}
 | {type:'experience_comparison';title:string;groups:{title:string;claims:VisualClaim[]}[]}
 | {type:'seller_vs_evidence';title:string;items:(VisualClaim&{metadataId:string;assessment:'supported'|'different_experience'|'insufficient'})[]};
export function visualReferences(visuals:ReportVisual[]=[]){
 const comments:string[]=[],images:string[]=[];
 for(const v of visuals){
  if(v.type==='topics')comments.push(...v.topics.flatMap(t=>t.commentIds));
  if(v.type==='image_observations'){images.push(...v.images.map(i=>i.imageId));comments.push(...v.images.flatMap(i=>i.relatedCommentIds||[]));}
  const claims=v.type==='experience_comparison'?v.groups.flatMap(g=>g.claims):v.type==='seller_vs_evidence'?v.items:[];
  comments.push(...claims.flatMap(c=>c.commentIds));images.push(...claims.flatMap(c=>c.imageIds));
 }
 return {comments:[...new Set(comments)],images:[...new Set(images)]};
}
export function AIVisualBlocks({visuals,jobId,catalog={},duplicateGroups=[],showEvidence}:{visuals:ReportVisual[];jobId:string;catalog?:Record<string,{kind:string;text?:string}>;duplicateGroups?:string[][];showEvidence:(kind:string,id:string)=>void}){
 const [selection,setSelection]=useState<{title:string;ids:string[]}>({title:'',ids:[]}),[failed,setFailed]=useState<string[]>([]);
 const dialog=useRef<HTMLDialogElement>(null);
 const sources=(claim:VisualClaim)=><div className="ai-visual-sources">{[...new Set(claim.commentIds)].map((id,i)=><button type="button" className="chip" key={'c'+id} onClick={()=>showEvidence('comment',id)}>原评 {i+1}</button>)}{[...new Set(claim.imageIds)].map((id,i)=><button type="button" className="chip" key={'i'+id} onClick={()=>showEvidence('image',id)}>图片 {i+1}</button>)}</div>;
 const labels={topics:'评论在聊什么',image_observations:'从买家图片看细节',experience_comparison:'不同体验，放在一起看',seller_vs_evidence:'商家说明与买家反馈'};
 return <div className="ai-visuals">
  {visuals.map((v,index)=><section className="ai-visual-block" key={index} aria-label={v.title}>
   <header><small>{labels[v.type]}</small><h3>{v.title}</h3></header>
   {v.type==='topics'&&<><p className="ai-visual-scope">数量为模型给各主题关联的去重评论编号，不是全量出现频次或独立体验数；主题可重叠，未分配不等于未提及。</p><div className="ai-topic-list">{v.topics.map((t,i)=>{const ids=[...new Set(t.commentIds)],max=Math.max(...v.topics.map(x=>new Set(x.commentIds).size),1),repeated=duplicateGroups.some(g=>g.length>1&&g.some(id=>ids.includes(id)));return <div key={i}>
    <button type="button" className="ai-topic-bar" aria-label={`${t.label}，${ids.length} 条关联评论，查看来源`} onClick={()=>{setSelection({title:t.label,ids});dialog.current?.showModal();}}><span>{t.label}</span><strong>{ids.length} 条</strong><span className="ai-topic-fill" aria-hidden="true" style={{width:`${ids.length/max*100}%`}}/></button>
    {t.note&&<p>{t.note}</p>}{repeated&&<small>含已知重复或相似来源，数量不代表独立体验或共识。</small>}
   </div>;})}</div></>}
   {v.type==='image_observations'&&<><p className="ai-visual-scope">本轮实际发送的去重买家图片 · 仅支持可见细节</p><div className="ai-visual-images">{v.images.map(i=><figure key={i.imageId}>
    <button type="button" className="ai-visual-image" aria-label={`查看原图与关联评论：${i.caption}`} onClick={()=>showEvidence('image',i.imageId)}>{failed.includes(i.imageId)?<span role="status">图片暂时无法加载 · 点击查看来源</span>:<img src={`/api/ai/jobs/${encodeURIComponent(jobId)}/image/${encodeURIComponent(i.imageId)}`} alt={i.caption} loading="lazy" onError={()=>setFailed(old=>[...new Set([...old,i.imageId])])}/>}</button>
    <figcaption>{i.caption}</figcaption>{sources({text:'',commentIds:i.relatedCommentIds||[],imageIds:[]})}
   </figure>)}</div></>}
   {v.type==='experience_comparison'&&<><p className="ai-visual-scope">模型选择的两组体验，不代表各自占比；版本差异需结合原评核对。</p><div className="ai-visual-columns">{v.groups.map((g,i)=><div key={i}><h4>{g.title}</h4>{g.claims.map((c,j)=><div className="ai-visual-claim" key={j}><p>{c.text}</p>{sources(c)}</div>)}</div>)}</div></>}
   {v.type==='seller_vs_evidence'&&<><p className="ai-visual-scope">商家资料尚未核实；引用有效不等于事实已获验证。缺少来源不表示宣传不实。</p>{v.items.map((item,i)=><div className="ai-visual-columns ai-seller-comparison" key={i}>
    <div><h4>商家说明</h4><p>{catalog[item.metadataId]?.text}</p><button type="button" className="chip" onClick={()=>showEvidence('metadata',item.metadataId)}>查看商家资料</button></div>
    <div><h4>{{supported:'有相关来源支持',different_experience:'有不同体验',insufficient:'尚无足够证据'}[item.assessment]}</h4><p>{item.text}</p>{sources(item)}</div>
   </div>)}</>}
  </section>)}
  <dialog ref={dialog} className="ai-source-dialog" aria-label="主题关联评论" onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}><div className="source-dialog-head"><h3>{selection.title} · 关联原评</h3><button type="button" className="ghost-btn" onClick={()=>dialog.current?.close()}>关闭</button></div><div className="source-grid">{selection.ids.map((id,i)=><button type="button" className="chip" key={id} onClick={()=>{dialog.current?.close();showEvidence('comment',id);}}>查看原始评论 {i+1}</button>)}</div></dialog>
 </div>;
}
