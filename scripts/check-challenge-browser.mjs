// Local UI harness only. Every API is mocked; external requests are aborted.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:4174',name='.challenge-check-'+randomUUID();let browser;
await writeFile(new URL('../'+name+'.html',import.meta.url),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/'+name+'.tsx"></script>');
await writeFile(new URL('../'+name+'.tsx',import.meta.url),`import React from 'react';import{createRoot}from'react-dom/client';import{App}from'./src/App';import './src/styles.css';createRoot(document.getElementById('root')!).render(<App sessionUser={{id:'owner',email:'mock@example.invalid',verified:true,plan:'pro'}} onSessionChange={()=>{}}/>);`);
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1280,height:900}});await page.clock.install();
 let scenario='list',calls=[],saved,held,ready;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const challenge={ok:false,blocked:true,outcome:'challenge_detected',code:'challenge_detected',httpStatus:200,retryAfterMs:60000};
 const analysis=comments=>({total:comments.length,meaningful:comments.length,auto_reviews:0,auto_share:0,image_reviews:0,avg_score:8,labels:{pos:comments.length,neu:0,neg:0},pos_rate:1,neg_rate:0,score_hist:{},themes:[],top_neg_themes:[],pos_words:[],neg_words:[],red_flags:[],red_flag_count:0,variants:[],trend:[],examples_pos:[],examples_neg:[],engine:'mock'});
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();const path=u.pathname,json=d=>route.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  if(path==='/api/auth/csrf')return json({csrfToken:'c'.repeat(64)});
  if(path==='/api/session')return json({gated:false,unlocked:true});if(path==='/api/status')return json({egress:{list:'unknown',detail:'unknown'}});
  if(path==='/api/collection/lease')return json({ok:true});
  if(path==='/api/relay'){const b=JSON.parse(req.postData());calls.push(b.action);
   if(b.action==='prime')return json(scenario==='prime'?challenge:{ok:true,blocked:false,outcome:'completed',meta:{name:'真实商品名',price:'42',image:null}});
   if(scenario==='cancel'){held=route;ready?.();return;}
   if(b.action==='list'&&(scenario==='partial'||scenario==='detail')&&b.pageIndex===1)return json({ok:true,blocked:false,outcome:'completed',summary:{total_comment_num:2,pageCount:scenario==='partial'?2:1},items:[{cid:'67890',text:'已取得的评论原文',score:8,has_img:false,detail_url:'https://comment.dangdang.com/comment/detail/0/'+b.pid+'/67890'}]});
   return json(challenge);
  }
  if(path==='/api/analyze'){const b=JSON.parse(req.postData());return json({analysis:analysis(b.comments),comments:b.comments});}
  if(path==='/api/history'){if(req.method()==='POST'){saved=JSON.parse(req.postData());return json({id:'mock-run'});}return json({rows:[],total:0});}
  if(path.endsWith('/preview'))return json({ready:false,blocked:false,comments:0,images:0});
  if(path.endsWith('/chat'))return json({conversation:null,turns:[],catalog:[],sessions:[]});
  if(path.startsWith('/api/ai/')){assert.equal(req.method(),'GET','No inference submission');return json({rows:[]});}
  if(path.startsWith('/api/'))throw new Error('Unmocked API '+path);return route.continue();
 });
 const submit=async pid=>{await page.locator('#url').fill(pid);await page.getByRole('button',{name:'采集并分析',exact:true}).click();};
 const queue=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('ddv-task-queue-v1')||'[]'));
 await page.goto(base+'/'+name+'.html');
 await submit('1173899070');await page.locator('.cat-err').filter({hasText:'访问验证页面'}).first().waitFor();assert.deepEqual(calls,['prime','list']);assert.equal((await queue())[0].state,'paused');assert.equal(saved.comments.length,0);assert.equal(saved.product.name,'真实商品名');
 const before=calls.length;await page.locator('.qb-row').filter({hasText:'1173899070'}).getByRole('button',{name:'立即重试'}).click();await page.locator('.cat-err').filter({hasText:'等待'}).first().waitFor();assert.equal(calls.length,before);
 await page.reload();await page.locator('#url').waitFor();await page.clock.fastForward(180000);assert.equal(calls.length,before,'Reload must not resume paused challenge');
 // A known sample PID must also pause, without silently switching to sample data.
 scenario='prime';calls=[];await submit('29871753');await page.locator('.cat-err').filter({hasText:'访问验证页面'}).first().waitFor();assert.deepEqual(calls,['prime']);assert.equal(saved.product.source,'relay');assert.equal(saved.comments.length,0);
 for(const mode of ['partial','detail']){
  scenario=mode;calls=[];const pid=mode==='partial'?'111112222':'111113333';await submit(pid);
  if(mode==='partial'){await page.getByText(/第1页 ✓/).first().waitFor({state:'attached'});await page.clock.fastForward(2000);}
  await page.locator('.cat-err').filter({hasText:'已保留 1 条评论'}).first().waitFor();assert.equal(saved.comments[0].text,'已取得的评论原文');assert.equal(saved.product.name,'真实商品名');assert.equal(saved.product.site.collection_outcome,'partial');assert.match(saved.product.analysis.note_partial,/尚未获取/);
  assert.deepEqual(calls,mode==='partial'?['prime','list','list']:['prime','list','detail']);assert.equal((await queue()).find(t=>t.pid===pid).state,'paused');
 }
 scenario='cancel';calls=[];const pending=new Promise(resolve=>{ready=resolve;});await submit('111114444');await pending;await page.getByRole('button',{name:'停止本轮',exact:true}).click();await held.fulfill({contentType:'application/json',body:JSON.stringify(challenge)}).catch(()=>{});await page.getByRole('button',{name:'采集并分析',exact:true}).waitFor();await page.clock.fastForward(200000);assert.equal((await queue()).some(t=>t.pid==='111114444'&&t.state==='waiting'),false);assert.deepEqual(calls,['prime','list']);
 // Exercise the automatic queue runner, including preservation after it pauses itself.
 scenario='prime';calls=[];await page.evaluate(()=>{localStorage.setItem('ddv-task-queue-v1',JSON.stringify([{pid:'111115555',ownerId:'owner',url:'https://product.dangdang.com/111115555.html',maxPages:2,maxDetails:2,addedAt:Date.now(),lastTry:Date.now()-30000,tries:0,state:'waiting'}]));});
 await page.reload();await page.locator('#url').waitFor();await page.clock.fastForward(6000);
 await page.locator('.qb-row').filter({hasText:'111115555'}).filter({hasText:'已暂停'}).waitFor();assert.deepEqual(calls,['prime']);assert.equal(saved.product.pid,'111115555');assert.equal(saved.product.site.collection_outcome,'challenge_detected');
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);console.log('Local Chromium challenge mocks passed: prime/list/detail pause, partial data, sample bypass prevention, cooldown, reload, cancel/late response, mobile/desktop. No real API/provider/crawl.');
}finally{await browser?.close();await unlink(new URL('../'+name+'.html',import.meta.url));await unlink(new URL('../'+name+'.tsx',import.meta.url));}
