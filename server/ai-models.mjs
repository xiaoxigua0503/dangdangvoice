// Operator-owned allowlist. Credentials are resolved only at request time.
const positive=n=>Number.isSafeInteger(n)&&n>0;
const fields=['context','maxOutput','maxImages','imageTokens','requestBytes','dataUriBytes'];
export function endpointUrl(value){
 let u;try{u=new URL(value);}catch{throw new Error('AI endpoint 配置无效');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!u.pathname.replace(/\/$/,'').endsWith('/v1')||['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('AI endpoint 必须是无凭据的 HTTPS /v1 地址');
 if(process.env.APP_BASE_URL&&u.origin===new URL(process.env.APP_BASE_URL).origin)throw new Error('AI endpoint 不得指向本应用');
 return u.href.replace(/\/$/,'');
}
export function documentedLimits(model,endpoint){
 if(model!=='qwen3.7-flash')return null;
 const host=new URL(endpoint).hostname;
 if(!/(^|\.)dashscope\.aliyuncs\.com$|\.maas\.aliyuncs\.com$/.test(host))return null;
 return {context:1000000,maxOutput:64000,maxImages:250,imageTokens:16386,requestBytes:host.endsWith('.maas.aliyuncs.com')?64000000:16*1024*1024,dataUriBytes:20000000,documentation:'https://help.aliyun.com/zh/model-studio/vision',version:'qwen3.7-flash-docs-2026-11-20'};
}
export function configuredModels(model,endpoint){
 let entries;
 try{entries=process.env.AI_MODELS_JSON?JSON.parse(process.env.AI_MODELS_JSON):[{model,endpoint,keyEnv:'AI_API_KEY',vision:true,freeTierStopConfirmed:process.env.AI_FREE_TIER_STOP_CONFIRMED==='true'}];}catch{throw new Error('AI_MODELS_JSON 必须是模型配置数组；不能包含密钥值');}
 if(!Array.isArray(entries)||!entries.length||entries.length>8)throw new Error('AI 模型列表须包含 1 至 8 个条目');
 const seen=new Set();
 return entries.map(entry=>{
  if(!entry||typeof entry.model!=='string'||!entry.model.trim()||entry.model.length>160||entry.vision!==true)throw new Error('每个模型必须配置 model、endpoint 并确认 vision=true');
  const endpoint=endpointUrl(entry.endpoint),keyEnv=entry.keyEnv||'AI_API_KEY';
  if(!/^[A-Z][A-Z0-9_]{0,95}$/.test(keyEnv))throw new Error('keyEnv 只能填写环境变量名称');
  if(Object.hasOwn(entry,'key')||Object.hasOwn(entry,'apiKey'))throw new Error('模型列表不能存储密钥值');
  const identity=entry.model+'\0'+endpoint+'\0'+keyEnv;if(seen.has(identity))throw new Error('AI 模型列表包含重复配置');seen.add(identity);
  const requestOptions=entry.requestOptions??(entry.model.startsWith('qwen')?{enable_thinking:false,enable_search:false}:{});
  if(!requestOptions||typeof requestOptions!=='object'||Array.isArray(requestOptions)||Object.entries(requestOptions).some(([k,v])=>!['enable_thinking','enable_search'].includes(k)||typeof v!=='boolean'))throw new Error('requestOptions 仅允许 enable_thinking/enable_search 布尔值');
  let limits=entry.limits||documentedLimits(entry.model,endpoint);
  if(limits&&(!fields.every(k=>positive(limits[k]))||typeof limits.documentation!=='string'||!limits.documentation.startsWith('https://')))throw new Error('模型容量必须包含官方文档地址及全部正整数限制');
  if(limits){let doc;try{doc=new URL(limits.documentation);}catch{throw new Error('模型容量文档 URL 无效');}if(doc.protocol!=='https:'||doc.username||doc.password||doc.search||doc.hash)throw new Error('容量文档须为无凭据的 HTTPS URL');limits={...Object.fromEntries(fields.map(k=>[k,limits[k]])),documentation:doc.href};}
  return {model:entry.model,endpoint,keyEnv,vision:true,limits,requestOptions,freeTierStopConfirmed:entry.freeTierStopConfirmed===true};
 });
}
// Exact pairs only. Generic AccessDenied/insufficient_quota/429 are ambiguous.
// https://help.aliyun.com/zh/model-studio/error-code/
export function classifyProviderError(status,code){
 const permanentFallback=new Map([
  ['403:AllocationQuota.FreeTierOnly','free_quota_exhausted'],
  ['400:Arrearage','credit_exhausted'],['403:Arrearage','credit_exhausted'],
  ['403:Model.AccessDenied','model_permission_denied'],
  ['404:ModelNotFound','model_unavailable'],
 ]);
 const reason=permanentFallback.get(status+':'+code);
 if(reason)return {fallbackReason:reason,retryable:false};
 const temporary=status===429&&['Throttling.RateQuota','Throttling.ResourceExhausted','Throttling.ServiceOverloaded'].includes(code);
 return {fallbackReason:null,retryable:temporary||status===408||status>=500};
}
export function retryAfterMs(value,now=Date.now()){
 if(!value)return null;
 const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return Math.ceil(seconds*1000);
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):null;
}
