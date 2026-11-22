// Local Chromium + mocked HTTP only. Never connects to production or a provider.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base=process.env.CHAT_CHECK_BASE_URL||'http://127.0.0.1:4174';
const target=new URL(base);if(!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('Loopback Vite only');
const fixture='.chat-check-'+randomUUID();
await writeFile(new URL('../'+fixture+'.html',import.meta.url),`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/${fixture}.tsx"></script></body></html>`);
await writeFile(new URL('../'+fixture+'.tsx',import.meta.url),`import React from 'react';import {createRoot} from 'react-dom/client';import {AIChat} from './src/AIChat';import './src/styles.css';createRoot(document.getElementById('root')!).render(<main style={{maxWidth:900,margin:'auto',padding:12}}><AIChat jobId="job-mock" runId="snapshot-mock-only" name="测试图书 · 典藏版"/></main>);`);
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHAT_CHECK_CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1280,height:900}});let submissions=0,preflights=0,reads=0,session='session-old',turns=[],lastSubmission,rejectBudget=false;
 const catalog=Array.from({length:6},(_,i)=>({id:'I'+i,available:i!==5,comments:['C47']}));
 const sources={C47:{label:'原评 C47 · 普通版',targetProductId:'30113677',sourceProductId:'29473473',variant:'普通版',versionStatus:'可能为其他版本／版本未确认',detailUrl:'https://comment.dangdang.com/comment/detail/0/29473473/47'}};
 const failures=[];page.on('pageerror',error=>failures.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.hostname!==target.hostname)return route.abort();
  const pathname=url.pathname;
  const json=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(pathname==='/api/auth/csrf')return json({csrfToken:'c'.repeat(64)});
  if(pathname.includes('/image/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="90" height="100"><rect width="90" height="100" fill="#d8c6ab"/></svg>'});
  if(pathname.endsWith('/chat/evidence'))return json({comment:{id:'C47',data:{text:'普通版读者评价',variant:'普通版',detail_url:sources.C47.detailUrl},provenance:sources.C47},images:[{id:'I0'}]});
  if(pathname.endsWith('/chat/preflight')){preflights++;if(rejectBudget)return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({msg:'超过聊天单独配置的上下文上限，请减少图片或开始新对话。'})});return json({fits:true});}
  if(pathname.endsWith('/chat/sessions')){session=JSON.parse(req.postData()).sessionId;turns=[];return json({sessionId:session});}
  if(pathname.endsWith('/cancel')){turns=turns.map(t=>({...t,state:'cancelled'}));return json({ok:true});}
  if(pathname.endsWith('/chat')){
   if(req.method()==='GET'){reads++;return json({conversation:{id:'conv-mock',runId:'snapshot-mock-only',mock:true},sessionId:session,sessions:[{id:session,created_at:'2026-11-22T00:00:00Z'}],turns,catalog,sources,limits:{questionChars:2000,images:4,historyTurns:8}});}
   submissions++;lastSubmission=JSON.parse(req.postData());turns.push({id:lastSubmission.requestId,ordinal:turns.length+1,question:lastSubmission.question,purpose:lastSubmission.purpose,image_ids:lastSubmission.imageIds,state:'completed',result:{text:'第一点 [1]\n\n- 买家说法\n- 需要确认版本',references:[{citation:1,type:'comment',id:'C47'}]},scope:{comments:78,commentsTotal:78,images:lastSubmission.imageIds.length,imagesTotal:6,historyIncluded:6,historyOmitted:0,deliveryConfirmed:true,deliveredImageIds:lastSubmission.imageIds},actual_model:'mock-model'});return json({accepted:true});
  }
  if(pathname.startsWith('/api/'))throw new Error('Unmocked API '+pathname);
  return route.continue();
 });
 await page.goto(base+'/'+fixture+'.html');await page.getByRole('button',{name:'发送',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#didi-question')?.disabled);
 await page.selectOption('#didi-purpose','gift');await page.locator('.ai-chat-picker summary').click();await page.getByLabel('选择图片 I0',{exact:true}).check();await page.getByLabel('选择图片 I1',{exact:true}).check();await page.getByLabel('选择图片 I2',{exact:true}).check();await page.getByLabel('选择图片 I3',{exact:true}).check();assert.equal(await page.getByLabel('选择图片 I4',{exact:true}).isDisabled(),true);assert.equal(submissions,0);assert.equal(preflights,0);
 await page.getByLabel('选择图片 I1',{exact:true}).uncheck();await page.locator('.ai-chat-image-option').first().getByRole('button',{name:'问问 DiDi',exact:true}).click();assert.equal(await page.locator('#didi-question').inputValue(),'这张买家图片能看出哪些细节？哪些仍需确认？');assert.equal(submissions,0);
 await page.locator('#didi-question').fill('你还在马');
 await page.locator('#didi-question').dispatchEvent('compositionstart');await page.locator('#didi-question').press('Enter');assert.equal(submissions,0);await page.locator('#didi-question').dispatchEvent('compositionend');
 await page.locator('#didi-question').press('Shift+Enter');assert.ok((await page.locator('#didi-question').inputValue()).includes('\n'));await page.locator('#didi-question').press('Enter');
 await page.getByRole('button',{name:'来源 [1] · 原评 C47 · 普通版'}).waitFor();assert.equal(submissions,1);assert.equal(preflights,1);assert.equal(lastSubmission.purpose,'gift');assert.deepEqual(lastSubmission.imageIds,['I0']);assert.equal(await page.locator('.ai-chat-answer li').count(),2);
 await page.getByRole('button',{name:'来源 [1] · 原评 C47 · 普通版'}).click();await page.getByText('普通版读者评价',{exact:true}).waitFor();assert.ok((await page.locator('.ai-chat-evidence').innerText()).includes('#29473473'));await page.getByRole('button',{name:'关闭来源'}).click();
 assert.equal(await page.getByText('snapshot-mock-only',{exact:true}).isVisible(),false);await page.locator('.ai-chat-basis summary').click();assert.equal(await page.getByText('本轮未查看图片；旧报告中的图片描述仅供参考。').count(),0);
 // Legacy [1] must remain literal and use its explicitly named source button.
 turns.push({id:'legacy',ordinal:2,question:'旧记录',state:'completed',result:{text:'旧记录 [1]',references:[{type:'comment',id:'C47'}]},scope:null});await page.reload();await page.getByRole('button',{name:'原评 C47 · 普通版',exact:true}).waitFor();assert.equal(submissions,1);
 await page.locator('#didi-question').fill('草稿保留');await page.getByRole('button',{name:'开始新对话',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.ai-chat-turn').length===0);assert.equal(await page.locator('#didi-question').inputValue(),'草稿保留');assert.equal(submissions,1);
 rejectBudget=true;await page.locator('#didi-question').press('Enter');await page.getByRole('alert').filter({hasText:'超过聊天单独配置'}).waitFor();assert.equal(await page.locator('#didi-question').inputValue(),'草稿保留');assert.equal(submissions,1);
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');}
 assert.equal(failures.length,0,failures.join('\n'));assert.ok(reads>2);
 console.log('Local Chromium mock passed: selection/max4, purpose, image question draft, IME/Enter/Shift+Enter, preflight/draft retention, explicit citation/source/variant, legacy mapping, new session/refresh without inference, desktop/mobile layout. No production/provider requests.');
}finally{await browser?.close();await unlink(new URL('../'+fixture+'.html',import.meta.url));await unlink(new URL('../'+fixture+'.tsx',import.meta.url));}
