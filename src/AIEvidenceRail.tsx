import {useEffect, useState} from 'react';
import {api} from './api';

export interface EvidenceReferences {comments:string[];images:string[]}
interface SourceComment {id:string;data:{text?:string;text_full?:string;date?:string;variant?:string;score?:number|null}}
interface SourceImage {id:string;content_hash?:string|null}

// Preview only existing, owned evidence. No model text is used as a quotation.
export function AIEvidenceRail({jobId,references,showEvidence}:{jobId:string;references:EvidenceReferences;showEvidence:(kind:string,id:string)=>void}) {
 const [comments,setComments]=useState<SourceComment[]>([]),[images,setImages]=useState<SourceImage[]>([]),[loading,setLoading]=useState(false),[unavailable,setUnavailable]=useState(false),[failedImages,setFailedImages]=useState<string[]>([]);
 const commentIds=[...new Set(references.comments)].slice(0,2).join(','),imageIds=[...new Set(references.images)].slice(0,4).join(',');
 useEffect(()=>{
  const control=new AbortController();setComments([]);setImages([]);setFailedImages([]);setUnavailable(false);
  if(!commentIds&&!imageIds){setLoading(false);return;}
  setLoading(true);
  async function load(){
   let missing=false;
   const commentResults=await Promise.allSettled(commentIds.split(',').filter(Boolean).map(id=>api<{comment:SourceComment;images:{id:string}[]}>(`/api/ai/jobs/${jobId}/evidence?comment=${encodeURIComponent(id)}`,{signal:control.signal})));
   if(control.signal.aborted)return;
   const sourceComments:SourceComment[]=[],relatedImages:string[]=[];
   for(const result of commentResults)if(result.status==='fulfilled'){sourceComments.push(result.value.comment);relatedImages.push(...result.value.images.map(i=>i.id));}else missing=true;
   setComments(sourceComments);
   const ids=[...new Set([...imageIds.split(',').filter(Boolean),...relatedImages])].slice(0,4);
   const imageResults=await Promise.allSettled(ids.map(id=>api<{image:SourceImage}>(`/api/ai/jobs/${jobId}/evidence?image=${encodeURIComponent(id)}`,{signal:control.signal})));
   if(control.signal.aborted)return;
   const sourceImages:SourceImage[]=[];
   for(const result of imageResults)if(result.status==='fulfilled'&&result.value.image.content_hash)sourceImages.push(result.value.image);else missing=true;
   setImages(sourceImages);setUnavailable(missing);setLoading(false);
  }
  void load();return()=>control.abort();
 },[jobId,commentIds,imageIds]);
 if(!commentIds&&!imageIds)return null;
 return <aside className="ai-evidence-rail" aria-label="相关原始证据">
  <h3>相关原始证据</h3>
  <p className="ai-rail-caption">正文引用的部分来源 · 点击查看原文与原图</p>
  {loading&&!comments.length&&<p role="status">正在读取原始证据…</p>}
  {!!images.length&&<div className="ai-evidence-thumbnails">{images.map((image,i)=><button type="button" className="ai-evidence-thumbnail" key={image.id} onClick={()=>showEvidence('image',image.id)} aria-label={`查看相关原始图片 ${i+1}`}>
   {failedImages.includes(image.id)?<span>图片暂不可用<br/>点击查看来源</span>:<img src={`/api/ai/jobs/${jobId}/image/${encodeURIComponent(image.id)}`} alt={`本任务保存的原始图片 ${i+1}`} loading="lazy" onError={()=>setFailedImages(ids=>ids.includes(image.id)?ids:[...ids,image.id])}/>}
  </button>)}</div>}
  {comments.filter(c=>(c.data.text_full||c.data.text||'').trim()).map(comment=><figure className="ai-source-comment" key={comment.id}>
   <blockquote>{comment.data.text_full||comment.data.text}</blockquote>
   <figcaption>{[comment.data.date,comment.data.variant].filter(Boolean).join(' · ')}<button type="button" onClick={()=>showEvidence('comment',comment.id)}>查看原评论 <span aria-hidden="true">›</span></button></figcaption>
  </figure>)}
  {unavailable&&<p className="ai-rail-caption">部分证据暂时无法加载，可通过正文引用重新查看。</p>}
  {!!images.length&&<p className="ai-rail-caption">图片仅作可见细节参考。</p>}
 </aside>;
}
