import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{parseProduct,enterpriseServiceRequest,safeURL}from'../server/enterprise-product.mjs';
import{collectEnterprise}from'../server/enterprise-worker.mjs';
import{snapshotDocument}from'../server/enterprise-context.mjs';
globalThis.fetch=()=>{throw Error('Offline only');};
const service=await readFile(new URL('../tests/fixtures/enterprise-metadata/score-service.html',import.meta.url),'utf8');
const docs=[];
for(const id of ['30119333','24193243']){
 let html=await readFile(new URL(`../tests/fixtures/enterprise-report/${id}-document-fragment.html`,import.meta.url),'utf8');
 // Fixture holds a JSON data copy, while the public document uses a restricted literal.
 const match=html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);assert.ok(match);const info=JSON.parse(match[1]).prodSpuInfo;
 Object.assign(info,{isGiftPackaging:'1',isSupportReturnPolicy:'1',isPod:'0',productType:'0',isCatalog:'0',mediumId:'0'});
 html=html.replace(match[0],'<script>var prodSpuInfo = '+JSON.stringify(info)+';</script>');
 const url=`https://product.dangdang.com/${id}.html`,request=enterpriseServiceRequest(html,id);assert.ok(request);const query=new URL(request).searchParams;assert.equal(query.get('productId'),id);assert.equal(query.get('shopId'),'0');assert.equal(query.get('ddShopId'),'258');
 const response={url:request,status:'observed',body:{data:{shopService:service}},httpStatus:200,contentType:'application/json',collectedAt:'2026-11-24T09:00:00Z'};
 const d=parseProduct(html,{productId:id,url,sourceResponses:[response]}).data;
 assert.match(d.delivery.giftWrap,/18.00/);assert.match(d.delivery.giftWrap,/2.00/);assert.match(d.delivery.returns,/7天/);assert.match(d.delivery.returns,/15天/);assert.match(d.shop.services,/差价返还/);assert.equal(d.shop.afterSales,null);assert.equal(d.delivery.shippingFee,null);assert.equal(d.delivery.stockStatus,null);assert.equal(d.other_seller_offers,null);assert.equal(d.shop.shopId,'0');
 const observation=d.observations.find(o=>o.field==='delivery.giftWrap');assert.equal(observation.layer,'response');assert.equal(new URL(observation.sourceUrl).searchParams.get('r'),'callback/score-service');assert.equal(new URL(observation.sourceUrl).searchParams.get('productId'),id);assert.match(observation.sourcePath,/li.lpbz/);
 for(const status of ['challenge_detected','timeout','rate_limited','unsupported_response']){const partial=parseProduct(html,{productId:id,sourceResponses:[{...response,status,body:null}]}).data;assert.equal(partial.product.title,d.product.title);assert.equal(partial.book.isbn,d.book.isbn);assert.equal(partial.price.display,d.price.display);assert.equal(partial.delivery.giftWrap,null);assert.equal(partial.sourceStatus[0].status,status);}
 const other=parseProduct(html,{productId:id,sourceResponses:[{...response,url:request.replace('productId='+id,'productId=99999999')}]}).data;assert.equal(other.delivery.giftWrap,null);assert.equal(other.sourceStatus.length,0);
 let calls=0;const collected=await collectEnterprise({productId:id,url},new AbortController().signal,async()=>++calls===1?new Response(html,{headers:{'content-type':'text/html;charset=utf-8'}}):new Response(JSON.stringify(response.body),{headers:{'content-type':'application/json'}}));assert.equal(calls,2);assert.equal(collected.data.delivery.giftWrap,d.delivery.giftWrap);
 const cancelled=new AbortController();await assert.rejects(collectEnterprise({productId:id,url},cancelled.signal,async()=>{cancelled.abort();return new Response(html,{headers:{'content-type':'text/html;charset=utf-8'}});}),e=>e.name==='AbortError');
 docs.push({state:'completed',product_id:id,data:d});
}
const snap=snapshotDocument(docs,{id:'metadata-fixture',input_count:2,rejected:[]});assert.equal(snap.coverage.read,2);assert.match(snap.coverage.limitations[0],/已核实公开服务响应/);assert.ok(snap.listings.every(d=>d.observations.some(o=>o.field==='delivery.giftWrap'&&o.layer==='response')));assert.notEqual(snap.listings[0].book.isbn,snap.listings[1].book.isbn);assert.equal(snap.statistics.identifiedShops,1);
assert.ok(!safeURL('https://product.dangdang.com/index.php?r=callback/score-service&productId=30119333&token=SECRET').includes('SECRET'));
console.log('Offline metadata fixtures passed: service conditions/source identity, separate shop IDs, null shipping/stock/offers, partial-source failures retain facts, cancellation, bounded two-request collection, and snapshot observations. No network/model/DB.');
