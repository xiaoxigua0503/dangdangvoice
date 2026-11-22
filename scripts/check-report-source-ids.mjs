// Pure, offline contract checks: no DB, workers, network or model calls.
import assert from 'node:assert/strict';
import {makePlan} from '../server/ai-jobs.mjs';
import {validateReview,reviewPayload,requestEnvelope,budgetInput} from '../server/ai-review.mjs';
import {aiConfig,PROMPT_VERSION} from '../server/ai-config.mjs';
const rows=[{cid:'379237662',text:'买家原文一',detail_url:'https://comment.dangdang.com/comment/detail/0/123/379237662'},{cid:'379197532',text:'买家原文二'}];
const plan=makePlan(rows,{pid:'123'},{});
const input={...plan.units[0].input,images:[{id:'I-photo',aliases:['I-alias'],comments:['C0']}],unread:[{id:'I-unread',error:'image_unavailable'}]};
const answer=sourceIds=>({summary:'用于离线合约验证的模拟结果',considerations:[],sourceIds});
const run=(ids,context=input)=>validateReview(answer(ids),context).sourceIds;
const before=JSON.stringify(input);
assert.deepEqual(run(['C0','C1']),['C0','C1']);
assert.deepEqual(run(['379237662','379197532']),['C0','C1']);
assert.deepEqual(run(['C0','379237662','I-photo','379197532','I-alias','I-unread','I-photo','C0']),['C0','I-photo','C1','I-alias','I-unread']);
function rejected(ids,context,reason){assert.throws(()=>run(ids,context),error=>{assert.equal(error.message,'invalid_reference');assert.equal(error.permanent,true);assert.equal(error.validationIssues[0].receivedId,ids.find(id=>!['C0','C1'].includes(id)));if(reason)assert.equal(error.validationIssues[0].reason,reason);assert.ok(!JSON.stringify(error.validationIssues).includes('买家原文'));return true;});}
rejected(['C0','not-present'],input,'unknown_source_id');
rejected(['123'],input,'unknown_source_id');
rejected(['实际来源编号'],input,'unknown_source_id');
rejected([' 379237662'],input,'unknown_source_id');
const duplicate={...input,comments:[{id:'C0',sourceId:'same-cid'},{id:'C1',sourceId:'same-cid'}]};
rejected(['same-cid'],duplicate,'ambiguous_comment_source_id');
// Duplicate entries also cannot make a repeated cid appear unique.
rejected(['same-cid'],{...input,comments:[{id:'C0',sourceId:'same-cid'},{id:'C0',sourceId:'same-cid'}]},'ambiguous_comment_source_id');
assert.deepEqual(run(['C0'],{...input,comments:[{id:'C0',sourceId:'original'},{id:'C1',sourceId:'C0'}]}),['C0']);
rejected(['379237662'],{...input,comments:[{id:'C0',data:{cid:'379237662',detail_url:rows[0].detail_url}}]},'unknown_source_id');
const payload=reviewPayload(input);
assert.deepEqual(payload.allowedSourceIds,['C0','C1','I-photo','I-alias','I-unread']);
assert.equal(payload.comments[0].sourceId,'379237662');assert.equal(payload.comments[0].id,'C0');
assert.equal(payload.responseFormat.type,'object');assert.equal(payload.responseFormat.properties.sourceIds.type,'array');
assert.ok(!JSON.stringify(payload.responseFormat).includes('实际来源编号'));
const config=aiConfig();
const body=requestEnvelope(config,input,[]);
assert.deepEqual(JSON.parse(body.messages[1].content[0].text).allowedSourceIds,payload.allowedSourceIds);
assert.equal(budgetInput(config,input,[]).payloadBytes,Buffer.byteLength(JSON.stringify(body)));
assert.equal(JSON.stringify(input),before,'Never mutate immutable historical input');
assert.equal(PROMPT_VERSION,'ddv-product-summary-18-visuals-1');
console.log('Report source-ID mock checks passed: internal/cid/unknown/ambiguous/duplicate/mixed image aliases/dedup/precedence, explicit payload schema, immutable input and exact payload-byte budget. No DB/network/model calls.');
