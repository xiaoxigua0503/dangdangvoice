import type {RelayResp,QueuedTask} from './api';
export const COLLECTION_MAX_MS=15*60_000, COLLECTION_MAX_FAILURES=8;
export function retryDelay(tries:number,retryAfterMs=0){return Math.max(retryAfterMs,Math.min(120_000,20_000*2**Math.min(Math.max(tries-1,0),3)));}
export function queueDue(t:QueuedTask,now=Date.now()){return t.state!=='paused'&&t.state!=='stopped'&&now-(t.addedAt||now)<COLLECTION_MAX_MS&&(t.failures||0)<COLLECTION_MAX_FAILURES&&t.tries<6&&now>=Math.max(t.nextAt||0,t.retryAfterUntil||0,(t.lastTry||t.addedAt)+retryDelay(t.tries));}
export function outcomeOf(r:RelayResp){if(r.outcome)return r.outcome;if(r.blocked)return 'blocked';if(!r.ok)return 'upstream_error';if(r.items?.length)return 'completed';if(r.summary&&['string','number'].includes(typeof r.summary.total_comment_num)&&r.summary.total_comment_num!==''&&Number(r.summary.total_comment_num)===0&&['string','number'].includes(typeof r.summary.pageCount)&&Number(r.summary.pageCount)<=1)return 'empty_confirmed';return 'empty_unconfirmed';}
export function issueText(outcome?:string){return ({challenge_detected:'当当返回了访问验证页面，本次采集已暂停。已获取的数据已保留，可稍后手动重试或导入已有数据。',retry_budget:'已达到采集重试上限',blocked:'当当暂时限制访问',rate_limited:'请求频率受限',timeout:'连接当当超时',network_error:'服务器无法连接当当',upstream_error:'当当服务暂不可用',parse_error:'评论格式暂未识别',unsupported_response:'评论格式暂未识别',empty_unconfirmed:'公开评论为空，尚未确认原因',empty_confirmed:'暂无公开文字评论',defaults_only:'当前仅有默认评价',partial:'已获取部分评论'} as Record<string,string>)[outcome||'']||'暂未完成读取';}
export function mayQueue(signal:AbortSignal,cancelled:boolean,validOwner:boolean){return !signal.aborted&&!cancelled&&validOwner;}
// Browser lock spans a complete run (not merely an HTTP request), across tabs.
const localRuns=new Set<string>();
export async function withCollectionLock(owner:string,pid:string,run:()=>Promise<boolean>){const key=`ddv-collect:${owner}:${pid}`;if(localRuns.has(key))return false;localRuns.add(key);try{if(navigator.locks)return await navigator.locks.request(key,{ifAvailable:true},lock=>lock?run():false);return await run();}finally{localRuns.delete(key);}}

export function canResume(queue:QueuedTask[],pid:string,owner?:string){const current=queue.find(t=>t.pid===pid&&t.ownerId===owner);return !!current&&current.state!=='paused'&&current.state!=='stopped';}
