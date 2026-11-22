import {z} from 'zod';
export const VISUALS_VERSION=1;
const id=z.string().min(1).max(100),short=z.string().trim().min(1).max(80),note=z.string().trim().min(1).max(180);
const commentIds=z.array(id).min(1).max(2000),imageIds=z.array(id).max(4);
const claim=z.object({text:note,commentIds:z.array(id).max(2000),imageIds}).strict();
export const Visual=z.discriminatedUnion('type',[
 z.object({type:z.literal('topics'),title:short,topics:z.array(z.object({label:short,note:note.optional(),commentIds}).strict()).min(1).max(6)}).strict(),
 z.object({type:z.literal('image_observations'),title:short,images:z.array(z.object({imageId:id,caption:note,relatedCommentIds:z.array(id).max(2000).optional()}).strict()).min(1).max(4)}).strict(),
 z.object({type:z.literal('experience_comparison'),title:short,groups:z.array(z.object({title:short,claims:z.array(claim).min(1).max(3)}).strict()).length(2)}).strict(),
 z.object({type:z.literal('seller_vs_evidence'),title:short,items:z.array(z.object({metadataId:id,assessment:z.enum(['supported','different_experience','insufficient']),text:note,commentIds:z.array(id).max(2000),imageIds}).strict()).min(1).max(4)}).strict(),
]);
// Only real scalar leaves of the seller fields actually sent in this task.
export function metadataCatalog(product={}){
 const catalog={};let n=0;
 const walk=(value,path,depth=0)=>{
  if(value==null||depth>8)return;
  if(['string','number','boolean'].includes(typeof value)){if(String(value).trim())catalog['M'+n++]={kind:'metadata',field:path,text:String(value)};return;}
  if(typeof value==='object')for(const [key,v] of Object.entries(value))walk(v,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);
 };
 walk(product.name,'/name');
 for(const key of ['description','price','specifications','variants','publisher','author','isbn'])walk(product.sellerMetadata?.[key],'/sellerMetadata/'+key);
 return catalog;
}
export function commentResolver(comments=[]){
 const internal=new Set(comments.map(c=>c.id)),aliases=new Map();
 for(const c of comments)if(typeof c.sourceId==='string'&&c.sourceId&&typeof c.id==='string'&&c.id.length<=100){const ids=aliases.get(c.sourceId)||[];ids.push(c.id);aliases.set(c.sourceId,ids);}
 return id=>{if(internal.has(id))return id;const matches=aliases.get(id)||[];if(matches.length===1)return matches[0];throw Object.assign(new Error('invalid_reference'),{reason:matches.length?'ambiguous_comment_source_id':'unknown_source_id',candidateCount:matches.length});};
}
function imageResolver(input,sentImages){
 const sent=new Map(sentImages.map(i=>[i.id,i])),aliases=new Map(),hashes=new Map();
 for(const ref of input.images||[]){
  const actual=sent.get(ref.id);if(!actual)continue;
  const canonical=actual.hash?(hashes.get(actual.hash)||ref.id):ref.id;if(actual.hash)hashes.set(actual.hash,canonical);
  for(const key of new Set([ref.id,...(ref.aliases||[])])){const matches=aliases.get(key)||new Set();matches.add(canonical);aliases.set(key,matches);}
 }
 return id=>{const matches=aliases.get(id);if(matches?.size===1)return [...matches][0];throw new Error('image_not_sent_or_ambiguous');};
}
// Independent blocks fail independently. No generated text is repaired or inferred.
export function validateVisuals(raw,input,sentImages=[]){
 const catalog=metadataCatalog(input.product),comments=commentResolver(input.comments),image=imageResolver(input,sentImages),visuals=[],diagnostics=[];
 const reject=(index,code,path='')=>diagnostics.push({index,code,path});
 if(raw===undefined)return {visuals,visualDiagnostics:diagnostics,sourceCatalog:catalog,visualStatus:'valid',visualsVersion:VISUALS_VERSION};
 if(!Array.isArray(raw)||raw.length>4){reject(-1,'invalid_visual_list');return {visuals,visualDiagnostics:diagnostics,sourceCatalog:catalog,visualStatus:'partial',visualsVersion:VISUALS_VERSION};}
 const observedImages=new Set();
 const refs=(ids,resolve)=>[...new Set(ids.map(resolve))];
 for(const [index,value] of raw.entries()){
  const parsed=Visual.safeParse(value);
  if(!parsed.success){reject(index,'invalid_visual_structure',parsed.error.issues[0]?.path.join('.')||'');continue;}
  const v=parsed.data;
  try{
   const evidence=entry=>{entry.commentIds=refs(entry.commentIds,comments);entry.imageIds=refs(entry.imageIds,image);if(!entry.commentIds.length&&!entry.imageIds.length)throw new Error('missing_visual_evidence');};
   if(v.type==='topics')for(const topic of v.topics)topic.commentIds=refs(topic.commentIds,comments);
   if(v.type==='image_observations'){
    const used=new Set();
    for(const item of v.images){item.imageId=image(item.imageId);if(used.has(item.imageId)||observedImages.has(item.imageId))throw new Error('duplicate_visual_image');used.add(item.imageId);
     item.relatedCommentIds=refs(item.relatedCommentIds||[],comments);
     const related=new Set((input.images||[]).filter(ref=>{try{return image(ref.id)===item.imageId;}catch{return false;}}).flatMap(ref=>ref.comments||[]));
     if(item.relatedCommentIds.some(id=>!related.has(id)))throw new Error('image_comment_mismatch');
    }
   }
   if(v.type==='experience_comparison')for(const group of v.groups)for(const c of group.claims)evidence(c);
   if(v.type==='seller_vs_evidence')for(const item of v.items){
    if(!Object.hasOwn(catalog,item.metadataId))throw new Error('invalid_metadata_reference');
    if(item.assessment==='insufficient'){item.commentIds=refs(item.commentIds,comments);item.imageIds=refs(item.imageIds,image);}else evidence(item);
   }
   if(v.type==='image_observations'){if(observedImages.size+v.images.length>4)throw new Error('image_observation_limit');for(const item of v.images)observedImages.add(item.imageId);}
   visuals.push(v);
  }catch(e){reject(index,['invalid_reference','image_not_sent_or_ambiguous','missing_visual_evidence','duplicate_visual_image','image_comment_mismatch','invalid_metadata_reference','image_observation_limit'].includes(e.message)?e.message:'invalid_visual_reference');}
 }
 return {visuals,visualDiagnostics:diagnostics,sourceCatalog:catalog,visualStatus:diagnostics.length?'partial':'valid',visualsVersion:VISUALS_VERSION};
}
