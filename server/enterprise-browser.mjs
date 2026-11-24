import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {load} from 'cheerio';
import {parseProduct,cleanText} from './enterprise-product.mjs';
export const BUSINESS_ROUTES=['product-info','score-service','transfer','detail','get-bang-rank','get-promise','spu-prod'].map(x=>'callback/'+x);
export async function enterpriseBrowserPath(){
 if(process.env.ENTERPRISE_BROWSER_ENABLED==='false')return null;
 for(const path of process.env.ENTERPRISE_BROWSER_EXECUTABLE_PATH?[process.env.ENTERPRISE_BROWSER_EXECUTABLE_PATH]:['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'])try{await access(path,constants.X_OK);return path;}catch{}
 return null;
}
export function publicPageRequest(raw,productId,type='other'){
 let u;try{u=new URL(raw);}catch{return false;}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return false;
 // Permit ordinary public page resources, including its verification resources.
 // Only comments/review images and local-network destinations are excluded.
 if(/^(?:localhost|.*\.localhost|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(?:1[6-9]|2[0-9]|3[01])\..*|\[?::1\]?)$/i.test(u.hostname))return false;
 if(/comment(?:\/|$)|reviewimg|\/Community/i.test(u.pathname+' '+(u.searchParams.get('r')||'')))return false;
 return true;
}
export async function collectEnterpriseBrowser(input,signal,executablePath,launchBrowser=null){
 if(!launchBrowser){const {chromium}=await import('playwright');launchBrowser=options=>chromium.launch(options);}
 const headed=process.env.ENTERPRISE_BROWSER_HEADLESS==='false';
 const manualMs=headed?Math.min(300000,Math.max(0,Number(process.env.ENTERPRISE_BROWSER_MANUAL_VERIFICATION_MS)||0)):0;
 const controller=new AbortController(),cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});
 const timeout=setTimeout(cancel,40000+manualMs);let browser,context,page,document=null,initial=null,initialHTML=null,firstFailure=null,manualWaitStarted=null;
 const responses=[],jobs=new Set();let totalBytes=0,lastBusinessAt=0;
 const close=()=>{void context?.close().catch(()=>{});void browser?.close().catch(()=>{});};controller.signal.addEventListener('abort',close,{once:true});
 const accessCodes=['challenge_detected','region_restricted','access_denied'];
 const read=async response=>{
  const request=response.request(),u=new URL(response.url()),route=u.searchParams.get('r');
  const main=request.isNavigationRequest()&&request.frame()===page.mainFrame();
  const business=u.hostname==='product.dangdang.com'&&BUSINESS_ROUTES.includes(route)&&u.searchParams.get('productId')===input.productId;
  if(!main&&!business)return;
  // Observe only this listing. Navigation itself is not interrupted or replayed.
  if(main&&u.hostname==='product.dangdang.com'&&/^\/\d+\.html$/.test(u.pathname)&&u.pathname!==new URL(input.url).pathname)return;
  const row={url:response.url(),status:'loading',httpStatus:response.status(),contentType:(response.headers()['content-type']||'').slice(0,120),collectedAt:new Date().toISOString(),transport:'chromium_network'};
  if(business){responses.push(row);lastBusinessAt=Date.now();}
  try{
   const bytes=await response.body();row.responseBytes=bytes.length;if(business)totalBytes+=bytes.length;
   if(bytes.length>2000000||totalBytes>5000000){row.status='response_too_large';return;}
   let text;const encoding=row.contentType+' '+bytes.subarray(0,8192).toString('latin1').match(/<meta[^>]+charset[^>]+>/i)?.[0];if(/gbk|gb18030|gb2312/i.test(encoding))text=new TextDecoder('gb18030').decode(bytes);else try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030').decode(bytes);}
   const httpOK=row.httpStatus>=200&&row.httpStatus<300,httpCode=row.httpStatus===429?'rate_limited':row.httpStatus===403?'access_denied':'upstream_error';
   if(main){const parsed=parseProduct(text,input),code=!httpOK&&!accessCodes.includes(parsed.error)?httpCode:parsed.error||null,outcome=!httpOK&&!accessCodes.includes(parsed.error)?httpCode:parsed.outcome;const diag={...row,status:httpOK&&parsed.ok?'observed':'unrecognized',sourceUrl:input.url,stage:'product_document',outcome,code,recognitionRule:parsed.recognitionRule||null,browserVersion:browser.version?.()||null};delete diag.url;
    if(httpOK&&parsed.ok&&u.hostname==='product.dangdang.com'&&(u.pathname===new URL(input.url).pathname||parsed.data.product.productId===input.productId)){initial=parsed.data;initialHTML=text;document=diag;}else if(!initial){document=diag;firstFailure=Object.assign(new Error(code),{outcome,httpStatus:row.httpStatus,collectionDiagnostics:diag});}return;
   }
   if(!httpOK){row.status=httpCode;return;}
   try{row.body=JSON.parse(text);row.status='observed';}catch{const parsed=parseProduct(text,input);row.status=accessCodes.includes(parsed.error)?parsed.error:'unsupported_response';row.responseKind=/^\s*</.test(text)?'html':'unrecognized';if(row.responseKind==='html'){const root=load(text);row.parserDiagnostic={title:cleanText(root('title').text(),120),productNodes:root('.name_info h1').length,forms:root('form').length};}}
  }catch{row.status='network_error';}
  finally{if(business)lastBusinessAt=Date.now();}
 };
 try{
  signal.throwIfAborted();try{browser=await launchBrowser({executablePath,headless:!headed,timeout:10000,args:process.env.ENTERPRISE_BROWSER_NO_SANDBOX==='true'?['--no-sandbox']:[]});}catch{throw new Error('browser_unavailable');}
  if(controller.signal.aborted)throw new Error('browser_timeout');
  context=await browser.newContext();page=await context.newPage();
  // Do not intercept/replace responses, freeze redirects, block frames/assets or
  // deduplicate page requests: those can prevent normal navigation and rendering.
  await context.route('**/*',route=>publicPageRequest(route.request().url(),input.productId,route.request().resourceType())?route.continue():route.abort());
  page.on('response',response=>{const job=read(response).catch(()=>{});jobs.add(job);void job.finally(()=>jobs.delete(job));});
  await page.goto(input.url,{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>{});
  const started=Date.now();let renderedHTML=null,domSample=null,domStableAt=started,domReady=false;
  while(!controller.signal.aborted){
   signal.throwIfAborted();if(page.isClosed())throw new Error('browser_closed');
   const html=await page.content().catch(()=>null);if(html&&html.length<=3000000&&(page.url?.()||input.url).split('?')[0]===input.url){const parsed=parseProduct(html,input);if(parsed.ok){const root=load(html);const sample=['#dd-price','#original-price','#geo-name','#geo-info .select_add > b','#slef-shipping-fee','#arrive-time','#shop-service','#content .descrip','#abstract .descrip','#catalog .descrip'].map(sel=>root(sel).text()).join('\0');if(sample!==domSample){domSample=sample;domStableAt=Date.now();}domReady=(!root('#geo-info').length||!!root('#geo-name').text().trim()&&!!root('#geo-info .select_add > b').text().trim())&&(!root('#shop-service').length||!!root('#shop-service').text().trim())&&(!root('#detail').length||!!root('#detail .descrip,#detail .no_detail').text().trim());renderedHTML=html;if(!initial){initial=parsed.data;initialHTML=html;firstFailure=null;}}}
   if(!initial){
    if(headed&&manualMs&&firstFailure&&accessCodes.includes(firstFailure.message)){
     if(manualWaitStarted===null){manualWaitStarted=Date.now();console.log('enterprise_collection_verification '+JSON.stringify({productId:input.productId,status:'waiting_for_user',browser:'headed',timeoutMs:manualMs}));}
     if(Date.now()-manualWaitStarted<manualMs){await page.waitForTimeout(500);continue;}
    }
    if(Date.now()-started>12000)break;
   }else{
    if(Date.now()-started>=12000)break;
    if(domReady&&Date.now()-domStableAt>=1500&&responses.some(r=>r.status==='observed')&&!jobs.size&&Date.now()-lastBusinessAt>=1800&&Date.now()-started>=4000)break;
   }
   await page.waitForTimeout(500);
  }
  signal.throwIfAborted();if(!initial)throw firstFailure||new Error('product_document_unavailable');
  for(const row of responses)if(row.status==='loading')row.status='timeout';
  const html=renderedHTML||initialHTML;
  const parsed=parseProduct(html,{...input,sourceResponses:responses,rendered:!!renderedHTML,expectedRoutes:BUSINESS_ROUTES,initialData:initial});
  if(!parsed.ok)throw Object.assign(new Error(parsed.error),{outcome:parsed.outcome,collectionDiagnostics:document});
  parsed.data.collectionDiagnostics={...document,outcome:parsed.outcome,dynamicSources:'page_observed_business_responses',browserVersion:browser.version?.()||null,headed,manualVerificationCompleted:manualWaitStarted!==null,renderedDOMReady:domReady,domWaitMs:Date.now()-started};return parsed;
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',close);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
