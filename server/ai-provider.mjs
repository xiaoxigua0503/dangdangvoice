import {REPAIR_PROMPT} from "./ai-review-repair.mjs";
import {reviewPayload,REVIEW_PROMPT,budgetInput,reviewParts} from "./ai-review.mjs";
import { SYSTEM_PROMPT, evidenceInstructions } from "./ai-evidence.mjs";
export function requestBody(config, input, image) {
  if(config.schemaVersion===2) {
    const images=Array.isArray(image)?image:[];
    const payload=reviewPayload(input);
    const budget=budgetInput(config,payload,images);
    if(!budget.fits)throw Object.assign(new Error('context_budget_exceeded'),{permanent:true});
    const content=[{type:'text',text:JSON.stringify(payload)}];
    for(const i of images)content.push({type:'text',text:JSON.stringify({imageId:i.id})},{type:'image_url',image_url:{url:`data:${i.mime};base64,${i.bytes.toString('base64')}`}});
    return {model:config.model,messages:[{role:'system',content:input.mode==='repair'?REPAIR_PROMPT:REVIEW_PROMPT},{role:'user',content}],response_format:input.textOnlyRepair?{type:'json_schema',json_schema:{name:'ddv_evidence_repair',strict:true,schema:payload.outputSchema}}:{type:'json_object'},enable_thinking:false,enable_search:false,max_tokens:config.outputTokens,stream:false};
  }
  const content = [
    {
      type: "text",
      text: JSON.stringify({
        product: input.product,
        parts: input.parts,
        imageId: input.imageId || null,
        evidenceRules:evidenceInstructions(input,!!image,input.previousValidationError),
        quoteItemSchema:{type:"object",required:["commentId","text"],additionalProperties:false,properties:{commentId:{type:"string",enum:[...new Set(input.parts.map(p=>p.commentId))]},text:{type:"string",description:"输入 part.text 的逐字连续子串"}}},
      }),
    },
  ];
  if (image)
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mime};base64,${image.bytes.toString("base64")}`,
      },
    });
  return {
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: {type:"json_object"},
    enable_thinking: false,
    enable_search: false,
    max_tokens: config.outputTokens,
    stream: false,
  };
}
export async function infer(config, input, image, signal, fetcher = fetch) {
  if (config.provider === "mock") {
    if (process.env.NODE_ENV === "production") throw new Error("mock_disabled");
    return {
      result: config.schemaVersion===2 ? (()=>{
        const refs=[...new Set(reviewParts(input).map(p=>p.commentId))];
        const p={text:'本地演示：这是流程占位内容，未执行真实模型推理，不能作为购买建议。',citations:refs.slice(0,1).map(id=>({kind:'comment',id,quote:null,visibleText:null})),statistics:[]};
        return {schemaVersion:2,verdict:p,paragraphs:[p],imageText:[],checks:[],qualitySignals:[]};
      })() : {
        findings: [
          {
            category: image ? "aspect" : "overview",
            aspect: image ? "买家秀" : "评论内容",
            title: "本地测试输出",
            body: "这是确定性测试输出，不代表真实模型判断。",
            uncertainty: "仅用于验证流程，未执行真实 AI 推理。",
            priority: "low",
            comments: [...new Set(input.parts.map((p) => p.commentId))],
            images: input.imageId ? [input.imageId] : [],
            quotes: [],
          },
        ],
      },
      usage: { mock: true },
    };
  }
  if (!process.env.AI_API_KEY) throw new Error("provider_not_configured");
  const body = JSON.stringify(requestBody(config, input, image));
  let r;
  try { r = await fetcher(
    config.endpoint.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      redirect: "error",
    },
  );
  } catch (e) {
    throw Object.assign(new Error(signal.aborted || ["AbortError", "TimeoutError"].includes(e.name) ? "provider_timeout" : "provider_network_error"), {cause:e});
  }
  if (!r.ok) {
    // Read only a bounded error body; retain a known category, never provider text.
    let raw=""; const reader=r.body?.getReader();
    if(reader) { try { for(;;) { const {done,value}=await reader.read(); if(done)break; raw+=Buffer.from(value).toString("utf8"); if(raw.length>16384)break; } } finally { await reader.cancel().catch(()=>{}); } }
    let code="";try{code=JSON.parse(raw).error?.code || "";}catch{}
    const quota=/quota|arrear|insufficient|billing|allocation/i.test(code);
    throw Object.assign(new Error(quota ? "provider_quota_exhausted" : r.status===429 ? "provider_rate_limit" : [401,403].includes(r.status) ? "provider_auth_failed" : "provider_http_"+r.status), {httpStatus:r.status, permanent:quota || (r.status>=400&&r.status<500&&![408,429].includes(r.status))});
  }
  const reader = r.body.getReader();
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2000000) {
      await reader.cancel();
      throw new Error("provider_output_too_large");
    }
    chunks.push(value);
  }
  let d;
  try {
    d = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_provider_json");
  }
  const usage = usageFrom(d.usage);
  const providerError = (code) =>
    Object.assign(new Error(code), { providerUsage: usage });
  if (d.choices?.[0]?.finish_reason !== "stop")
    throw Object.assign(providerError("provider_output_incomplete"),{providerDiagnostic:{finishReason:d.choices?.[0]?.finish_reason||null,partialContent:typeof d.choices?.[0]?.message?.content==='string'?d.choices[0].message.content.slice(0,30000):null}});
  let result;
  try {
    result = JSON.parse(d.choices[0].message.content);
  } catch {
    throw providerError("invalid_structure");
  }
  return { result, usage };
}

export function usageFrom(raw) {
  const usage = {};
  for (const k of ["prompt_tokens", "completion_tokens", "total_tokens"])
    if (Number.isSafeInteger(raw?.[k]) && raw[k] >= 0) usage[k] = raw[k];
  return usage;
}
