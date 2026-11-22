// Local Vite/Chromium only. API calls are fixtures; external requests are aborted.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validateReview,sourceQuality} from '../server/ai-review.mjs';
const base='http://127.0.0.1:4174',name='.visual-check-'+randomUUID(),jobId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let browser;
const comments=[{id:'C0',sourceId:'1000',data:{text:'买家原始评论零',variant:'当前款'}},{id:'C1',sourceId:'1001',data:{text:'买家原始评论一',variant:'其他版本'}}],images=[{id:'I0',aliases:['I-alias'],comments:['C0']},{id:'I1',comments:['C1']}];
const input={product:{name:'服装商品 mock',sellerMetadata:{description:'商家提供的细节说明'}},comments,images,scope:{comments:2}};
const visuals=[{type:'topics',title:'包装与开箱',topics:[{label:'包装细节',note:'模型给出的主题说明',commentIds:['C0','C1','C0']}]},{type:'image_observations',title:'模型观察的细节',images:[{imageId:'I0',caption:'图中可见包装边角',relatedCommentIds:['C0']},{imageId:'I1',caption:'图片暂不可用时保留的模型说明',relatedCommentIds:['C1']}]},{type:'experience_comparison',title:'两组体验对照',groups:[{title:'包装体验',claims:[{text:'模型选择的第一组体验',commentIds:['C0'],imageIds:[]}]},{title:'另一版本的体验',claims:[{text:'模型选择的第二组体验',commentIds:['C1'],imageIds:[]}]}]},{type:'seller_vs_evidence',title:'商家与买家',items:[{metadataId:'M1',assessment:'insufficient',text:'缺少足够对应证据，不表示说明有误',commentIds:[],imageIds:[]}]}];
const raw={headline:'模型生成的综合判断',summary:'模型生成的完整综合文章。\n第二段仍然是文章主体。',considerations:['购买前确认具体版本'],sourceIds:['C0','I0','I-alias']};
const sent=images.map((i,n)=>({id:i.id,hash:'hash'+n}));
const checked=validateReview({...raw,visuals},input,sent);assert.equal(checked.visuals.length,4);
const quality=sourceQuality(comments,[...sent.map((i,n)=>({...i,comments:[comments[n].id]})),{id:'I-alias',hash:'hash0',comments:['C0']}]);
let scenario='valid',postCount=0,evidenceReads=[],jobReads=0;const errors=[];
await writeFile(new URL('../'+name+'.html',import.meta.url),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/'+name+'.tsx"></script>');
await writeFile(new URL('../'+name+'.tsx',import.meta.url),`import React from 'react';import{createRoot}from'react-dom/client';import{AIReport}from'./src/AIReport';import './src/styles.css';createRoot(document.getElementById('root')!).render(<AIReport user={{id:'owner',email:'mock@example.invalid',verified:true,plan:'pro'}} runId="run-owned"/>);`);
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 const report=()=>({...scenario==='legacy'?raw:scenario==='empty'?validateReview({...raw,visuals:[]},input,sent):scenario==='partial'?validateReview({...raw,visuals:[visuals[0],{type:'topics',title:'不应显示',topics:[]}]},input,sent):checked,schemaVersion:4,generatedAt:'2026-11-22T00:00:00Z',partial:scenario==='partial',method:'mock',hasSynthesis:true,scope:{comments:2,imageReferences:2,uniqueImages:2,unreadImages:0},quality});
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();const p=u.pathname,json=d=>route.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  if(req.method()==='POST'){postCount++;throw new Error('Unexpected inference/write: '+p);}
  if(p.endsWith('/preview'))return json({ready:true,blocked:false,comments:2,images:2});
  if(p==='/api/ai/jobs')return json({rows:[{id:jobId,run_id:'run-owned',pid:'12345',name:'服装商品 mock',state:'completed'}],total:1});
  if(p===`/api/ai/jobs/${jobId}`){jobReads++;return json({id:jobId,runId:'run-owned',state:scenario==='partial'?'partial':'completed',product:input.product,model:'mock',provider:'mock',mock:true,coverage:{comments:{total:2,completed:2},images:{total:2,completed:2},units:{total:2,completed:2},complete:true},createdAt:'2026-11-22T00:00:00Z',report:report(),categories:[],failures:[],errorsTotal:0,usage:{attempts:1,prompt_tokens:'0',completion_tokens:'0',cache_hits:0}});}
  if(p.endsWith('/evidence')){const c=u.searchParams.get('comment'),i=u.searchParams.get('image'),m=u.searchParams.get('metadata');evidenceReads.push([c,i,m]);if(c)return json({comment:comments.find(x=>x.id===c),images:images.filter(x=>x.comments.includes(c))});if(i)return json({image:{id:i,content_hash:'mock-hash'},comments:comments.filter(x=>images.find(y=>y.id===i)?.comments.includes(x.id))});if(m)return json({metadata:checked.sourceCatalog[m]});}
  if(p.includes('/image/')){if(p.endsWith('/I1'))return route.fulfill({status:503,body:''});return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCGQAAAAASUVORK5CYII=','base64')});}
  if(p.endsWith('/chat'))return json({conversation:null,turns:[],catalog:[],sessions:[]});
  if(p.startsWith('/api/'))throw new Error('Unmocked API '+p);return route.continue();
 });
 await page.goto(`${base}/${name}.html?aiJob=${jobId}`);await page.getByRole('heading',{name:'模型生成的综合判断'}).waitFor();
 assert.equal(await page.locator('.ai-visual-block').count(),4);assert.equal(await page.locator('.ai-evidence-thumbnails').count(),0,'Visual images must not repeat in the evidence rail, including aliases');
 const topic=page.getByRole('button',{name:'包装细节，2 条关联评论，查看来源'});await topic.focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'主题关联评论'}).getByRole('button',{name:'查看原始评论 2'}).click();await page.getByRole('dialog',{name:'原始证据'}).getByText('买家原始评论一',{exact:true}).waitFor();assert.equal(evidenceReads.at(-1)[0],'C1');await page.getByRole('button',{name:'关闭证据',exact:true}).click();
 await page.getByRole('button',{name:'查看原图与关联评论：图中可见包装边角'}).click();await page.getByRole('dialog',{name:'原始证据'}).getByRole('heading',{name:'买家秀原图'}).waitFor();assert.equal(evidenceReads.at(-1)[1],'I0');await page.getByRole('button',{name:'关闭证据',exact:true}).click();
 await page.getByText('图片暂时无法加载 · 点击查看来源',{exact:true}).waitFor();await page.getByRole('button',{name:'查看商家资料',exact:true}).click();await page.getByRole('dialog',{name:'原始证据'}).getByText('商家提供的细节说明',{exact:true}).waitFor();assert.equal(evidenceReads.at(-1)[2],'M1');await page.getByRole('button',{name:'关闭证据',exact:true}).click();
 for(const width of [390,1280]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const boxes=await page.locator('.ai-visual-columns').first().locator(':scope > div').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));assert.equal(width===390?boxes[0].y<boxes[1].y:boxes[0].x<boxes[1].x,true);}
 const reads=jobReads;await page.reload();await page.getByRole('heading',{name:'模型生成的综合判断'}).waitFor();assert.ok(jobReads>reads);assert.equal(postCount,0);
 scenario='partial';await page.reload();await page.getByText(/部分可视化未通过结构或来源检查/).waitFor();assert.equal(await page.locator('.ai-visual-block').count(),1);assert.equal(await page.getByRole('heading',{name:'不应显示'}).count(),0);
 for(const mode of ['legacy','empty']){scenario=mode;await page.reload();await page.getByRole('heading',{name:'模型生成的综合判断'}).waitFor();assert.equal(await page.locator('.ai-visuals').count(),0);await page.getByText('模型生成的完整综合文章。',{exact:true}).waitFor();}
 assert.equal(postCount,0);assert.deepEqual(errors,[]);console.log('Local Chromium visuals passed: 4 blocks, ID counts, keyboard/comment/image/metadata viewer mapping, no repeated rail images, image failure, mobile/desktop, partial/legacy/empty, refresh without inference. All APIs mocked.');
}finally{await browser?.close();await unlink(new URL('../'+name+'.html',import.meta.url));await unlink(new URL('../'+name+'.tsx',import.meta.url));}
