// Offline only. Structural derivative of the observed product challenge; no
// copied challenge code, renderData tokens, network calls or script execution.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseProduct} from '../server/enterprise-product.mjs';
import {collectEnterprise} from '../server/enterprise-worker.mjs';
const input={productId:'30119333',url:'https://product.dangdang.com/30119333.html'};
const challenge='<html><body><textarea style="display:none">public configuration</textarea><textarea id="renderData" style="display:none">[REDACTED]</textarea><script>/* aliyun_waf document.cookie '+'.'.repeat(1600)+' */</script></body></html>';
assert.equal(parseProduct(challenge,input).error,'challenge_detected');
assert.equal(parseProduct(challenge.replace('display:none','display:block'),input).error,'product_schema_unrecognized');
const fixture=await readFile(new URL('../tests/fixtures/enterprise-product.html',import.meta.url),'utf8');
assert.equal(parseProduct(fixture.replace('</body>',challenge+'</body>'),input).ok,true,'valid product content must not become a challenge');
let calls=0;
await assert.rejects(collectEnterprise(input,new AbortController().signal,async()=>{calls++;return new Response(challenge,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});}),e=>{assert.equal(e.message,'challenge_detected');assert.equal(e.collectionDiagnostics.httpStatus,200);assert.equal(e.collectionDiagnostics.stage,'product_document');assert.ok(!JSON.stringify(e.collectionDiagnostics).includes('[REDACTED]'));return true;});
assert.equal(calls,1,'no callback guessing or automatic challenge retry');
console.log('Enterprise access fixtures passed (offline, no model/network)');
