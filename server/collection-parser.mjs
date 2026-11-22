import {load} from 'cheerio';
// Inspect inert HTML only. JSON is parsed before this classifier is consulted.
export function classifyHtmlResponse(text){
 const t=String(text||'').trimStart();
 if(!t.startsWith('<'))return {kind:'unknown',rules:{html:false}};
 const $=load(t),title=$('title').text().trim();
 // Source comments are data, even when they discuss WAF/CAPTCHA or contain scripts.
 const commentNodes=$('.comment_items,.describe_detail,.describe_long').length>0;
 const scripts=$('script').toArray(),inline=scripts.map(el=>$(el).attr('src')?'':$(el).text());
 const scriptText=inline.join('\n');
 const visible=$.root().clone();visible.find('script,style,template,noscript').remove();
 const shell=!title&&!$('form,meta[http-equiv="refresh" i]').length&&!visible.text().trim()&&!commentNodes;
 const rules={html:true,commentNodes,deniedTitle:/^(?:Access Denied|访问被拒绝|访问遭到拒绝)(?:\b|$)/i.test(title),
  scriptShell:shell,inlineDominant:scriptText.length>t.length*0.8,
  wafMarker:/aliyun_waf|_waf_/i.test(scriptText),challengeMarker:/captcha|challenge/i.test(scriptText),
  substantialScript:scriptText.length>=1024,runtimeAccess:/\b(?:document|window|location)\s*(?:\.|\[)|\bcookie\b/i.test(scriptText)};
 const plain=visible.text().trim();
 const denied=rules.deniedTitle||(!commentNodes&&/^(?:Access Denied|访问被拒绝|访问遭到拒绝)[.!。\s]*$/i.test(plain));
 if(denied)return {kind:'access_denied',rules};
 if(shell&&rules.inlineDominant&&(rules.wafMarker||rules.challengeMarker&&rules.substantialScript&&rules.runtimeAccess))return {kind:'javascript_challenge',rules};
 return {kind:'ordinary_html',rules};
}
export function htmlAccessFailure(text){
 const {kind,rules}=classifyHtmlResponse(text);
 if(kind==='javascript_challenge')return {ok:false,outcome:'challenge_detected',blocked:true,code:'challenge_detected',diagnostic:{responseKind:kind,rules}};
 if(kind==='access_denied')return {ok:false,outcome:'blocked',blocked:true,code:'access_denied',diagnostic:{responseKind:kind,rules}};
 return null;
}
export function blockedText(text){return !!htmlAccessFailure(text);}
export function commentText($,node){
 if(!node.length)return '';
 const copy=node.clone();
 copy.find('script,style,form,button,input,select,.login,.login_box,.login_tips,.login-tip,.comment_operate,.comment_action,.operate,.reply,.reply_box,.praise').remove();
 copy.find('a').each((_,el)=>{const link=$(el),href=link.attr('href')||'';if(/^(?:https?:)?\/\/(?:login|passport)\.dangdang\.com(?:[/:]|$)/i.test(href)||/^(?:javascript:|#)/i.test(href))link.remove();});
 return copy.text().replace(/\s+/g,' ').trim();
}
const normImg = (x) => !x ? null : (x.startsWith("//") ? "https:" + x : x.replace(/^http:\/\//i, "https://"));
function collectPics($el) {
  const pics = [];
  $el.find("img").each((_, im) => {
    const at = im.attribs || {};                       // plain DOM attrs — no $ closure needed here
    const src = normImg(at.src || at["data-src"] || "");
    if (!src || !/reviewimg|Community/i.test(src)) return;
    const big = normImg(at["data-big-pic"] || src.replace(/_p\.([a-z]+)$/i, "_e.$1")) || src;
    if (!pics.some((x) => x.th === src)) pics.push({ th: src, big });
  });
  return pics;
}
export function parseListFragment(html) {
  const $ = load(html);
  const out = [];
  $(".comment_items").each((_, el) => {
    const $el = $(el);
    const a = $el.find(".describe_detail a").first();
    let href = a.attr("href") || "";
    if (href.startsWith("//")) href = "https:" + href;
    const text = commentText($, $el.find(".describe_detail").first());
    const dm = href.match(/\/comment\/detail\/(\d+)\/(\d+)\/(\d+)/);
    const cid = dm ? dm[3] : ($el.find("[data-comment-id]").first().attr("data-comment-id") || null);
    let score = null;
    const em = $el.find(".pinglun em").first().text();
    const sm = em && em.match(/(\d+)/);
    if (sm) score = +sm[1];
    else {
      const w = $el.find(".star").first().attr("style");
      const wm = w && w.match(/width:(\d+)%/);
      if (wm) score = Math.max(1, Math.min(10, Math.round(+wm[1] / 10)));
    }
    const lineEls = $el.find(".starline span");
    const line = lineEls.toArray().map((s) => $(s).text().trim()).join(" ");
    const date = (line.match(/\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?/) || [])[0] || null;
    let variant = null;
    lineEls.toArray().forEach((s) => {
      const t = $(s).text().trim();
      if (t.startsWith("类型")) variant = t.split("：").slice(1).join("：").trim();
    });
    const user = $el.find(".items_left_pic .name").first().text().trim() || $el.find(".username").first().text().trim() || null;
    const level = $el.find(".items_left_pic .level").first().text().trim() || $el.find(".level").first().text().trim() || null;
    const pics = collectPics($el);
    const hasImg = pics.length > 0 || $el.find(".pic_list img, .pic_preview img, .show_pic img, .pic_show img[src]").length > 0;
    if (!text && !hasImg) return;
    out.push({ cid, detail_url: href || null, text, score, date, variant, user, level, has_img: hasImg, pics: pics.length ? pics : null });
  });
  return out;
}

export function parseDetailHtml(html) {
  const $ = load(html);
  const d = {};
  d.text_full = commentText($, $(".describe_long").first()) || commentText($, $(".describe_detail").first());
  const em = $(".pinglun em").first().text();
  const sm = em && em.match(/(\d+)/);
  d.score = sm ? +sm[1] : null;
  const line = $(".starline span").toArray().map((s) => $(s).text().trim()).join(" ");
  d.date = d.date || (line.match(/\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?/) || [])[0] || null;
  d.user = $(".items_left_pic .name").first().text().trim() || null;
  d.level = $(".items_left_pic .level").first().text().trim() || null;
  d.pics = collectPics($(".comment_items").length ? $(".comment_items").first() : $.root());
  d.has_img = d.pics.length > 0 || $(".pic_list img, .big_pic_wrap img[src], .show_pic img").length > 0;
  if (!d.pics.length) d.pics = null;
  d.content_recognized=!!d.text_full||$('.comment_items').length>0&&!!d.pics?.length;
  d.product_name = $(".book_info .name a").first().text().trim() || null;
  d.price = $(".price_d").first().text().trim() || null;
  let img = $(".book_info .pic img").first().attr("src") || null;
  if (img?.startsWith("//")) img = "https:" + img;
  d.image = img;
  return d;
}

// meta from the (GBK-encoded) product page HTML — works even when the list
// channel is blocked. Price/cover come from detail pages only (JS-driven here).
export function parseProductMeta(bufOrText, pid) {
  const out = {};
  let html = "";
  try {
    if (typeof bufOrText === "string") html = bufOrText;
    else {const declared=Buffer.from(bufOrText).subarray(0,8192).toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?\s*(utf-8|gb18030|gbk|gb2312)/i)?.[1];html=new TextDecoder(declared?.toLowerCase()==='utf-8'?'utf-8':'gb18030').decode(bufOrText);}
  } catch { return out; }
  if (!html || blockedText(html)) return out;
  const ttl = (html.match(/<title>([^<]{4,200})<\/title>/i) || [])[1] || "";
  const guil = ttl.match(/《([^》]{4,120})》/);
  let name = guil ? guil[1] : ttl.split(" - 当当")[0].replace(/[《》]/g, "").trim();
  if (/商品不存在|404|页面不存在|暂时没有找到|抱歉|验证|欢迎光临/.test(name)) name = null;
  out.name = name || null;
  const $=load(html);
  if(!out.name)out.name=$('meta[property="og:title"]').attr('content')?.trim()||$('.name_info h1').first().text().trim()||null;
  out.price=$('meta[property="product:price:amount"]').attr('content')?.trim()||$('#dd-price').first().text().trim()||null;
  out.image=normImg($('meta[property="og:image"]').attr('content')||$('#largePic').attr('src')||'');
  out.description=$('meta[name="description"]').attr('content')?.trim() || null;
  const specifications={};
  // Only data actually present on the requested product page. No inferred fields.
  $('#detail_describe li, .key li').each((_,el)=>{
    const raw=$(el).text().trim(), colon=raw.search(/[:：]/);
    if(colon>0 && raw.length<=1000) specifications[raw.slice(0,colon).trim()]=raw.slice(colon+1).trim();
  });
  if(Object.keys(specifications).length)out.specifications=specifications;
  return out;
}



export function parseListResponse(text){
 let d;try{d=JSON.parse(text);}catch{const failure=htmlAccessFailure(text);if(failure)return failure;const html=classifyHtmlResponse(text);return {ok:false,outcome:html.kind==='ordinary_html'?'unsupported_response':'parse_error',blocked:false,code:html.kind==='ordinary_html'?'unexpected_html':'invalid_json',diagnostic:{parser:'list-json',responseKind:html.kind,rules:html.rules}};}
 let list=d?.data?.list;
 if(typeof list==='string'){try{list=JSON.parse(list);}catch{return {ok:false,outcome:'parse_error',blocked:false,code:'invalid_list_json'};}}
 if(!list||typeof list!=='object'||Array.isArray(list)||typeof list.html!=='string')return {ok:false,outcome:'unsupported_response',blocked:false,code:'unrecognized_list_schema'};
 // A recognized JSON envelope remains comment data, not a top-level challenge page.
 const summary=list.summary&&typeof list.summary==='object'&&!Array.isArray(list.summary)?list.summary:{},items=parseListFragment(list.html),$=load(list.html);
 const numeric=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0&&Number.isInteger(Number(v));
 const validTotal=numeric(summary.total_comment_num),validPages=numeric(summary.pageCount);
 if(!validTotal||!validPages)return {ok:items.length>0,outcome:items.length?'partial':'parse_error',blocked:false,code:'invalid_summary',summary,items,diagnostic:{rows:$('.comment_items').length,parsed:items.length}};
 const rows=$('.comment_items').length;
 // Nonempty unknown HTML (including a login screen) cannot confirm emptiness.
 if(!items.length&&list.html.trim()&&($.root().text().trim()||$('form,input,button,script,iframe,.describe_detail,.describe_long').length))return {ok:false,outcome:'parse_error',blocked:false,code:'unrecognized_comment_nodes',summary,items,diagnostic:{rows,parsed:0}};
 let outcome=rows>items.length||items.length>0&&(Number(summary.pageCount)===0||Number(summary.total_comment_num)===0)?'partial':'completed';
 if(!items.length){const total=Number(summary.total_comment_num),pages=Number(summary.pageCount);
  outcome=total===0&&pages<=1?'empty_confirmed':total>0&&numeric(summary.total_auto_count)&&Number(summary.total_auto_count)===total&&pages===0?'defaults_only':'empty_unconfirmed';
 }
 return {ok:['completed','partial','empty_confirmed','defaults_only'].includes(outcome),outcome,blocked:false,summary,items,code:outcome==='empty_unconfirmed'?'empty_without_confirmation':undefined,diagnostic:{rows,parsed:items.length}};
}
export function retryAfterMs(value,now=Date.now()){if(!value)return 0;const n=Number(value);return Number.isFinite(n)?Math.max(0,n*1000):Math.max(0,Date.parse(value)-now)||0;}
export function relayError(error){const status=error?.httpStatus;const code=error?.code||error?.cause?.code;const outcome=status===429?'rate_limited':status===403?'blocked':status?'upstream_error':error?.name==='TimeoutError'||/TIMEOUT/.test(code||'')?'timeout':error?.name==='AbortError'?'cancelled':'network_error';return {ok:false,blocked:outcome==='blocked',outcome,httpStatus:status||null,code:status?`upstream_http_${status}`:outcome,retryAfterMs:error?.retryAfterMs||0,diagnostic:{contentType:error?.contentType||undefined,responseLength:null,...(typeof code==='string'&&/^[A-Z0-9_]{1,60}$/.test(code)?{networkCode:code}:{})}};}
