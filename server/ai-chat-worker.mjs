import {pool} from './db.mjs';
import {aiConfig,providerReady} from './ai-config.mjs';
import {claimChat,executeChat} from './ai-chat-worker-core.mjs';
if(!pool)throw new Error('DATABASE_URL is required');
if(!(await pool.query("SELECT 1 FROM schema_migrations WHERE version='009_product_chat.sql'")).rowCount)throw new Error('Chat requires migration 009_product_chat.sql');
const controller=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>controller.abort());
const enabled=process.env.AI_CHAT_WORKER_ENABLED==='true';
console.log('ai_chat_worker '+JSON.stringify({protocol:'product-chat-v1',enabled,providerReady:providerReady(aiConfig())}));
// Explicitly opt-in, independent queue. No diagnostics/crawl/model calls on boot.
try{while(!controller.signal.aborted){
 if(enabled&&providerReady(aiConfig())){const request=await claimChat();if(request){await executeChat(request,{signal:controller.signal});continue;}}
 await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,1500);controller.signal.addEventListener('abort',finish,{once:true});});
}}finally{await pool.end();}
