import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {ChatReference,ChatSource} from './AIChatAnswer';
interface Evidence {comment?:{id:string;data:{score?:number;date?:string;variant?:string;text?:string;text_full?:string;detail_url?:string};provenance:ChatSource};images?:{id:string}[];image?:{id:string;available:boolean};comments?:{id:string;provenance:ChatSource}[]}
export function AIChatEvidence({jobId,selection,close,open,ask,canAsk}:{jobId:string;selection:ChatReference;close:()=>void;open:(ref:ChatReference)=>void;ask:(id:string)=>void;canAsk:boolean}){
 const [evidence,setEvidence]=useState<Evidence|null>(null),[error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{const c=new AbortController();setEvidence(null);setError('');void api<Evidence>(`/api/ai/jobs/${jobId}/chat/evidence?${selection.type}=${encodeURIComponent(selection.id)}`,{signal:c.signal}).then(r=>{if(!c.signal.aborted)setEvidence(r);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[jobId,selection.type,selection.id]);
 const provenance=(p:ChatSource)=><p className="ai-chat-version"><b>{p.versionStatus}</b><br/>当前商品 #{p.targetProductId} · 来源商品 {p.sourceProductId?'#'+p.sourceProductId:'未确认'}{p.variant?` · 原始版本：${p.variant}`:' · 未记录版本'}<br/><small>当当可能合并不同版本评价；未确认的版本不能证明当前特别版的装帧、签名或赠品。</small></p>;
 return <dialog className="ai-evidence ai-chat-evidence" ref={dialog} aria-label="DiDi 原始来源" onCancel={close} onClick={e=>{if(e.target===e.currentTarget)close();}}>
  <button className="ghost-btn" autoFocus onClick={close}>关闭来源</button>{error&&<p role="alert">{error}</p>}{!evidence&&!error&&<p role="status">正在读取原始来源…</p>}
  {evidence?.comment&&<><h3>原始评论 {evidence.comment.id}</h3>{provenance(evidence.comment.provenance)}<p>{[evidence.comment.data.score!=null?`评分 ${evidence.comment.data.score}`:null,evidence.comment.data.date].filter(Boolean).join(' · ')}</p><p className="ai-source-text">{evidence.comment.data.text_full||evidence.comment.data.text}</p>{/^https:\/\/comment\.dangdang\.com\/comment\/detail\//.test(evidence.comment.data.detail_url||'')&&<a target="_blank" rel="noreferrer" href={evidence.comment.data.detail_url}>打开当当原评论 ↗</a>}<div className="chips">{evidence.images?.map(i=><button className="chip" key={i.id} onClick={()=>open({type:'image',id:i.id})}>关联图片 {i.id}</button>)}</div></>}
  {evidence?.image&&<><h3>已保存的买家图片</h3>{evidence.image.available?<img src={`/api/ai/jobs/${jobId}/image/${encodeURIComponent(evidence.image.id)}`} alt="本份快照保存的原始图片"/>:<p role="alert">图片未保存，无法查看。</p>}<button className="chip" disabled={!canAsk||!evidence.image.available} onClick={()=>{ask(evidence.image!.id);close();}}>问问 DiDi · 关于这张图片</button>{evidence.comments?.map(c=><section key={c.id}>{provenance(c.provenance)}<button className="chip" onClick={()=>open({type:'comment',id:c.id})}>关联原评 {c.id}</button></section>)}</>}
 </dialog>;
}
