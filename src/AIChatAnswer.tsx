import type {ReactNode} from 'react';
export interface ChatReference {type:'comment'|'image';id:string;citation?:number}
export interface ChatSource {label:string;sourceProductId:string|null;targetProductId:string;variant:string|null;versionStatus:string;detailUrl:string|null}
export function sourceLabel(ref:ChatReference,sources:Record<string,ChatSource>){return ref.type==='image'?`买家图片 ${ref.id}`:sources[ref.id]?.label||`原始评论 ${ref.id}`;}
export function AIChatAnswer({text,references,sources,open}:{text:string;references:ChatReference[];sources:Record<string,ChatSource>;open:(ref:ChatReference)=>void}){
 const unique=references.filter((r,i,all)=>all.findIndex(a=>a.type===r.type&&a.id===r.id)===i);
 const mapping=new Map<number,ChatReference>();for(const r of unique)if(r.citation&&unique.filter(a=>a.citation===r.citation).length===1)mapping.set(r.citation,r);
 const used=new Set<number>();
 function inline(line:string):ReactNode{return line.split(/(\[\d+\])/g).map((part,i)=>{const number=/^\[(\d+)\]$/.exec(part),ref=number?mapping.get(Number(number[1])):undefined;if(!ref)return part;used.add(Number(number![1]));return <button type="button" className="ai-chat-citation" key={i} aria-label={`来源 ${part} · ${sourceLabel(ref,sources)}`} title={sourceLabel(ref,sources)} onClick={()=>open(ref)}>{part}</button>;});}
 const blocks:ReactNode[]=[];const lines=text.split('\n');let index=0;
 while(index<lines.length){const line=lines[index];if(!line.trim()){index++;continue;}
  const list=/^\s*(?:[-*•]|\d+[.)、])\s+/.test(line);
  if(list){const items:ReactNode[]=[];while(index<lines.length&&/^\s*(?:[-*•]|\d+[.)、])\s+/.test(lines[index])){items.push(<li key={index}>{inline(lines[index].replace(/^\s*(?:[-*•]|\d+[.)、])\s+/,''))}</li>);index++;}blocks.push(<ul key={`list-${index}`}>{items}</ul>);}
  else{const paragraph:string[]=[];while(index<lines.length&&lines[index].trim()&&!/^\s*(?:[-*•]|\d+[.)、])\s+/.test(lines[index]))paragraph.push(lines[index++]);blocks.push(<p key={`p-${index}`}>{paragraph.map((p,i)=><span key={i}>{i>0&&<br/>}{inline(p)}</span>)}</p>);}
 }
 // Old messages have no persisted citation mapping. Do not infer mapping by order.
 const remaining=unique.filter(r=>!r.citation||!used.has(r.citation));
 return <>{blocks}{remaining.length>0&&<div className="chips ai-chat-sources" aria-label="回答的原始来源">{remaining.map(ref=><button type="button" className="chip" key={ref.type+ref.id} onClick={()=>open(ref)}>{sourceLabel(ref,sources)}</button>)}</div>}</>;
}
