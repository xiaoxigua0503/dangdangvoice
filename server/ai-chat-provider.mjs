// Separate prompt/envelope; report infer(), schema and pipeline stay untouched.
import {inferChatBody} from './ai-chat-transport.mjs';
import {chatEnvelope,chatBudget} from './ai-chat-context.mjs';
import {modelIdentity} from './ai-model-runtime.mjs';
import {aiConfig} from './ai-config.mjs';
export async function chatModel(c,config,input,images,start=0){
 const current=aiConfig(),allowed=new Map(current.models.map(p=>[modelIdentity(p),p]));
 for(let index=start;index<config.models.length;index++){
  const p=config.models[index],key=modelIdentity(p),active=allowed.get(key);
  // Preserve the report selector's primary-model removal rule.
  if(!active){if(index===0&&start===0)break;continue;}
  if((await c.query('SELECT 1 FROM ai_chat_model_cooldowns WHERE model_key=$1 AND until_at>now()',[key])).rowCount)continue;
  if((config.freeQuotaOnly||current.freeQuotaOnly)&&!active.freeTierStopConfirmed)continue;
  if(config.provider!=='mock'&&!process.env[p.keyEnv])continue;
  const selected={...config,...p,limits:active.limits,requestOptions:active.requestOptions};
  const budget=chatBudget(selected,input,images);
  if(!budget.fits){if(index===0&&start===0)throw new Error(budget.reason);continue;}
  return {config:selected,index,key,budget};
 }
 throw new Error('provider_models_unavailable');
}
export async function inferChat(config,input,images,signal,fetcher=fetch){
 const budget=chatBudget(config,input,images);if(!budget.fits)throw new Error(budget.reason);
 if(config.provider==='mock'){
  if(process.env.NODE_ENV==='production')throw new Error('mock_disabled');
  return {result:{text:'本地 mock 问答演示，未调用真实模型，不可作为购买建议。',references:[]},usage:{mock:true}};
 }
 return inferChatBody(config,chatEnvelope(config,input,images),signal,fetcher);
}
