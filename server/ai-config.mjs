import { createHash } from "node:crypto";
export const digest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export const numberEnv = (name, fallback, min = 1, max = 1000000) =>
  Math.max(
    min,
    Math.min(max, Math.floor(Number(process.env[name]) || fallback)),
  );
export const PROMPT_VERSION = "ddv-product-review-5";
export function aiConfig() {
  const provider = process.env.AI_PROVIDER || "qwen";
  const model = process.env.AI_MODEL || "qwen3.7-flash";
  if (
    provider !== "qwen" &&
    !(provider === "mock" && process.env.NODE_ENV !== "production")
  )
    throw new Error("AI 提供方未受支持；生产不可使用 mock");
  if (
    provider === "qwen" &&
    !/^qwen(?:3\.7-flash|3-vl-(?:plus|flash)|-vl-(?:plus|max))(?:-\d{4}-\d{2}-\d{2})?$/.test(
      model,
    )
  )
    throw new Error("请选择已支持的 Qwen 视觉模型，不能使用纯文本模型");
  const endpoint =
    process.env.AI_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1";
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("AI_BASE_URL 无效，请使用 HTTPS 服务地址");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("AI_BASE_URL 必须是无凭据的 HTTPS 服务地址");
  if (provider === 'qwen' && !parsed.pathname.replace(/\/$/,'').endsWith('/v1'))
    throw new Error('AI_BASE_URL 必须是 Qwen 的兼容 API 根地址（以 /v1 结尾），不是网站地址');
  if (process.env.APP_BASE_URL && parsed.origin === new URL(process.env.APP_BASE_URL).origin)
    throw new Error('AI_BASE_URL 不能指向本应用，请配置 Qwen 模型 API 地址');
  return {
    provider,
    model,
    endpoint,
    promptVersion: PROMPT_VERSION,
    schemaVersion: 2,
    batchChars: numberEnv("AI_BATCH_CHARS", 9000, 1000, 16000),
    batchComments: numberEnv("AI_BATCH_COMMENTS", 20, 1, 100),
    outputTokens: numberEnv("AI_MAX_OUTPUT_TOKENS", 4096, 512, 8192),
    timeoutMs: numberEnv("AI_REQUEST_TIMEOUT_MS", 120000, 1000, 180000),
    maxAttempts: numberEnv("AI_MAX_ATTEMPTS", 3, 1, 5),
    maxImageBytes: numberEnv(
      "AI_MAX_IMAGE_BYTES",
      8 * 1024 * 1024,
      1024,
      12 * 1024 * 1024,
    ),
    maxImagePixels: numberEnv("AI_MAX_IMAGE_PIXELS", 16000000, 1000, 20000000),
    maxTotalImageBytes: numberEnv(
      "AI_MAX_TOTAL_IMAGE_BYTES",
      200 * 1024 * 1024,
      1024,
      1024 * 1024 * 1024,
    ),
  };
}
export function providerReady(config) {
  return config.provider === "mock" || !!process.env.AI_API_KEY;
}
