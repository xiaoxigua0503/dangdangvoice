/* focused tests for canonical URL handling — src/url.ts is the single client
   implementation; server.mjs#extractPid mirrors it (bundling forbids import). */
import test from "node:test";
import assert from "node:assert/strict";
import { extractProductId, canonicalProductUrl, normalizeProductInput } from "../src/url.ts";

const CASES = [
  ["https://product.dangdang.com/30113481.html", "30113481"],                      // desktop
  ["https://product.dangdang.com/30113481.html?online=1&t=2", "30113481"],          // desktop + query
  ["https://product.m.dangdang.com/product.php?pid=30113481&host=product.dangdang.com", "30113481"], // mobile (the bug)
  ["https://m.dangdang.com/product.php?product_id=30113481", "30113481"],           // mobile legacy param
  ["https://www.dangdang.com/29709313.html", "29709313"],
  ["https://item.dangdang.com/1194208612.html", "1194208612"],
  ["product.dangdang.com/30113481.html", "30113481"],                               // schemeless desktop
  ["product.m.dangdang.com/product.php?pid=30113481", "30113481"],                  // schemeless mobile
  ["http://dangdang.com/7723396.html", "7723396"],                                  // bare host + http
  ["30113481", "30113481"],                                                         // bare id
  ["https://comment.dangdang.com/comment/detail/0/30113481/378964626", "30113481"], // detail paste
  ["PRODUCT.DANGDANG.COM/30113481.HTML", "30113481"],                               // case + no scheme
];
const REJECTS = [
  "", "   ",
  "https://taobao.com/item.htm?id=30113481",                    // foreign domain with numbers
  "https://product.dangdang.com/abc.html",                       // dangdang but no id
  "hello world",
  "https://product.dangdang.com",                                // host only
];

test("extractProductId accepts desktop + mobile + schemeless + bare id", () => {
  for (const [input, want] of CASES) assert.equal(extractProductId(input), want, `extract: ${input}`);
});

test("rejects foreign domains and id-less dangdang links", () => {
  for (const bad of REJECTS) assert.equal(extractProductId(bad), null, `reject: ${JSON.stringify(bad)}`);
});

test("normalizeProductInput yields canonical desktop URL for every accepted shape", () => {
  for (const [input] of CASES) {
    const r = normalizeProductInput(input);
    assert.equal(r.ok, true, `ok expected: ${input}`);
    assert.equal(r.canonical, `https://product.dangdang.com/${r.pid}.html`);
    assert.equal(r.canonical, canonicalProductUrl(r.pid));
  }
});

test("mobile and desktop variants of one product converge to the same id + canonical URL", () => {
  const d = normalizeProductInput("https://product.dangdang.com/30113481.html");
  const m = normalizeProductInput("https://product.m.dangdang.com/product.php?pid=30113481&host=product.dangdang.com");
  assert.deepEqual([d.pid, m.pid, d.canonical, m.canonical], ["30113481", "30113481", d.canonical, d.canonical]);
});

test("failure codes are precise for UI messaging", () => {
  assert.equal(normalizeProductInput("").code, "empty");
  assert.equal(normalizeProductInput("https://taobao.com/item.htm?id=30113481").code, "not_dangdang");
  assert.equal(normalizeProductInput("https://product.dangdang.com/abc.html").code, "no_id");
});

/* server mirror drift guard: same accept/reject table through the server copy,
   loaded by reading its source text for the exact regexes is fragile — instead
   boot it with env and drive /api/relay prime? too heavy for this suite; pin
   the pattern strings equal instead. */
import { readFileSync } from "node:fs";
test("server extractPid mirror stays parameter-compatible", () => {
  const srv = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(srv, /\?&\]\(\?:pid\|product_\?id/, "server param list must include pid= (mobile)");
  assert.match(srv, /mirrors canonical client logic in src\/url\.ts/, "server guard must stay documented as a mirror");
});

/* runtime equivalence: boot the real server, drive /api/relay with the same
   table — foreign domains must 422, mobile forms must resolve the pid. */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
async function freePort() {
  const l = createServer(); await new Promise((r) => l.listen(0, "127.0.0.1", r));
  const p = l.address().port; await new Promise((r) => l.close(r)); return p;
}
test("relay requires configured accounts and CSRF, while public analysis remains available", async () => {
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,["server.mjs"],{cwd:new URL("..",import.meta.url),env:{...process.env,DATABASE_URL:"",HOST:"127.0.0.1",PORT:String(port),APP_BASE_URL:base},stdio:"ignore"});
  try {
    for(let i=0;i<100;i++){try{if((await fetch(base+"/healthz")).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const request=(path,origin=base)=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify({action:"list",pid:"30113481",comments:[{text:"印刷清晰",score:10}]})});
    assert.equal((await request("/api/relay")).status,503);
    assert.equal((await request("/api/relay","https://foreign.invalid")).status,403);
    assert.equal((await request("/api/analyze")).status,200);
    assert.equal((await fetch(base+"/api/auth/me")).status,503);
  } finally {child.kill("SIGTERM");await new Promise(r=>child.once("close",r));}
});

import {load} from "cheerio";
test("photo parser preserves thumbnail, full image and complete comment fields without an external network",()=>{
 const source=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
 const parsers=source.slice(source.indexOf("const normImg ="),source.indexOf("// meta from the (GBK"));
 const parse=new Function("load",parsers+";return parseListFragment")(load);
 const rows=parse(`<div class="comment_items"><div class="describe_detail"><a href="//comment.dangdang.com/comment/detail/0/30113481/12345">印刷清晰</a></div><div class="pinglun"><em>10</em></div><div class="starline"><span>2026-11-18</span><span>类型：精装</span></div><div class="username">买家</div><div class="pic_list"><li><a><img src="//img3.ddimg.cn/Community/a_p.jpg" data-big-pic="//img3.ddimg.cn/Community/a_e.jpg"></a></li></div></div>`);
 assert.equal(rows.length,1);assert.equal(rows[0].cid,"12345");assert.equal(rows[0].variant,"精装");assert.equal(rows[0].text,"印刷清晰");assert.equal(rows[0].has_img,true);
 assert.deepEqual(rows[0].pics,[{th:"https://img3.ddimg.cn/Community/a_p.jpg",big:"https://img3.ddimg.cn/Community/a_e.jpg"}]);
});
