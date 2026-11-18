import { SYSTEM_PROMPT } from "./ai-evidence.mjs";
export function requestBody(config, input, image) {
  const content = [
    {
      type: "text",
      text: JSON.stringify({
        product: input.product,
        parts: input.parts,
        imageId: input.imageId || null,
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
      result: {
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
  const r = await fetcher(
    config.endpoint.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify(requestBody(config, input, image)),
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      redirect: "error",
    },
  );
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(
      r.status === 429
        ? "provider_rate_limit"
        : r.status === 401 || r.status === 403
          ? "provider_auth_failed"
          : "provider_http_error",
    );
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
    throw providerError("provider_output_incomplete");
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
