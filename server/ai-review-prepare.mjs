import {pool} from './db.mjs';
import {digest} from './ai-config.mjs';
import {sourceQuality,budgetInput} from './ai-review.mjs';
// Each download owns its connection, advisory lock and transaction. Never run
// concurrent BEGIN/COMMIT statements on the worker's leased connection.
export async function prepareReview(unit,downloadFn,signal) {
 const started=Date.now(),all=unit.input.images,downloaded=[],unread=[];let cursor=0;
 await Promise.all(Array.from({length:Math.min(2,all.length)},async()=>{
  while(cursor<all.length){
   const ref=all[cursor++];signal.throwIfAborted();const c=await pool.connect();
   try {
    await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['download:'+unit.job_id+':'+ref.id]);
    let img=(await c.query('SELECT * FROM ai_images WHERE job_id=$1 AND id=$2',[unit.job_id,ref.id])).rows[0];
    if(!img.bytes){
     const value=await downloadFn(img.url,unit.config,signal);const hash=digest(value.bytes);
     await c.query('BEGIN');await c.query('SELECT id FROM ai_jobs WHERE id=$1 FOR UPDATE',[unit.job_id]);
     const total=+(await c.query('SELECT coalesce(sum(octet_length(bytes)),0) n FROM ai_images WHERE job_id=$1',[unit.job_id])).rows[0].n;
     if(total+value.bytes.length>unit.config.maxTotalImageBytes)throw new Error('total_image_budget');
     await c.query('UPDATE ai_images SET bytes=$3,mime=$4,content_hash=$5,downloaded_at=now(),error=NULL WHERE job_id=$1 AND id=$2',[unit.job_id,ref.id,value.bytes,value.mime,hash]);
     await c.query('COMMIT');img={...img,...value,content_hash:hash};
    }
    downloaded.push({...ref,bytes:img.bytes,mime:img.mime,hash:img.content_hash});
   }catch(e){
    await c.query('ROLLBACK').catch(()=>{});signal.throwIfAborted();
    const allowed=/^(?:image_[a-z_0-9]+|invalid_image_url|unsupported_image_host|unsafe_image_address|unsupported_image_format|invalid_image_content|total_image_budget)$/;
    const error=allowed.test(e.message)?e.message:'image_download_error';unread.push({id:ref.id,comments:ref.comments,error});
    await c.query('UPDATE ai_images SET error=$3 WHERE job_id=$1 AND id=$2 AND bytes IS NULL',[unit.job_id,ref.id,error]);
   }finally{await c.query('SELECT pg_advisory_unlock_all()').catch(()=>{});c.release();}
  }
 }));
 downloaded.sort((a,b)=>a.id.localeCompare(b.id));unread.sort((a,b)=>a.id.localeCompare(b.id));
 const unique=new Map();for(const i of downloaded){if(!unique.has(i.hash))unique.set(i.hash,{...i,aliases:[],comments:[],occurrences:[]});const rep=unique.get(i.hash);rep.aliases.push(i.id);rep.occurrences.push(...(i.occurrences||[]));rep.comments=[...new Set([...rep.comments,...i.comments])];}
 let quality=null,qualityWarning=null;try{quality=sourceQuality(unit.input.comments,downloaded);}catch{qualityWarning='quality_diagnostics_unavailable';}
 const scope={comments:unit.input.comments.length,substantive:unit.input.comments.filter(c=>!c.data.is_auto&&(c.data.text_full||c.data.text).trim().length>=12).length,defaults:unit.input.comments.filter(c=>c.data.is_auto).length,imageReferences:all.length,uniqueImages:unique.size,unreadImages:unread.length,siteTotal:unit.input.product.site?.total_comment_num??null,denominator:'本次保存快照的评论条目；图片数量按已有地址/成功下载哈希统计；不代表站点评价总量'};
 const input={schemaVersion:4,product:unit.input.product,comments:unit.input.comments,parts:unit.input.parts,scope,quality,unread,images:[...unique.values()].map(({bytes,mime,hash,...ref})=>ref)};
 const budget=budgetInput(unit.config,input,[...unique.values()]);
 // Capacity failure is explicit: retain ALL immutable sources and enqueue no
 // provider work. Never sample or launch a hidden multi-stage synthesis.
 return {schemaVersion:4,scope,quality,qualityWarning,unread,chunks:budget.fits?[{...input,budget}]:[],blocked:budget.fits?null:{code:budget.reason||'context_budget_exceeded',unprocessed:{comments:scope.comments,images:scope.uniqueImages}},budget,timings:{downloadAndPlanMs:Date.now()-started}};
}
export async function reviewImages(c,unit) {
 const refs=unit.input.images||[],images=[];
 for(const ref of refs){
  const i=(await c.query('SELECT bytes,mime,content_hash FROM ai_images WHERE job_id=$1 AND id=$2',[unit.job_id,ref.id])).rows[0];
  if(!i?.bytes)throw new Error('image_unavailable');images.push({id:ref.id,bytes:i.bytes,mime:i.mime,hash:i.content_hash});
 }
 return images;
}
