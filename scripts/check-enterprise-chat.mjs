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
const reject=(mutate,error=/numeric_narrative_not_allowed/)=>{const raw=structuredClone(answer);mutate(raw);assert.throws(()=>validate(raw),error);};
reject(a=>a.claims[0].sourceIds=[list.id]); // 138 is not the cited list price
reject(a=>a.claims[0].text=a.claims[0].text.replace('138元','999元'));
reject(a=>a.claims[0].text='页面展示价168元，标示定价138元。'); // swapped labels, both IDs exist
reject(a=>a.claims[0].sourceIds=['foreign.snapshot'],/invalid_reference/);
reject(a=>a.claims[1].evidenceState='observed');
reject(a=>{delete a.claims[1].pricingSuggestion;a.claims[1].text+='试价128元。';});
reject(a=>a.claims[1].text='当前市场售价128元。');
reject(a=>a.claims[1].pricingSuggestion.assumptions=['市场销量10000件']);
reject(a=>a.claims[1].text+='预计增长30%。');
reject(a=>a.text='快照价138元'); // introduction has no citations
const single=c=>validate({text:'以下仅为快照已保存信息。',claims:[c]});
assert.equal(single({topic:'coverage',text:'已读1个商品页。',sourceIds:[],statIds:['T.readListings']}).claims.length,1);
assert.throws(()=>single({topic:'coverage',text:'已读100个商品页。',sourceIds:[],statIds:['T.readListings']}),/numeric_narrative/);
assert.throws(()=>single({topic:'coverage',text:'市场份额1%。',sourceIds:[],statIds:['T.readListings']}),/numeric_narrative/);
for(const [field,value,quote] of [['book.format','16开','16开'],['book.isbn','9787513364119','9787513364119'],['book.publishedAt','2024-01-02','2024年1月2日']]){
 const o=observation(field);o.value=value;o.status='observed';
 assert.equal(single({topic:'edition',text:'保存的字段为'+quote+'。',sourceIds:[o.id],statIds:[]}).claims.length,1);
}
for(const text of ['展示价¥138元。','展示价138 CNY。','展示价138。'])assert.equal(single({topic:'pricing',text,sourceIds:[display.id],statIds:[]}).claims.length,1);
assert.throws(()=>single({topic:'pricing',text:'展示价138%。',sourceIds:[display.id],statIds:[]}),/numeric_narrative/);
for(const text of ['展示价138 USD。','展示价138美元。','展示价138 EUR。'])assert.throws(()=>single({topic:'pricing',text,sourceIds:[display.id],statIds:[]}),/numeric_narrative/);
assert.equal(single({topic:'pricing',text:'展示价138元，ISBN为9787513364119。',sourceIds:[display.id,observation('book.isbn').id],statIds:[]}).claims.length,1);
const originalPrice=display.value;display.value=138.5;
const decimal={topic:'pricing',text:'展示价为138.50元。',sourceIds:[display.id],statIds:[]};assert.equal(single(decimal).claims.length,1);
assert.throws(()=>single({...decimal,text:'展示价为138.51元。'}),/numeric_narrative/);display.value=originalPrice;
const statPrice={id:'fixture.price.min',value:138,currency:'CNY',listingIds:[product.listingId]};snapshot.statistics.facts.push(statPrice);
assert.equal(single({topic:'pricing',text:'同条件最低展示价为138元。',sourceIds:[],statIds:[statPrice.id]}).claims.length,1);snapshot.statistics.facts.pop();
const unavailable=observation('delivery.shippingFee');assert.equal(unavailable.value,null);
assert.equal(single({evidenceState:'missing',topic:'delivery',text:'运费未确认。',sourceIds:[unavailable.id],statIds:[]}).claims.length,1);
assert.equal(single({topic:'pricing',text:'价格条件需要核实。',sourceIds:[display.id],statIds:[]}).claims.length,1);
const report={sections:[{heading:'定性观察',claims:[{topic:'pricing',text:'售价138元',sourceIds:[display.id],statIds:[]}]}],checks:[]};assert.equal(validateEnterprise(report,snapshot).aiStatus,'unavailable','Report numeric policy unchanged');
const envelope=enterpriseEnvelope(enterpriseConfig(),{question,snapshot},'chat');assert.ok(!JSON.stringify(envelope).includes('numericReferences'));const schema=JSON.parse(envelope.messages[1].content).responseSchema;assert.equal(schema.properties.text,undefined);assert.ok(schema.properties.claims);assert.ok(envelope.messages[0].content.includes('pricingSuggestion'));assert.ok(ENTERPRISE_REPORT_PROMPT.includes('禁止阿拉伯数字'));
console.log('Enterprise DiDi offline passed: correct citations without numericReferences, wrong value/source/unit/price context, date/ISBN/spec/stat, labelled proposed pricing, legacy answers, unchanged report. No model/network/DB.');
