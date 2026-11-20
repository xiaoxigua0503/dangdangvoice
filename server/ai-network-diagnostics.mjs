// Explicit, bounded, read-only diagnostics: no Authorization, inference, emails or user text.
import {lookup} from 'node:dns/promises';
import https from 'node:https';
function failure(e,depth=0){if(!e||depth>3)return;return {name:e.name,code:/^[A-Z0-9_]{1,70}$/.test(e.code||'')?e.code:undefined,cause:failure(e.cause,depth+1),errors:Array.isArray(e.errors)?e.errors.slice(0,5).map(x=>failure(x,depth+1)):undefined};}
export async function networkDiagnostics(config,pool){
 console.log('ai_network '+JSON.stringify({event:'environment',node:process.version,proxyVariables:Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS'].map(k=>[k,!!process.env[k]]))}));
 const targets=[{kind:'provider',url:new URL(config.endpoint.replace(/\/$/,'')+'/models')},{kind:'control',url:new URL('https://example.com/')}];
 const row=(await pool.query('SELECT url FROM ai_images WHERE job_id=$1 LIMIT 1',[process.env.AI_NETWORK_DIAGNOSTIC_JOB_ID])).rows[0];
 if(row){const{imageURL}=await import('./ai-images.mjs');targets.push({kind:'image',url:imageURL(row.url)});}
 for(const {kind,url}of targets){
  try{const addresses=await lookup(url.hostname,{all:true});console.log('ai_network '+JSON.stringify({event:'dns',kind,host:url.hostname,addresses}));}catch(e){console.log('ai_network '+JSON.stringify({event:'dns_error',kind,error:failure(e)}));}
  for(const family of [4]){
   let phase='dns';const result=await new Promise(resolve=>{const req=https.request(url,{method:'HEAD',family,signal:AbortSignal.timeout(8000)},res=>{res.resume();resolve({httpStatus:res.statusCode});});req.on('socket',socket=>{socket.on('connect',()=>phase='tcp_connected');socket.on('secureConnect',()=>phase='tls_connected');});req.on('error',e=>resolve({phase,error:failure(e)}));req.end();});
   console.log('ai_network '+JSON.stringify({event:'head',kind,family,...result}));
  }
 }
}
