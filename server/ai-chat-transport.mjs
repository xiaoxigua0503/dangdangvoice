import {classifyProviderError} from './ai-models.mjs';
import {usageFrom} from './ai-provider.mjs';
async function boundedJSON(response,limit){const reader=response.body?.getReader();if(!reader)throw new Error('invalid_provider_json');let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('provider_output_too_large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export async function inferChatBody(config,envelope,signal,fetcher){
 const key=process.env[config.keyEnv||'AI_API_KEY'];if(!key)throw new Error('provider_not_configured');
 const response=await fetcher(config.endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(envelope),signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),redirect:'error'});
 if(!response.ok){let raw;try{raw=await boundedJSON(response,16384);}catch{}const code=raw?.error?.code||raw?.code;const classification=classifyProviderError(response.status,typeof code==='string'?code:'');throw Object.assign(new Error('provider_error'),{fallbackReason:classification.fallbackReason});}
 const data=await boundedJSON(response,2000000),usage=usageFrom(data.usage);
 if(data.choices?.[0]?.finish_reason!=='stop')throw Object.assign(new Error('provider_output_incomplete'),{providerUsage:usage});
 try{return {result:JSON.parse(data.choices[0].message.content),usage};}catch{throw Object.assign(new Error('invalid_structure'),{providerUsage:usage});}
}
