import {requestEnvelope,budgetInput} from './ai-review.mjs';
import {classifyProviderError,retryAfterMs} from './ai-models.mjs';
export function requestBody(config,input,image){
 const images=Array.isArray(image)?image:[];
 const budget=budgetInput(config,input,images);
 if(!budget.fits)throw Object.assign(new Error(budget.reason||'context_budget_exceeded'),{permanent:true});
 return requestEnvelope(config,input,images);
}
async function boundedBody(response,limit){
 const reader=response.body?.getReader();if(!reader)return '';
 let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('provider_output_too_large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks).toString('utf8');
}
export async function infer(config,input,image,signal,fetcher=fetch){
 if(config.provider==='mock'){
  if(process.env.NODE_ENV==='production')throw new Error('mock_disabled');
  return {result:{summary:'本地流程演示，未调用真实模型，不可作为购买建议。',considerations:[],sourceIds:[]},usage:{mock:true}};
 }
 const key=process.env[config.keyEnv||'AI_API_KEY'];if(!key)throw Object.assign(new Error('provider_not_configured'),{permanent:true});
 const body=JSON.stringify(requestBody(config,input,image));let response;
 try{response=await fetcher(config.endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body,signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),redirect:'error'});}
 catch(e){throw Object.assign(new Error(signal.aborted||['AbortError','TimeoutError'].includes(e.name)?'provider_timeout':'provider_network_error'),{cause:e});}
 if(!response.ok){
  let raw='';try{raw=await boundedBody(response,16384);}catch{}
  let providerCode='';try{const d=JSON.parse(raw),code=d.error?.code||d.code;if(typeof code==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(code))providerCode=code;}catch{}
  const classification=classifyProviderError(response.status,providerCode);
  const retry=retryAfterMs(response.headers.get('retry-after'));
  const tooLong=retry!==null&&retry>(config.maxRetryAfterMs||120000);
  throw Object.assign(new Error(classification.fallbackReason?'provider_model_unavailable':response.status===429?'provider_rate_limit':`provider_http_${response.status}`),{httpStatus:response.status,providerCode,fallbackReason:classification.fallbackReason,retryAfterMs:retry,permanent:!classification.retryable||tooLong});
 }
 let data;try{data=JSON.parse(await boundedBody(response,2000000));}catch(e){throw Object.assign(new Error(e.message==='provider_output_too_large'?e.message:'invalid_provider_json'),{permanent:true});}
 const usage=usageFrom(data.usage);
 if(data.choices?.[0]?.finish_reason!=='stop')throw Object.assign(new Error('provider_output_incomplete'),{permanent:true,providerUsage:usage,providerDiagnostic:{finishReason:data.choices?.[0]?.finish_reason||null}});
 let result;try{result=JSON.parse(data.choices[0].message.content);}catch{throw Object.assign(new Error('invalid_structure'),{permanent:true,providerUsage:usage});}
 return {result,usage};
}
export function usageFrom(raw){const usage={};for(const k of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(raw?.[k])&&raw[k]>=0)usage[k]=raw[k];return usage;}
