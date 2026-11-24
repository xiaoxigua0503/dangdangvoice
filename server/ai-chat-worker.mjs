import {pool} from './db.mjs';
import {aiConfig,providerReady} from './ai-config.mjs';
import {claimChat,executeChat} from './ai-chat-worker-core.mjs';
if(!pool)throw new Error('DATABASE_URL is required');
if(!(await pool.query("SELECT 1 FROM schema_migrations WHERE version='010_chat_sessions_evidence.sql'")).rowCount)throw new Error('Chat requires migration 010_chat_sessions_evidence.sql');
const enterpriseReady=!!(await pool.query("SELECT to_regclass('enterprise_tasks') ready")).rows[0]?.ready;
const {runEnterpriseOne}=await import('./enterprise-worker.mjs');let enterpriseTurn=true;
const controller=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>controller.abort());
const enabled=process.env.AI_CHAT_WORKER_ENABLED==='true';
console.log('ai_chat_worker '+JSON.stringify({protocol:'product-chat-v2',enabled,providerReady:providerReady(aiConfig())}));
// Explicitly opt-in, independent queue. No diagnostics/crawl/model calls on boot.
try{while(!controller.signal.aborted){
 if(enabled&&providerReady(aiConfig())){const enterprise=()=>enterpriseReady?runEnterpriseOne({role:'chat',signal:controller.signal}):false;let worked=enterpriseTurn?await enterprise():false;if(!worked){const request=await claimChat();if(request){await executeChat(request,{signal:controller.signal});worked=true;}}if(!worked&&!enterpriseTurn)worked=await enterprise();enterpriseTurn=!enterpriseTurn;if(worked)continue;}
 await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,1500);controller.signal.addEventListener('abort',finish,{once:true});});
}}finally{await pool.end();}
