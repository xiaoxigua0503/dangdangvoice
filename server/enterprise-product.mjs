import {load} from 'cheerio';
import {htmlAccessFailure,classifyHtmlResponse} from './collection-parser.mjs';
const ROUTES=['product-info','score-service','transfer','detail','get-bang-rank','get-promise','spu-prod'].map(x=>'callback/'+x);
export const CALLBACK_STATUS=Object.freeze(Object.fromEntries(['product-info','transfer','score-service','detail','get-bang-rank','get-promise','spu-prod'].map(x=>['callback/'+x,x==='score-service'?'http_verified_not_observed':'verified_schema_not_read'])));
export function cleanText(value,max=4000){let text=String(value??'');if(/<(?:script|style|iframe|form|div|p|span|a|img)(?:\s|>)/i.test(text)){const root=load(text);root('script,style,form,iframe,button,input').remove();text=root.root().text();}return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[联系方式已移除]').replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[联系方式已移除]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/\s+/g,' ').trim().slice(0,max);}
export function safeURL(raw,kind='product'){
 try{const u=new URL(raw.startsWith('//')?'https:'+raw:raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)return null;
  if(kind==='image'?!/(^|\.)ddimg\.cn$/i.test(u.hostname):!/(^|\.)dangdang\.com$/i.test(u.hostname))return null;
  u.protocol='https:';u.hash='';const saved=new URLSearchParams();if(kind==='product')for(const k of ['pid','product_id','productId'])if(/^\d{5,20}$/.test(u.searchParams.get(k)||''))saved.set(k,u.searchParams.get(k));if(kind==='product'&&u.hostname==='product.dangdang.com'&&u.pathname==='/index.php'&&ROUTES.includes(u.searchParams.get('r'))){for(const k of ['r','shopId','ddShopId','isGiftPackaging','isSupportReturnPolicy','categoryPath','isPod','productType','isCatalog','productMedium','templateType','describeMap','warehouseId','stockType','srcWarehouseId','provinceId','cityId','districtId','townId','areaId','isRegionPromo','customAddress','stockStatus','templateId']){const v=u.searchParams.get(k);if(v!==null&&(k==='r'||/^[A-Za-z0-9_.:-]{0,60}$/.test(v)))saved.set(k,v);}}u.search=saved.toString();return u.href;
 }catch{return null;}
}
export function normalizeLinks(text,max=20){
 const lines=text.split(/\r?\n/).map((s,i)=>({s:s.trim(),line:i+1})).filter(x=>x.s);if(!lines.length||lines.length>max)throw new Error('link_count_limit');
 const links=new Map(),rejected=[];
 for(const {s,line} of lines){let u;try{u=new URL(s);}catch{rejected.push({line,code:'invalid_url'});continue;}
  if(!['product.dangdang.com','www.dangdang.com','item.dangdang.com','m.dangdang.com','product.m.dangdang.com'].includes(u.hostname.toLowerCase())||u.username||u.password||u.port||!['http:','https:'].includes(u.protocol)){rejected.push({line,code:'unsupported_host'});continue;}
  const pid=u.pathname.match(/^\/(\d{5,20})\.html$/)?.[1]||(/\/product\.php$/i.test(u.pathname)?u.searchParams.get('pid')||u.searchParams.get('product_id'):null);
  if(!/^\d{5,20}$/.test(pid||'')){rejected.push({line,code:'invalid_product_id'});continue;}
  const link=links.get(pid)||{productId:pid,url:`https://product.dangdang.com/${pid}.html`,inputs:[]};link.inputs.push({line,url:safeURL(s)});links.set(pid,link);
 }
 return {inputCount:lines.length,links:[...links.values()],rejected};
}
// Restricted literal parser: strings/numbers/arrays/objects only. No eval, VM,
// expression evaluation, identifiers as values, functions, getters or assignments.
export function parseLiteral(source){
 let p=0,nodes=0;const ws=()=>{while(/\s/.test(source[p]||'')&&p<source.length)p++;};
 const string=()=>{const quote=source[p++];let out='';while(p<source.length){let c=source[p++];if(c===quote)return out;if(c==='\\'){c=source[p++];if(c==='u'){const h=source.slice(p,p+4);if(!/^[a-f0-9]{4}$/i.test(h))throw 0;out+=String.fromCharCode(parseInt(h,16));p+=4;}else if(c==='x'){const h=source.slice(p,p+2);if(!/^[a-f0-9]{2}$/i.test(h))throw 0;out+=String.fromCharCode(parseInt(h,16));p+=2;}else out+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[c]??c);}else out+=c;}throw 0;};
 const value=depth=>{ws();if(++nodes>10000||depth>12)throw 0;const c=source[p];if(c==='"'||c==="'")return string();
  if(c==='{'||c==='['){const obj=c==='{',out=obj?Object.create(null):[];p++;ws();if(source[p]===(obj?'}':']')){p++;return out;}while(p<source.length){let key;if(obj){ws();if(['"',"'"].includes(source[p]))key=string();else{const m=source.slice(p).match(/^[A-Za-z_$][\w$]*/);if(!m)throw 0;key=m[0];p+=key.length;}if(['__proto__','prototype','constructor'].includes(key))throw 0;ws();if(source[p++]!==':')throw 0;out[key]=value(depth+1);}else out.push(value(depth+1));ws();const end=source[p++];if(end===(obj?'}':']'))return out;if(end!==',')throw 0;ws();if(source[p]===(obj?'}':']')){p++;return out;}}throw 0;}
  const m=source.slice(p).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w$.])/);if(!m)throw 0;p+=m[0].length;const parsed=JSON.parse(m[0]);return typeof parsed==='number'&&Number.isInteger(parsed)&&!Number.isSafeInteger(parsed)?m[0]:parsed;};
 try{const data=value(0);ws();if(source[p]&&source[p]!==';')return null;return data;}catch{return null;}
}
export function parseProduct(html,{productId,url=`https://product.dangdang.com/${productId}.html`,collectedAt=new Date().toISOString(),observedRequests=[],sourceResponses=[],rendered=false,expectedRoutes=[],initialData=null}={}){
 const failure=htmlAccessFailure(html);if(failure)return {ok:false,outcome:failure.outcome,error:failure.code};
 // Observed public product response: an inert hidden textarea carries challenge
 // data beside an obfuscated Aliyun script. Do not read/store its token payload.
 const shell=load(html),hiddenData=shell('textarea#renderData[style]').filter((_,el)=>/display\s*:\s*none/i.test(shell(el).attr('style')||'')).length>0;
 // Observed Aliyun denial template: title 405, hidden renderData and a script
 // containing the specific denial wording. Inspect only; never execute the script.
 const denialScript=shell('script:not([src])').toArray().map(el=>shell(el).text()).join('\n');
 if(shell('title').text().trim()==='405'&&hiddenData&&!shell('.name_info h1,#product_info,#product_main,.comment_items,.describe_detail,.describe_long').length&&/aliyun/i.test(denialScript)&&/your request has been blocked as it may cause potential threats to the server.s security/i.test(denialScript))return {ok:false,outcome:'blocked',error:'access_denied',recognitionRule:'aliyun_405_access_denied_shell'};
 const rules=classifyHtmlResponse(html).rules;
 const visible=shell.root().clone();visible.find('script,style').remove();visible.find('textarea[style]').filter((_,el)=>/display\s*:\s*none/i.test(shell(el).attr('style')||'')).remove();
 if(hiddenData&&!shell('.name_info h1,#product_info,#product_main,.comment_items').length&&!visible.text().trim()&&rules.inlineDominant&&rules.wafMarker&&rules.substantialScript&&rules.runtimeAccess)return {ok:false,outcome:'challenge_detected',error:'challenge_detected',recognitionRule:'hidden_render_data_aliyun_script'};
 const $=load(html);if(/GeoBL|地区.*(?:无法|不支持).*访问/i.test($('title').text()))return {ok:false,outcome:'blocked',error:'region_restricted'};
 const listingId='L'+productId,observations=[],truncations=[],data={listingId,url,collectedAt,product:{productId:null,mainProductId:null,title:null,subtitle:null,categoryId:null,categoryPath:null,breadcrumb:null,brand:null,model:null,barcode:null,specifications:null,variants:null,children:null},book:{isbn:null,author:null,translator:null,publisher:null,publishedAt:null,edition:null,binding:null,format:null,paper:null,combo:null,gifts:null,description:null,toc:null,sellingPoints:null},shop:{shopId:null,ddShopId:null,supId:null,shopType:null,name:null,url:null,selfOperatedLabel:null,seller:null,fulfillment:null,afterSales:null,services:null},price:{display:null,list:null,displayLabel:null,listLabel:null,currency:null,variantPrices:null,memberPrice:null,conditional:null,couponOffers:null},promotions:null,delivery:{region:null,origin:null,stockStatus:null,warehouseReferenced:null,shippingFee:null,shippingPolicy:null,orderDeadline:null,expectedArrival:null,deliveryTime:null,promiseText:null,giftWrap:null,returns:null},ratings:{count:null,score:null,rank:null},officialImages:{cover:null,gallery:null,description:null},other_sellers_count:null,other_seller_offers:null,recommendations:null,advertisements:null,categoryRankings:null,extra_metadata:[],observations,truncations,callbackStatus:CALLBACK_STATUS};
 const set=(field,value,raw,layer='DOM',sourceUrl=url,sourcePath=null)=>{
  if(value===undefined||value===null||value==='')return;
  const sanitize=v=>typeof v==='string'?cleanText(v):Array.isArray(v)?v.map(sanitize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/token|cookie|tracking|user|account|session|password|fingerprint|phone|email/i.test(k)).map(([k,x])=>[cleanText(k,100),sanitize(x)])):v;
  const normalized=sanitize(value),rawText=typeof raw==='object'?JSON.stringify(sanitize(raw)):String(raw??value);if(rawText.length>4000)truncations.push({field,originalCharacters:rawText.length,keptCharacters:4000});
  observations.push({id:listingId+'.F'+observations.length,listingId,listingUrl:url,field,value:normalized,raw:cleanText(rawText),sourcePath,sourceUrl:safeURL(sourceUrl)||url,layer,collectedAt,region:null,status:'observed'});
  const keys=field.split('.');let target=data;for(const key of keys.slice(0,-1))target=target[key];if(target[keys.at(-1)]===null)target[keys.at(-1)]=normalized;
 };
 const extra=(key,value,layer,sourcePath=null)=>{const k=cleanText(key,100),v=typeof value==='string'?cleanText(value):value;if(/token|cookie|track|user|account|session|secret|password|phone|email|review|comment/i.test(k)||typeof v==='string'&&/\{\{|<%|\$\{/.test(v))return;const id=listingId+'.F'+observations.length;if(typeof value==='string'&&value.length>4000)truncations.push({field:'extra_metadata.'+k,originalCharacters:value.length,keptCharacters:4000});data.extra_metadata.push({id,key:k,value:v,sourceUrl:url,layer,collectedAt,meaningStatus:'field_name_only_unverified'});observations.push({id,listingId,listingUrl:url,field:'extra_metadata.'+k,value:v,raw:cleanText(typeof v==='object'?JSON.stringify(v):v),sourcePath,sourceUrl:url,layer,collectedAt,region:null,status:'observed_meaning_unverified'});};
 const plain=element=>{const node=element.clone();node.find('script,style,form,button,input,iframe,.login,.comment_items,.describe_detail,.describe_long').remove();return node.text().replace(/\s+/g,' ').trim();};
 const text=selector=>plain($(selector).first());
 const number=raw=>{const m=String(raw??'').replace(/,/g,'').trim().match(/^(?:¥|￥|RMB)?\s*(\d+(?:\.\d+)?)\s*(?:元)?$/i);const value=m?Number(m[1]):NaN;return Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER?value:null;};
 set('product.title',text('.name_info h1')||$('meta[property="og:title"]').attr('content')||$('title').text().replace(/\s*[-–].*当当.*$/,''),undefined,'DOM',url,'.name_info h1 / og:title / title');set('product.subtitle',text('.name_info .head_title_name')||text('.name_info h2'),undefined,'DOM',url,'.name_info .head_title_name / h2');
 const categoryPaths=$('#detail-category-path .lie').toArray().map(el=>$(el).find('a').toArray().map(a=>plain($(a))).filter(Boolean).join(' > ')).filter(Boolean);const breadcrumb=categoryPaths.length?[...new Set(categoryPaths)].join(' / '):(text('#detail-category-path')||text('.breadcrumb,.breadcrumb-link')).replace(/^所属分类\s*[:：]\s*/,'').replace(/\s*>\s*/g,' > ').replace(/^(?:\s*>)+|(?:>\s*)+$/g,'').trim();set('product.breadcrumb',breadcrumb,text('#detail-category-path')||text('.breadcrumb,.breadcrumb-link'),'DOM',url,$('#detail-category-path').length?'#detail-category-path .lie a':'.breadcrumb');set('price.display',number(text('#dd-price')),text('#dd-price'),'DOM',url,'#dd-price');set('price.list',number(text('#original-price')),text('#original-price'),'DOM',url,'#original-price');
 const priceLabel=text('#dd-price-text')||text('.price .price_name,.price_info .price_name,.price_d .price_name');if(priceLabel)set('price.displayLabel',priceLabel);const originalLabel=text('#original-price-text')||text('.price_m .price_name,.original-price-label');if(originalLabel)set('price.listLabel',originalLabel);
 if(/[¥￥]/.test(text('#dd-price')+text('#original-price')))set('price.currency','CNY','¥');
 for(const [field,selector] of [['price.display','#dd-price'],['price.list','#original-price']]){const raw=text(selector);if(raw&&number(raw)===null)observations.push({id:listingId+'.F'+observations.length,listingId,listingUrl:url,field,value:null,raw:cleanText(raw),sourceUrl:url,layer:'DOM',collectedAt,region:null,status:'observed_unparsed'});}
 const shop=$('#service-more .title a[href*="shop.dangdang.com/"],#service-more .title a[href*="store.dangdang.com/"],#product_info a[href*="store.dangdang.com/"],#product_main a[href*="store.dangdang.com/"],.shop_info a[href*="store.dangdang.com/"],.mall_shop a[href*="store.dangdang.com/"]').filter((_,el)=>!$(el).closest('#sellers_list,script,template,.recommend,.advertisement').length).filter((_,el)=>!!plain($(el))).first();if(shop.length){set('shop.name',plain(shop),undefined,'DOM',url,'#service-more .title a / shop anchor');set('shop.url',safeURL(shop.attr('href')||''),undefined,'DOM',url,'shop anchor[href]');if(/自营/.test(plain(shop)))set('shop.selfOperatedLabel','自营',plain(shop));}
 const specs={},specEntries=[];$('#detail_describe li,.key li,.product_information li').each((_,el)=>{const t=plain($(el)),m=t.match(/^([^:：]{1,60})[:：]\s*([\s\S]+)$/);if(m){const key=m[1].replace(/\s+/g,''),value=m[2].trim(),node=$(el),parent=node.parent();const root=node.closest('#detail_describe').length?'#detail_describe':node.closest('.product_information').length?'.product_information':'.key';const sourcePath=root+' li:nth-child('+(parent.children().index(el)+1)+') / '+key;specEntries.push({key,value,sourcePath});if(!(key in specs))specs[key]=value;}});
 const specMap={ISBN:'book.isbn','国际标准书号ISBN':'book.isbn','作者':'book.author','译者':'book.translator','出版社':'book.publisher','出版时间':'book.publishedAt','版次':'book.edition','印次':'book.edition','包装':'book.binding','是否套装':'book.combo','装帧':'book.binding','开本':'book.format','纸张':'book.paper','品牌':'product.brand','型号':'product.model','条码':'product.barcode','规格':'product.variants','版本':'book.edition','套装':'book.combo','赠品':'book.gifts'};
 const publicSpecs=Object.fromEntries(Object.entries(specs).filter(([key])=>key!=='所属分类'&&!/联系人|电话|邮箱|账户|token|cookie|session/i.test(key)));if(Object.keys(publicSpecs).length)set('product.specifications',publicSpecs,publicSpecs,'DOM',url,'#detail_describe li');
 for(const {key,value,sourcePath} of specEntries){if(specMap[key])set(specMap[key],value,value,'DOM',url,sourcePath);else extra(key,value,'DOM',sourcePath);}
 const titleObservation=observations.find(o=>o.field==='product.title'),title=data.product.title||'';
 const titleLabels=[...new Set(title.match(/当当专享特装版|(?:增订|修订|特装|精装|平装)版/g)||[])];
 if(titleLabels.length&&data.book.edition===null&&!$('[data-edition]').first().attr('data-edition')){set('book.edition',titleLabels.join(' / '),title,'title',url,'product.title');observations.at(-1).derivedFrom=[titleObservation.id];}
 if(title.includes('当当自营')&&data.shop.selfOperatedLabel===null){set('shop.selfOperatedLabel','当当自营',title,'title',url,'product.title');observations.at(-1).derivedFrom=[titleObservation.id];}
 const aggregateCount=text('#comm_num_down');if(/^\d[\d,]*$/.test(aggregateCount))set('ratings.count',Number(aggregateCount.replace(/,/g,'')),aggregateCount,'DOM',url,'#comm_num_down');
 const byline=text('.messbox_info #author').replace(/^作者\s*[:：]\s*/,'');
 if(byline){const roles=byline.match(/^(.*?)\s*著[；;，,\s]*(.*?)\s*译$/);set('book.author',roles?roles[1]:byline,byline,'DOM',url,'.messbox_info #author');if(roles&&roles[2])set('book.translator',roles[2].replace(/^[；;，,\s]+|[；;，,\s]+$/g,''),byline,'DOM',url,'.messbox_info #author');}
 $('.messbox_info > .t1').each((_,el)=>{const raw=plain($(el));for(const [prefix,field] of [['出版社','book.publisher'],['出版时间','book.publishedAt']]){const match=raw.match(new RegExp('^'+prefix+'\\s*[:：]\\s*(.+)$'));if(match)set(field,match[1],raw,'DOM',url,'.messbox_info > .t1');}});
 // These sections contain the listing's content, not the recommendation rail in #detail.
 // The same DOM stores the complete expanded text as inert textarea HTML.
 const sectionText=selector=>{const node=$(selector).first(),stored=node.find('textarea').first().text();const full=stored?load(stored).root():node;const copy=full.clone();copy.find('script,style,form,input,iframe,textarea,button,.section_show_more').remove();copy.find('br').replaceWith(' ');copy.find('p,li').append(' ');return copy.text().replace(/\s+/g,' ').trim();};
 for(const [field,selector]of [['book.description','#content .descrip'],['book.toc','#catalog .descrip'],['book.sellingPoints','#abstract .descrip']]){const value=sectionText(selector);if(value)set(field,value,value,'DOM',url,selector+($(selector).find('textarea').length?' / textarea (完整展开内容)':''));}
 if(data.book.description===null)set('book.description',text('#product_description'),undefined,'DOM',url,'#product_description');
 if(data.book.toc===null)set('book.toc',text('#table_of_contents'),undefined,'DOM',url,'#table_of_contents');
 if(data.book.sellingPoints===null)set('book.sellingPoints',text('#selling_points'),undefined,'DOM',url,'#selling_points');
 const officialImage=raw=>{const u=safeURL(raw,'image');return u&&!/reviewimg|\/Community[^/]*\//i.test(u)?u:null;};
 const imageURLs=selector=>[...new Set($(selector).toArray().filter(el=>!$(el).closest('.comment_items,.describe_detail,.describe_long,#comment').length).map(el=>officialImage($(el).attr('data-original')||$(el).attr('data-src')||$(el).attr('src')||'')).filter(Boolean))];
 const cover=officialImage($('meta[property="og:image"]').attr('content')||$('#largePic').attr('src')||'');set('officialImages.cover',cover,undefined,'DOM',url,'og:image / #largePic[src]');for(const [field,sel] of [['gallery','#main-img-slider img,#product_gallery img'],['description','#product_description img,#content .descrip img']]){const urls=imageURLs(sel);if(urls.length>30)truncations.push({field:'officialImages.'+field,originalItems:urls.length,keptItems:30});if(urls.length)set('officialImages.'+field,urls.slice(0,30),undefined,'DOM',url,sel);}
 // Rendered purchase area: keep the visible destination and all fee/time conditions.
 const regionLabel=text('#geo-name'),domRegion=regionLabel?{label:regionLabel,kind:'页面当前选择地区（非用户完整地址）'}:null;
 const domSet=(field,value,raw,path)=>{if(value==null||value==='')return;set(field,value,raw,'DOM',url,path);observations.at(-1).region=regionLabel||null;};
 if(rendered){
  domSet('delivery.region',domRegion,regionLabel,'#geo-name');
  const origin=text('#shop-geo-name');if(origin)domSet('delivery.origin',origin.replace(/\s*至\s*$/,'').trim(),origin,'#shop-geo-name');
  domSet('delivery.stockStatus',text('#geo-info .select_add > b'),undefined,'#geo-info .select_add > b');
  const feeSelector=$('#slef-shipping-fee').length?'#slef-shipping-fee':'#geo-info #freight',fee=text(feeSelector);
  if(fee){
   // A displayed base charge/threshold is not a calculated checkout charge.
   const base=fee.match(/运费\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*元/),threshold=fee.match(/满\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*元\s*(?:包邮|免(?:运)?费)/);
   const free=/^(?:免运费|包邮)$/.test(fee);
   domSet('delivery.shippingFee',fee,fee,feeSelector);
   domSet('delivery.shippingPolicy',{label:fee,baseFee:base?Number(base[1]):free?0:null,freeShippingThreshold:threshold?Number(threshold[1]):null,currency:'CNY',region:regionLabel||null,scope:'页面运费标示，保留门槛及地区；未计算结算运费'},fee,feeSelector);
  }
  // Observed shared choice rows: labels come from the row, options from title/text.
  // 'disabled' is a DOM choice state, never decoded into stock or SKU identity.
  const variantGroups=[];$('.show_info .choose_xilie,.choose_xilie').each((_,el)=>{const node=$(el);if(node.closest('script,template,.recommend,#sellers_list').length)return;const label=plain(node.children('.left').first());if(!label)return;const all=node.find('.right .jia_gou_e').toArray(),options=all.slice(0,30).map(a=>{const choice=$(a),label=cleanText(choice.attr('title')||plain(choice),160);return{label,selected:choice.hasClass('chosen'),disabled:choice.hasClass('disabled'),imageUrl:officialImage(choice.find('img').first().attr('src')||'')};}).filter(o=>o.label);if(options.length)variantGroups.push({label,options});if(all.length>30)truncations.push({field:'product.variants.'+label,originalItems:all.length,keptItems:30});});
  if(variantGroups.length){domSet('product.variants',variantGroups.slice(0,6),variantGroups.slice(0,6),'.choose_xilie > .left / .right .jia_gou_e[title]');if(variantGroups.length>6)truncations.push({field:'product.variants',originalItems:variantGroups.length,keptItems:6});}
  const couponLabels=$('#coupon-list li a').toArray().map(a=>plain($(a))).filter(Boolean);if(couponLabels.length)domSet('price.couponOffers',couponLabels.slice(0,20).map(label=>({label,conditions:null,scope:'页面领券标示；领取资格及完整使用条件未核实，未扣减展示价'})),couponLabels.slice(0,20),'#coupon-list li a');if(couponLabels.length>20)truncations.push({field:'price.couponOffers',originalItems:couponLabels.length,keptItems:20});
  const arrive=text('#arrive-time');
  domSet('delivery.deliveryTime',arrive,arrive,'#arrive-time');
  domSet('delivery.expectedArrival',text('#arrive-time > b'),arrive,'#arrive-time > b');
  const deadline=arrive.match(/^(.+?)前完成下单/);if(deadline)domSet('delivery.orderDeadline',deadline[1]+'前完成下单',arrive,'#arrive-time');
  const supplier=$('#arrive-time').parent('.time').clone();supplier.find('#arrive-time').remove();const supply=plain(supplier),party=supply.match(/^由[“「"']?(.+?)[”」"']?发货[，,]\s*并提供售后服务[。.]?$/);
  if(party){const name=party[1].trim();domSet('shop.fulfillment',name,supply,'#arrive-time / parent .time（不含预计送达）');domSet('shop.afterSales',name,supply,'#arrive-time / parent .time（不含预计送达）');}
  const selfLabel=text('#service-more .title .shop-name');if(selfLabel.includes('当当自营'))set('shop.selfOperatedLabel',selfLabel,selfLabel,'DOM',url,'#service-more .title .shop-name');
  for(const [field,selector]of [['delivery.giftWrap','#shop-service li.lpbz'],['delivery.returns','#shop-service li.zcth,#shop-service li.hh'],['shop.services','#shop-service li.cjfh,#shop-service li.zpbz,#shop-service li.fwzc']]){const value=$(selector).toArray().map(el=>plain($(el))).filter(Boolean).join('；');domSet(field,value,value,selector);}
 }
 const promos=[];$('[data-promoid][data-promotype]').each((_,el)=>{if($(el).closest('script,template,.comment_items').length)return;const id=$(el).attr('data-promoid'),type=$(el).attr('data-promotype');if(/^\d{1,20}$/.test(id||'')&&/^\d{1,10}$/.test(type||'')){const node=$(el),raw=plain(node),dates=raw.match(/时间[：:]\s*(\d{4}[.\/-]\d{2}[.\/-]\d{2} \d{2}:\d{2}:\d{2})\s*[-–至]\s*(\d{4}[.\/-]\d{2}[.\/-]\d{2} \d{2}:\d{2}:\d{2})/);promos.push({id,type,label:cleanText(plain(node.children('b').first())||raw,300),conditions:cleanText(plain(node.find('.rule').first()),1000)||null,url:safeURL(node.is('a')?node.attr('href')||'':node.find('a').first().attr('href')||''),startsAt:dates?.[1]||null,endsAt:dates?.[2]||null,threshold:null,audience:null,stacking:null});}});if(promos.length)set('promotions',promos,promos,'DOM',url,'[data-promoid][data-promotype] / b,.rule');
 let embedded=null;$('script').each((_,el)=>{const script=$(el).text();if(script.length>300000)return;const match=script.match(/\b(?:var\s+|let\s+|const\s+)?prodSpuInfo\s*=\s*/);if(match){const candidate=parseLiteral(script.slice(match.index+match[0].length));if(candidate&&typeof candidate==='object')embedded=candidate;}});
 if(!embedded)$('script[type="application/json"]').each((_,el)=>{try{const d=JSON.parse($(el).text());if(d?.prodSpuInfo&&typeof d.prodSpuInfo==='object')embedded=d.prodSpuInfo;}catch{}});
 for(const el of $('#product_info,#product_main').toArray()){for(const [attr,field] of Object.entries({'data-product-id':'product.productId','data-main-product-id':'product.mainProductId','data-shop-id':'shop.shopId','data-dd-shop-id':'shop.ddShopId','data-category-id':'product.categoryId'})){const value=$(el).attr(attr);if(/^\d{1,20}$/.test(value||'')){if(field==='product.productId'&&value!==String(productId))return {ok:false,outcome:'parse_error',error:'product_identity_mismatch'};set(field,value,value,'DOM_attribute');}}}
 if(embedded){if(embedded.productId!=null&&String(embedded.productId)!==String(productId))return {ok:false,outcome:'parse_error',error:'product_identity_mismatch'};
  const mappings={productId:'product.productId',mainProductId:'product.mainProductId',categoryId:'product.categoryId',categoryPath:'product.categoryPath',shopId:'shop.shopId',ddShopId:'shop.ddShopId',supId:'shop.supId',shopType:'shop.shopType'};
  for(const [key,field] of Object.entries(mappings)){const v=embedded[key];if(key==='categoryPath'?typeof v==='string'&&/^[0-9.]+$/.test(v):['number','string'].includes(typeof v)&&/^\d{1,20}$/.test(String(v)))set(field,v,v,'embedded_script',url,'prodSpuInfo.'+key);}
  for(const [key,value] of Object.entries(embedded))if(!mappings[key]&&(/^(?:product|mainProduct|category|brand|model|barcode|isbn|sku|spu|sale|price|shop|sup|edition|publish|author|size|color|stock|warehouse)/i.test(key)||['isGiftPackaging','isSupportReturnPolicy','isSoldOut','displayStatus','pathName'].includes(key))&&!/token|cookie|user|account|track|session|secret|password|phone|email/i.test(key)&&['string','number','boolean'].includes(typeof value))extra(key,value,'embedded_script');
 }
 // Parse only responses actually observed for this document's product/shop.
 data.callbackStatus={...CALLBACK_STATUS};data.sourceStatus=[];data.fieldStatus={};
 const sourceFields={
  'callback/product-info':['price.display','price.list','price.memberPrice','price.conditional','promotions','delivery.stockStatus'],
  'callback/score-service':['delivery.giftWrap','delivery.returns','shop.services'],
  'callback/detail':['book.description','book.sellingPoints','book.toc','officialImages.description'],
  'callback/transfer':['delivery.region','delivery.warehouseReferenced'],
  'callback/get-promise':['delivery.deliveryTime','delivery.shippingFee','shop.seller','shop.fulfillment','shop.afterSales'],
  'callback/spu-prod':['product.variants'], 'callback/get-bang-rank':['ratings.rank']
 };
 const record=(field,value,response,path,{replace=false,region=null}={})=>{if(value==null||value==='')return;set(field,value,value,'response',response.url,path);const o=observations.at(-1);o.collectedAt=response.collectedAt||collectedAt;o.region=region;if(replace){const keys=field.split('.');let target=data;for(const k of keys.slice(0,-1))target=target[k];target[keys.at(-1)]=o.value;}};
 const responseExtra=(key,value,response,path)=>{const id=listingId+'.F'+observations.length;const safe=JSON.parse(JSON.stringify(value));data.extra_metadata.push({id,key,value:safe,sourceUrl:safeURL(response.url),layer:'response',collectedAt:response.collectedAt||collectedAt,meaningStatus:'raw_business_fields_not_decoded'});observations.push({id,listingId,listingUrl:url,field:'extra_metadata.'+key,value:safe,raw:cleanText(JSON.stringify(safe)),sourcePath:path,sourceUrl:safeURL(response.url),layer:'response',collectedAt:response.collectedAt||collectedAt,region:null,status:'observed_meaning_unverified'});};
 const inertText=(root,selector)=>{const n=root(selector).first().clone();n.find('script,style,form,input,iframe,button,textarea').remove();return n.text().replace(/\s+/g,' ').trim();};
 for(const response of sourceResponses){
  let u;try{u=new URL(response.url);}catch{continue;}
  const route=u.searchParams.get('r');
  if(u.origin!=='https://product.dangdang.com'||u.pathname!=='/index.php'||!ROUTES.includes(route)||u.searchParams.get('productId')!==String(productId))continue;
  if(u.searchParams.has('shopId')&&u.searchParams.get('shopId')!==String(data.shop.shopId)||u.searchParams.has('ddShopId')&&u.searchParams.get('ddShopId')!==String(data.shop.ddShopId))continue;
  if(response.body?.productId!=null&&String(response.body.productId)!==String(productId)||response.body?.data?.productId!=null&&String(response.body.data.productId)!==String(productId))continue;
  const body=response.body?.data;let valid=false;
  if(response.status==='observed'){
   if(route==='callback/product-info'&&body?.spu?.price&&typeof body.spu.price==='object'){
    valid=true;const price=body.spu.price;
    for(const [key,field]of [['salePrice','price.display'],['originalPrice','price.list']]){const n=number(price[key]);if(n!==null)record(field,n,response,'data.spu.price.'+key,{replace:true});}
    const promotions=body.spu.promotion;
    if(Array.isArray(promotions)&&!promotions.length)record('promotions',[],response,'data.spu.promotion',{replace:true});
    else if(promotions&&typeof promotions==='object'&&!Array.isArray(promotions)){
     const records=[];
     for(const [key,p]of Object.entries(promotions).slice(0,20)){if(!/^p[0-9]+$/.test(key)||!/^\d{1,20}$/.test(String(p?.promoId||'')))continue;
      const decode=v=>cleanText(load('<body>'+String(v||'')+'</body>')('body').text(),1000);
      const gifts=Array.isArray(p.gifts)?p.gifts.slice(0,10).map(g=>({productId:/^\d{5,20}$/.test(g.productId||'')?g.productId:null,title:cleanText(g.title,500),exchangePrice:number(g.exchangePrice),originalPrice:number(g.originalPrice),image:officialImage(g.image||'')})):null;
      records.push({id:String(p.promoId),type:key.slice(1),label:decode(p.activity_tag||p.title||response.body.data.attachInfo?.iconTable?.[key]?.title),conditions:decode(p.text)||null,url:safeURL(p.activityUrl||''),startsAt:cleanText(p.startTimeStr||'',100)||null,endsAt:cleanText(p.endTimeStr||'',100)||null,threshold:null,audience:null,stacking:null,conditionalPrice:number(p.price?.directPrice),gifts});
     }
     if(records.length){record('promotions',records,response,'data.spu.promotion',{replace:true});const conditional=records.filter(p=>p.conditionalPrice!==null).map(p=>({promotionId:p.id,price:p.conditionalPrice,label:p.label,conditions:p.conditions,startsAt:p.startsAt,endsAt:p.endsAt}));if(conditional.length)record('price.conditional',conditional,response,'data.spu.promotion.*.price.directPrice',{replace:true});}
    }
    // No unverified decoding of membership levels or stock codes into a retail claim.
    if(price.vipPrice&&typeof price.vipPrice==='object'){const tiers=Object.fromEntries(['p1','p2','p3'].filter(k=>number(price.vipPrice[k])!==null).map(k=>[k,number(price.vipPrice[k])]));if(Object.keys(tiers).length)responseExtra('publicMembershipPriceTiers',{tiers,isVipPrice:cleanText(price.isVipPrice,20),meaning:'公开原值；等级与适用条件未确认，未作为会员成交价'},response,'data.spu.price.vipPrice');}
    if(body.spu.stock&&typeof body.spu.stock.stockStatus==='string'){responseExtra('publicStockCodes',{code:cleanText(body.spu.stock.stockStatus,30),type:cleanText(body.spu.stock.stockType,100),meaning:'未解码为可售状态或库存数量'},response,'data.spu.stock');if(data.delivery.stockStatus===null)data.fieldStatus['delivery.stockStatus']={status:'temporarily_unread',reason:'stock_code_meaning_not_confirmed',route};}

   }else if(route==='callback/score-service'&&typeof body?.shopService==='string'){
    valid=true;const service=load(body.shopService);service('script,style,form,input,textarea,iframe').remove();
    for(const [field,selector]of [['delivery.giftWrap','li.lpbz'],['delivery.returns','li.zcth,li.hh'],['shop.services','li.cjfh,li.zpbz,li.fwzc']]){
     const value=service(selector).toArray().map(el=>cleanText(service(el).text())).filter(Boolean).join('；');record(field,value,response,'data.shopService / '+selector);
    }
   }else if(route==='callback/detail'&&typeof body?.html==='string'){
    const detail=load(body.html);valid=!!detail('#content,#abstract,#catalog,#feature').length||body.html==='';
    for(const [field,selector]of [['book.description','#content .descrip'],['book.sellingPoints','#abstract .descrip'],['book.toc','#catalog .descrip']]){
     const n=detail(selector).first(),stored=n.find('textarea').first().text();const value=stored?inertText(load(stored),'body'):inertText(detail,selector);record(field,value,response,'data.html / '+selector);
    }
    const images=[...new Set(detail('#feature .descrip img,#content .descrip img,#attachImage .descrip img').toArray().map(el=>officialImage(detail(el).attr('data-original')||detail(el).attr('src')||'')).filter(Boolean))];if(images.length)record('officialImages.description',images.slice(0,30),response,'data.html / #feature,#content,#attachImage img');
   }else if(route==='callback/transfer'&&body&&typeof body==='object'&&body.address){
    const pieces=['province','city','district','town'].map(k=>body.address[k]).filter(x=>x&&typeof x.name==='string'&&/^\d+$/.test(String(x.id)));
    valid=pieces.length>0;if(valid){const region=pieces.map(x=>cleanText(x.name,100)).join(' / ');record('delivery.region',{label:region,kind:'页面默认地区（未指定用户地址）',areas:pieces.map(x=>({id:String(x.id),name:cleanText(x.name,100)}))},response,'data.address',{region});if(/^\d+$/.test(String(body.wareHouseId)))record('delivery.warehouseReferenced',Number(body.wareHouseId),response,'data.wareHouseId',{region});}
   }else if(route==='callback/get-promise'&&typeof body==='string'){
    valid=true;const promise=load(body);promise('script,style,form,input,textarea,iframe').remove();const text=cleanText(promise.text(),2000);
    // Preserve the published wording, not a guessed numeric shipping fee or ETA.
    if(text)record('delivery.promiseText',text,response,'data (published delivery wording)',{region:['provinceId','cityId','districtId','townId'].map(k=>u.searchParams.get(k)).filter(Boolean).join('/')||null});
   }else if(route==='callback/spu-prod'&&body===''){valid=true;}
   else if(route==='callback/get-bang-rank'&&body&&typeof body==='object'&&/^\d+$/.test(String(body.rank))&&typeof body.pathName==='string'){
    valid=true;record('ratings.rank',{rank:Number(body.rank),category:cleanText(body.pathName,100),url:safeURL(body.url||''),scope:'页面公布的类目榜单，非销量或市场份额'},response,'data.rank / data.pathName');
   }
  }
  const state=valid?'observed':response.status==='observed'?'unsupported_response':response.status;
  data.callbackStatus[route]=state;data.sourceStatus.push({route,status:state,sourceUrl:safeURL(response.url),collectedAt:response.collectedAt||collectedAt,httpStatus:response.httpStatus??null,contentType:response.contentType||null,responseBytes:response.responseBytes??null,responseKind:response.responseKind||null,parserDiagnostic:response.parserDiagnostic||null});
 }
 for(const route of expectedRoutes){if(!ROUTES.includes(route))continue;if(!data.sourceStatus.some(x=>x.route===route))data.sourceStatus.push({route,status:'temporarily_unread',sourceUrl:url,collectedAt});}
 const latestSources=[...new Map(data.sourceStatus.map(source=>[source.route,source])).values()];for(const source of latestSources)if(source.status!=='observed')for(const field of sourceFields[source.route]||[]){const present=rendered&&observations.some(o=>o.field===field&&o.layer==='DOM'&&o.value!==null);if(!present)data.fieldStatus[field]={status:'temporarily_unread',reason:source.status,route:source.route};}
 if(rendered){for(const [field,selector]of [['delivery.region','#geo-name'],['delivery.stockStatus','#geo-info .select_add > b'],['delivery.shippingPolicy','#slef-shipping-fee']]){const container=field==='delivery.stockStatus'?$('#geo-info .select_add'):$(selector);if(container.length&&!text(selector))data.fieldStatus[field]={status:'temporarily_unread',reason:'rendered_dom_incomplete',route:'rendered_dom'};}}
 // An initial placeholder price is not a confirmed dynamically displayed sale price.
 if(data.fieldStatus['price.display']){for(const o of observations)if(o.field==='price.display'&&o.layer==='DOM')o.layer='initial_document';data.price.display=null;}
 // Retain the original Document price as a separate observation when rendering changes it.
 if(initialData)for(const field of ['price.display','price.list']){const old=initialData.observations.find(o=>o.field===field&&o.status==='observed');if(old&&old.value!==data.price[field.split('.')[1]])observations.push({...old,id:listingId+'.F'+observations.length,layer:'initial_document',sourcePath:old.sourcePath||field});}
 data.collectionCoverage={rendered,partial:latestSources.some(x=>x.status!=='observed')||Object.values(data.fieldStatus).some(x=>x.status==='temporarily_unread'),unreadSources:latestSources.filter(x=>x.status!=='observed').map(x=>({route:x.route,status:x.status}))};
 // Request parameters are context only, never a response extractor or stock count.
 for(const request of observedRequests){try{const u=new URL(request.url);if(u.protocol!=='https:'||!/(^|\.)dangdang\.com$/.test(u.hostname)||!u.pathname.endsWith('/callback/get-promise'))continue;const w=u.searchParams.get('warehouseId');if(/^\d{1,10}$/.test(w||''))set('delivery.warehouseReferenced',Number(w),w,'observed_request',request.url);}catch{}}
 const fields={'book.edition':'[data-edition]','product.variants':'#product_spec .selected','shop.seller':'#seller_name','shop.fulfillment':'#shipping_seller','shop.afterSales':'#after_sales_seller','delivery.region':'#delivery_area','delivery.stockStatus':'#stock_status','delivery.shippingFee':'#shipping_fee','delivery.deliveryTime':'#delivery_time','delivery.giftWrap':'#gift_wrap','delivery.returns':'#return_policy'};
 for(const [field,selector] of Object.entries(fields)){const node=$(selector).first();if(node.length){const raw=field==='book.edition'?node.attr('data-edition'):text(selector);if(raw)set(field,raw);}}
 let hasJsonProduct=false;
 // Only declared JSON data scripts with recognized Product/Book keys; never execute.
 $('script[type="application/ld+json"]').each((_,el)=>{let json;try{json=JSON.parse($(el).text());}catch{return;}const entries=Array.isArray(json)?json:json?.['@graph']||[json];for(const item of entries){if(!['Product','Book'].includes(item?.['@type']))continue;if(item.url&&safeURL(item.url)!==url)continue;hasJsonProduct=true;
  if(typeof item.name==='string')set('product.title',item.name,item.name,'embedded_json');if(typeof item.isbn==='string')set('book.isbn',item.isbn,item.isbn,'embedded_json');for(const [key,field] of [['mpn','product.model'],['gtin13','product.barcode'],['gtin','product.barcode']])if(typeof item[key]==='string')set(field,item[key],item[key],'embedded_json');if(typeof item.brand==='string'||typeof item.brand?.name==='string')set('product.brand',typeof item.brand==='string'?item.brand:item.brand.name,typeof item.brand==='string'?item.brand:item.brand.name,'embedded_json');if(typeof item.description==='string')set('book.description',plain(load(item.description).root()),plain(load(item.description).root()),'embedded_json');
  const rating=item.aggregateRating;if(rating&&typeof rating==='object'){for(const [key,field] of [['ratingCount','ratings.count'],['ratingValue','ratings.score']])if(['string','number'].includes(typeof rating[key])&&/^\d+(?:\.\d+)?$/.test(String(rating[key])))set(field,Number(rating[key]),rating[key],'embedded_json');}
  for(const offer of Array.isArray(item.offers)?item.offers:item.offers?[item.offers]:[]){if(offer.price!=null&&/^\d+(?:\.\d+)?$/.test(String(offer.price))){set('price.display',Number(offer.price),offer.price,'embedded_json');if(typeof offer.priceCurrency==='string'&&/^[A-Z]{3}$/.test(offer.priceCurrency))set('price.currency',offer.priceCurrency,offer.priceCurrency,'embedded_json');}}
 }});
 // Conservative real-record extractor: explicit listing identity + actual store link.
 const offers=[];$('#sellers_list [data-listing-id]').each((_,el)=>{const node=$(el);if(node.closest('script,template').length)return;const listing=node.attr('data-listing-id'),a=node.find('a[href*="store.dangdang.com/"]').first(),shopURL=safeURL(a.attr('href')||'');if(!/^\d{5,20}$/.test(listing||'')||!shopURL)return;const raw=node.find('[data-seller-price]').first().attr('data-seller-price'),price=raw&&/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):null;offers.push({listingId:listing,shopName:cleanText(plain(a),300),shopUrl:shopURL,displayPrice:price,rawDisplayPrice:raw?cleanText(raw,100):null,currency:price!==null?'CNY':null,priceConditions:null,listingUrl:url});});if(offers.length)set('other_seller_offers',offers);
 const sellerRoot=$('#sellers_list');const count=sellerRoot.attr('data-sellers-count');if(count==='0'&&sellerRoot.find('a[href*="store.dangdang.com"]').length===0){set('other_sellers_count',0);set('other_seller_offers',[]);}
 // A template or empty hidden container is not a seller record.
 // Retain differing values with exact source positions; never resolve a conflict by guessing.
 const selectedOptions=Array.isArray(data.product.variants)?data.product.variants.flatMap(group=>Array.isArray(group.options)?group.options.filter(o=>o.selected).map(o=>({group:group.label,option:o.label})):[]):[];if(selectedOptions.length)for(const o of observations)if(['price.display','price.list','delivery.stockStatus','delivery.shippingPolicy'].includes(o.field))o.variantContext=selectedOptions;
 data.conflicts=[];for(const field of ['price.display','price.list','book.isbn','book.edition','book.binding','book.format','book.publishedAt','shop.fulfillment','shop.afterSales','delivery.stockStatus','delivery.shippingFee']){const os=observations.filter(o=>o.field===field&&o.value!==null&&o.layer!=='coverage');if(new Set(os.map(o=>JSON.stringify(o.value))).size>1)data.conflicts.push({field,observationIds:os.map(o=>o.id),scope:'来源位置/时间或口径不同，未判定哪个值正确'});}
 data.groupStatus=Object.fromEntries(['product','book','shop','price','promotions','delivery','ratings','officialImages','other_seller_offers'].map(group=>[group,observations.some(o=>o.field===group||o.field.startsWith(group+'.'))?'partially_observed':'not_observed']));
 if(/商品不存在|页面不存在|404|访问验证|Access Denied/i.test(data.product.title||''))return {ok:false,outcome:'unsupported_response',error:'product_schema_unrecognized'};
 const recognized=hasJsonProduct||String(data.product.productId)===String(productId)||$('.name_info h1,#product_info,#product_main,#dd-price,#detail_describe').length>0;
 if(!recognized||!data.product.title&&!embedded)return {ok:false,outcome:'unsupported_response',error:'product_schema_unrecognized'};
 // Missing fields are addressable coverage records, not observed facts. They let
 // DiDi cite exactly which saved listing/field remains unknown without inventing data.
 for(const group of ['product','book','shop','price','delivery','ratings','officialImages'])for(const [key,value] of Object.entries(data[group]))if(value===null&&(!observations.some(o=>o.field===group+'.'+key)||data.fieldStatus[group+'.'+key]&&!observations.some(o=>o.field===group+'.'+key&&o.value===null)))observations.push({id:listingId+'.F'+observations.length,listingId,listingUrl:url,field:group+'.'+key,value:null,raw:null,sourceUrl:url,layer:'coverage',collectedAt,region:null,status:data.fieldStatus[group+'.'+key]?'temporarily_unread':'not_observed',reason:data.fieldStatus[group+'.'+key]?.reason||'not_in_product_document_or_verified_response'});
 for(const field of ['promotions','other_sellers_count','other_seller_offers'])if(data[field]===null&&!observations.some(o=>o.field===field))observations.push({id:listingId+'.F'+observations.length,listingId,listingUrl:url,field,value:null,raw:null,sourceUrl:url,layer:'coverage',collectedAt,region:null,status:data.fieldStatus[field]?'temporarily_unread':'not_observed',reason:data.fieldStatus[field]?.reason||'not_in_product_document_or_verified_response'});
 return {ok:true,outcome:data.product.title&&!data.collectionCoverage.partial?'completed':'partial',data};
}

// Project already saved, attributable values into a NEW report snapshot only.
// Never mutate the batch, an existing snapshot, or infer from promotional subtitles.
export function enrichSavedProduct(saved){
 const d=structuredClone(saved),title=d.observations.find(o=>o.field==='product.title'&&typeof o.value==='string'&&o.status==='observed');
 const add=(group,key,value,source,layer='saved_field')=>{if(d[group][key]!==null||!source||value==null||value==='')return;d[group][key]=value;d.observations.push({...source,id:d.listingId+'.F'+d.observations.length,field:group+'.'+key,value,raw:source.raw,layer,sourcePath:source.field,derivedFrom:[source.id],status:'observed'});d.groupStatus[group]='partially_observed';};
 if(title){const labels=[...new Set(title.value.match(/当当专享特装版|(?:增订|修订|特装|精装|平装)版/g)||[])];if(labels.length)add('book','edition',labels.join(' / '),title,'title');if(title.value.includes('当当自营'))add('shop','selfOperatedLabel','当当自营',title,'title');}
 const known={开本:'format',包装:'binding',装帧:'binding',纸张:'paper',是否套装:'combo'};
 for(const extra of d.extra_metadata||[]){const key=known[extra.key.replace(/\s+/g,'')],source=d.observations.find(o=>o.id===extra.id&&o.layer==='DOM');if(key)add('book',key,extra.value,source);}
 return d;
}

// Parameters are copied from the observed page request and its own prodSpuInfo.
// No cookies, account data, speculative endpoints or comment requests.
export function enterpriseServiceRequest(html,productId){
 const $=load(html);let info=null;
 $('script').each((_,el)=>{const text=$(el).text();if(text.length>300000)return;const m=text.match(/\bprodSpuInfo\s*=\s*/);if(m)info=parseLiteral(text.slice(m.index+m[0].length));});
 if(!info||String(info.productId)!==String(productId))return null;
 const keys={shopId:'shopId',ddShopId:'ddShopId',isGiftPackaging:'isGiftPackaging',isSupportReturnPolicy:'isSupportReturnPolicy',categoryPath:'categoryPath',isPod:'isPod',productType:'productType',isCatalog:'isCatalog',productMedium:'mediumId'};
 const u=new URL('https://product.dangdang.com/index.php');u.searchParams.set('r','callback/score-service');u.searchParams.set('productId',String(productId));
 for(const [key,field]of Object.entries(keys)){if(!/^[0-9.]{1,30}$/.test(String(info[field]??'')))return null;u.searchParams.set(key,String(info[field]));}return u.href;
}
