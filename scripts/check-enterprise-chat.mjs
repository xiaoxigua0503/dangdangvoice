// Pure, offline Enterprise DiDi regression fixture. No provider, network or DB.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseProduct} from '../server/enterprise-product.mjs';
import {snapshotDocument,validateEnterprise,enterpriseEnvelope,enterpriseConfig,ENTERPRISE_REPORT_PROMPT} from '../server/enterprise-context.mjs';
const product=parseProduct(await readFile(new URL('../tests/fixtures/enterprise-product.html',import.meta.url),'utf8'),{productId:'30119333'}).data;
export const snapshot=snapshotDocument([{state:'completed',data:product}],{id:'chat-fixture',input_count:1,rejected:[]});
const observation=field=>snapshot.listings[0].observations.find(o=>o.field===field);
const display=observation('price.display'),list=observation('price.list');
export const question='如果我想卖类似产品，应该如何定价';
export const answer={text:'可以参考快照报价，先确认版本、成本与服务条件，再做试价。',claims:[
 {evidenceState:'observed',topic:'pricing',text:'采集时的页面展示价为138元，标示定价为168元，不代表实时成交价。',sourceIds:[display.id,list.id],statIds:[]},
 {evidenceState:'inference',topic:'pricing',text:'定价建议：可先小范围试价，观察需求后调整，不保证成交或收益。',sourceIds:[display.id],statIds:[],pricingSuggestion:{currency:'CNY',amounts:[128],assumptions:['版本、规格与配送服务可比','成本、毛利要求和需求尚未核实，应先核算并小范围验证']}}
]};
const validate=value=>validateEnterprise(value,snapshot,'chat');
assert.deepEqual(validate(answer),answer,'Correct citations need no redundant numericReferences');
const currentAnswer=validate({claims:answer.claims});assert.deepEqual(currentAnswer.claims,answer.claims);assert.equal(currentAnswer.text,'以下分析基于本报告已保存的批次快照，并非实时查询。','New schema has no uncited model introduction; legacy text is never erased');
// Numeric prose is no longer gated; schema and snapshot membership remain enforced.
const revised=structuredClone(answer);revised.claims[0].text='展示价999元，参考增长30%。';revised.claims[1].pricingSuggestion.assumptions=['假设成本100元，尚待验证'];
assert.deepEqual(validate(revised),revised);
const legacy=structuredClone(answer);legacy.text='参考快照中的138元报价。';assert.deepEqual(validate(legacy),legacy);
const foreign=structuredClone(answer);foreign.claims[0].sourceIds=['foreign.snapshot'];assert.throws(()=>validate(foreign),/invalid_reference/);
const foreignStat=structuredClone(answer);foreignStat.claims[0].statIds=['foreign.stat'];assert.throws(()=>validate(foreignStat),/invalid_reference/);
const invalid=structuredClone(answer);invalid.claims[1].pricingSuggestion.assumptions=[];assert.throws(()=>validate(invalid));
const single=c=>validate({text:'以下仅为快照已保存信息。',claims:[c]});
const unavailable=observation('delivery.shippingFee');assert.equal(unavailable.value,null);
assert.equal(single({evidenceState:'missing',topic:'delivery',text:'运费未确认。',sourceIds:[unavailable.id],statIds:[]}).claims.length,1);
assert.equal(single({topic:'pricing',text:'价格条件需要核实。',sourceIds:[display.id],statIds:[]}).claims.length,1);
const report={sections:[{heading:'定性观察',claims:[{topic:'pricing',text:'售价138元',sourceIds:[display.id],statIds:[]}]}],checks:[]};assert.equal(validateEnterprise(report,snapshot).aiStatus,'unavailable','Report numeric policy unchanged');
const envelope=enterpriseEnvelope(enterpriseConfig(),{question,snapshot},'chat');assert.ok(!JSON.stringify(envelope).includes('numericReferences'));const schema=JSON.parse(envelope.messages[1].content).responseSchema;assert.equal(schema.properties.text,undefined);assert.ok(schema.properties.claims);assert.ok(envelope.messages[0].content.includes('pricingSuggestion'));assert.ok(ENTERPRISE_REPORT_PROMPT.includes('禁止阿拉伯数字'));
console.log('Enterprise DiDi fixture: schema/citation membership, labelled pricing assumptions, unrestricted numeric prose, legacy answers and unchanged report policy. No model/network/DB.');
