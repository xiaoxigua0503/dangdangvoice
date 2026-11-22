// Small offline contracts: no real model, DB, crawl, SMTP or worker process.
import assert from 'node:assert/strict';
import {validateReview,reviewPayload,requestEnvelope,budgetInput,sourceQuality} from '../server/ai-review.mjs';
import {metadataCatalog} from '../server/ai-review-visuals.mjs';
import {infer} from '../server/ai-provider.mjs';
import {aiConfig} from '../server/ai-config.mjs';
import {supportsUnit} from '../server/ai-pipeline.mjs';
import {finalizeReview} from '../server/ai-review-jobs.mjs';
globalThis.fetch=()=>{throw new Error('Network forbidden');};
const comments=[{id:'C0',sourceId:'379237662',data:{text:'包装完整'}},{id:'C1',sourceId:'379197532',data:{text:'包装完整',variant:'另一版本'}},{id:'C2',sourceId:'379000000',data:{text:'开箱细节不同'}}];
const sent=[{id:'I0',bytes:Buffer.from('mock-image'),mime:'image/png',hash:'hash-A'},{id:'I2',bytes:Buffer.from('other-mock'),mime:'image/png',hash:'hash-B'}];
const input={product:{pid:'1173899070',name:'测试服装',sellerMetadata:{description:'商家描述',specifications:{'面料/细节':'商家提供的资料'},price:'42'}},comments,images:[{id:'I0',aliases:['I1'],comments:['C0','C1']},{id:'I2',aliases:[],comments:['C2']}],unread:[{id:'I3',comments:['C2'],error:'image_download_error'}],scope:{comments:3}};
const catalog=metadataCatalog(input.product),metadataId=Object.keys(catalog).find(id=>catalog[id].field==='/sellerMetadata/description');
assert.ok(Object.values(catalog).some(s=>s.field==='/sellerMetadata/specifications/面料~1细节'));
assert.ok(!Object.values(catalog).some(s=>s.field.includes('pid')));
const claim={text:'模型选择的体验说明',commentIds:['C0'],imageIds:['I0']};
export const fixtures=[
 {type:'topics',title:'模型发现的主题',topics:[{label:'包装细节',note:'模型的简短判断',commentIds:['379237662','C0','C1']},{label:'开箱体验',commentIds:['C2']}]},
 {type:'image_observations',title:'模型选择的图片细节',images:[{imageId:'I1',caption:'图中可见外包装',relatedCommentIds:['379237662']}]},
 {type:'experience_comparison',title:'两组体验',groups:[{title:'完整包装',claims:[claim]},{title:'不同的开箱细节',claims:[{text:'模型对照说明',commentIds:['C2'],imageIds:['I2']}]}]},
 {type:'seller_vs_evidence',title:'资料与体验',items:[{metadataId,assessment:'supported',...claim},{metadataId,assessment:'insufficient',text:'尚未有足够的对应证据',commentIds:[],imageIds:[]}]},
];
const article={headline:'模型标题',summary:'一篇完整且有效的模型文章。',considerations:['购买前确认实际版本'],sourceIds:['379237662','I0']};
const check=(visuals,context=input,images=sent)=>validateReview({...article,visuals},context,images);
const before=JSON.stringify(input),result=check(fixtures);
assert.equal(result.visuals.length,4);assert.equal(result.visualStatus,'valid');assert.deepEqual(result.sourceIds,['C0','I0']);
assert.deepEqual(result.visuals[0].topics[0].commentIds,['C0','C1']);assert.equal(result.visuals[1].images[0].imageId,'I0');assert.equal(result.sourceCatalog[metadataId].text,'商家描述');
assert.equal(check([]).visuals.length,0);assert.equal(validateReview(article,input).summary,article.summary,'Old article has no visual requirement');
assert.equal(validateReview({...article,sourceIds:['C0'],visuals:[fixtures[0]]},{...input,images:[]},[]).visualStatus,'valid');
assert.equal(validateReview({...article,sourceIds:['C0'],visuals:[fixtures[1]]},{...input,images:[]},[]).visualStatus,'partial');
const bad=(v,context=input,images=sent,code)=>{const r=check([fixtures[0],v],context,images);assert.equal(r.summary,article.summary);assert.equal(r.visuals.length,1);assert.equal(r.visualStatus,'partial');assert.equal(r.visualDiagnostics.length,1);if(code)assert.equal(r.visualDiagnostics[0].code,code);return r;};
bad({...fixtures[0],topics:[{label:'外部快照',commentIds:['C-other-snapshot']}]});
bad({...fixtures[0],topics:[{label:'伪统计',commentIds:['C0'],count:99}]},input,sent,'invalid_visual_structure');
bad({...fixtures[1],images:[{imageId:'I-other-snapshot',caption:'未发送'}]},input,sent,'image_not_sent_or_ambiguous');
bad({...fixtures[1],images:[{imageId:'I3',caption:'下载失败'}]},input,sent,'image_not_sent_or_ambiguous');
bad(fixtures[1],input,[],'image_not_sent_or_ambiguous');
bad({...fixtures[1],images:[{imageId:'I0',caption:'关系不符',relatedCommentIds:['C2']}]},input,sent,'image_comment_mismatch');
bad({...fixtures[1],images:[{imageId:'I0',caption:'一张'},{imageId:'I1',caption:'同字节别名'}]},input,sent,'duplicate_visual_image');
bad({...fixtures[3],items:[{...fixtures[3].items[0],metadataId:'M-other-snapshot'}]},input,sent,'invalid_metadata_reference');
bad({...fixtures[2],groups:[{title:'只有一组',claims:[claim]}]},input,sent,'invalid_visual_structure');
bad({...fixtures[2],groups:[{title:'没有证据',claims:[{text:'主张',commentIds:[],imageIds:[]}]},fixtures[2].groups[1]]},input,sent,'missing_visual_evidence');
const ambiguous={...input,comments:[...comments,{id:'C3',sourceId:'379237662',data:{text:'另一个来源'}}]};
const r=validateReview({...article,sourceIds:['C0'],visuals:[fixtures[0]]},ambiguous,sent);assert.equal(r.visualStatus,'partial');assert.equal(r.visuals.length,0);
assert.throws(()=>validateReview({...article,sourceIds:['bad-source'],visuals:[]},input,sent),/invalid_reference/);
const duplicatedSent=[...sent,{id:'I4',hash:'hash-A',bytes:Buffer.from('mock-image'),mime:'image/png'}],duplicatedInput={...input,images:[...input.images,{id:'I4',comments:['C0']}]};
bad({...fixtures[1],images:[{imageId:'I0',caption:'原图'},{imageId:'I4',caption:'同字节'}]},duplicatedInput,duplicatedSent,'duplicate_visual_image');
const quality=sourceQuality(comments,[{...sent[0],comments:['C0']},{...sent[0],id:'I1',comments:['C1']}]);assert.deepEqual(quality.exactComments,[['C0','C1']]);assert.deepEqual(quality.exactImages,[['I0','I1']]);
const partial=bad({...fixtures[0],topics:[]});const restored=validateReview(partial,input,sent,{cached:true});assert.equal(restored.visualStatus,'partial');assert.equal(restored.visualDiagnostics.length,1);assert.equal(restored.visuals.length,1);
assert.equal(check(Array(5).fill(fixtures[0])).visuals.length,0);assert.equal(check('invalid').visualStatus,'partial');
const repeatedBlocks=check([fixtures[1],fixtures[1]]);assert.equal(repeatedBlocks.visuals.length,1);assert.equal(repeatedBlocks.visualDiagnostics[0].code,'duplicate_visual_image');
const manyImages=Array.from({length:5},(_,n)=>({id:'I-many'+n,comments:['C0']})),manySent=manyImages.map((i,n)=>({...i,hash:'unique'+n}));
const imageBlock=ids=>({type:'image_observations',title:'模型配图',images:ids.map(imageId=>({imageId,caption:'可见细节'}))});
const limited=validateReview({...article,sourceIds:['C0'],visuals:[imageBlock(manyImages.slice(0,4).map(i=>i.id)),imageBlock([manyImages[4].id])]}, {...input,images:manyImages},manySent);assert.equal(limited.visuals.length,1);assert.equal(limited.visualDiagnostics[0].code,'image_observation_limit');
assert.equal(JSON.stringify(input),before,'Immutable input unchanged');
const config=aiConfig(),body=requestEnvelope(config,input,sent),payload=JSON.parse(body.messages[1].content[0].text);
assert.deepEqual(payload.allowedVisualImageIds,['I0','I2']);assert.deepEqual(reviewPayload(input,[]).allowedVisualImageIds,[]);assert.equal(payload.responseFormat.properties.visuals.maxItems,4);
assert.equal(body.max_tokens,config.outputTokens);assert.equal(config.maxProviderRequests,Number(process.env.AI_MAX_PROVIDER_REQUESTS||3));assert.equal(config.visualsVersion,1);assert.equal(supportsUnit(config,'review'),true);assert.equal(supportsUnit({...config,executorVersion:'old-release'},'review'),false);
assert.equal(budgetInput(config,input,sent).payloadBytes,Buffer.byteLength(JSON.stringify(body)));
// Real provider transport code, fake HTTP responder only. Secrets are dummy and restored.
const oldKey=process.env.DDV_VISUAL_TEST_KEY;process.env.DDV_VISUAL_TEST_KEY='offline-dummy';
try{
 const providerConfig={...config,provider:'qwen',keyEnv:'DDV_VISUAL_TEST_KEY'};let calls=0;
 for(const [finish,content,expected] of [['length',JSON.stringify({...article,visuals:[]}),/provider_output_incomplete/],['stop','{"summary":',/invalid_structure/]]){
  await assert.rejects(infer(providerConfig,input,sent,new AbortController().signal,async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content}}]}),{status:200});}),expected);
 }
 assert.equal(calls,2,'One call per attempt, no repair');
}finally{if(oldKey===undefined)delete process.env.DDV_VISUAL_TEST_KEY;else process.env.DDV_VISUAL_TEST_KEY=oldKey;}
// Finalization with a fake query adapter: valid article + bad visual is durable partial.
const writes=[];let finalResult=partial;const fake={query:async(sql,args)=>{
 if(sql.startsWith('SELECT kind'))return {rows:[{kind:'prepare',state:'done',result:{scope:input.scope,quality}},{kind:'review',state:'done',result:finalResult}]};
 if(sql.includes('SELECT a.id,a.error'))return {rows:[]};
 if(sql.startsWith('UPDATE ai_jobs')){writes.push(args);return {rows:[]};}
 if(sql.includes('missing:%'))return {rows:[{n:0,total:2,completed:2,failed:0}]};
 if(sql.includes('count(*)::int total'))return {rows:[{total:3,completed:3,failed:0}]};
 throw new Error('Unexpected SQL in mock');
}};
await finalizeReview(fake,{id:'job-owned',config:{provider:'mock'},created_at:new Date().toISOString()});assert.equal(writes[0][2],'partial');assert.equal(writes[0][1].summary,article.summary);assert.equal(writes[0][1].visualStatus,'partial');
finalResult=result;await finalizeReview(fake,{id:'job-owned',config:{provider:'mock'},created_at:new Date().toISOString()});assert.equal(writes[1][2],'completed');
console.log('Offline visuals passed: all unions/empty/legacy, source scope, sent images, cid ambiguity, duplicates, partial/cache/finalize, token cap and incomplete/invalid JSON transport. No network/DB/model.');
