import {digest,aiConfig} from './ai-config.mjs';
import {budgetInput} from './ai-review.mjs';
export const modelIdentity=p=>digest({model:p.model,endpoint:p.endpoint,keyEnv:p.keyEnv});
export async function selectModel(c,unit,images){
 const models=unit.config.models||[],skipped=[],current=aiConfig();
 const allowed=new Map(current.models.map(p=>[modelIdentity(p),p]));
 for(let i=unit.model_cursor||0;i<models.length;i++){
  const p=models[i],key=modelIdentity(p),active=allowed.get(key);
  if(!active){skipped.push({model:p.model,reason:'no_longer_allowed_by_operator'});if(i===0&&!(unit.model_cursor||0))break;continue;}
  const cooldown=(await c.query('SELECT reason FROM ai_model_cooldowns WHERE model_key=$1 AND until_at>now()',[key])).rows[0];
  if(cooldown){skipped.push({model:p.model,reason:cooldown.reason});continue;}
  const config={...unit.config,...p,limits:active.limits,requestOptions:active.requestOptions};
  const budget=budgetInput(config,unit.input,images);
  if(!budget.fits){
   if(i===0&&!skipped.length)throw Object.assign(new Error(budget.reason||'context_budget_exceeded'),{permanent:true});
   skipped.push({model:p.model,reason:budget.reason||'same_payload_exceeds_limits'});continue;
  }
  if((unit.config.freeQuotaOnly||current.freeQuotaOnly)&&!active.freeTierStopConfirmed){skipped.push({model:p.model,reason:'free_tier_stop_not_confirmed'});continue;}
  if(config.provider!=='mock'&&!process.env[p.keyEnv]){skipped.push({model:p.model,reason:'key_not_configured'});continue;}
  return {config,index:i,key,cacheProfile:digest({key,requestOptions:config.requestOptions,outputTokens:config.outputTokens}),skipped};
 }
 throw Object.assign(new Error('provider_models_unavailable'),{permanent:true,modelSelection:{skipped}});
}
export async function recordFallback(c,unit,selection,error){
 if(!selection||!error.fallbackReason)return false;
 await c.query(`INSERT INTO ai_model_cooldowns(model_key,until_at,reason) VALUES($1,now()+($2*interval '1 millisecond'),$3) ON CONFLICT(model_key) DO UPDATE SET until_at=excluded.until_at,reason=excluded.reason`,[selection.key,unit.config.modelCooldownMs||3600000,error.fallbackReason]);
 await c.query('UPDATE ai_jobs SET model_cursor=$2 WHERE id=$1',[unit.job_id,selection.index+1]);
 return selection.index+1<unit.config.models.length;
}
