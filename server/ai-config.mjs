import {configuredModels,endpointUrl} from './ai-models.mjs';
import {AI_ENGINE_VERSION} from './ai-engine-version.mjs';
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
export const PROMPT_VERSION = "ddv-product-summary-16";
export function aiConfig() {
  const provider = process.env.AI_PROVIDER || "qwen";
  const model = process.env.AI_MODEL || "qwen3.7-flash";
  if (
    provider !== "qwen" &&
    !(provider === "mock" && process.env.NODE_ENV !== "production")
  )
    throw new Error("AI 提供方未受支持；生产不可使用 mock");
  const endpoint=endpointUrl(process.env.AI_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const models=configuredModels(model,endpoint);
  const freeQuotaOnly=process.env.AI_FREE_QUOTA_ONLY==='true';
  if(freeQuotaOnly&&!models[0].freeTierStopConfirmed)throw new Error('免费额度模式要求先在控制台为主模型开启用完即停并确认配置；代码不能查询剩余额度');
  return {
    provider,
    model:models[0].model,
    endpoint:models[0].endpoint,
    models,freeQuotaOnly,
    modelCooldownMs:numberEnv("AI_MODEL_COOLDOWN_SECONDS",3600,60,86400)*1000,
    maxRetryAfterMs:numberEnv("AI_MAX_RETRY_AFTER_SECONDS",120,1,600)*1000,
    promptVersion: PROMPT_VERSION,
    schemaVersion: 4,
    pipelineVersion: "product-summary-v4",
    executorVersion: AI_ENGINE_VERSION,
    outputTokens: numberEnv("AI_MAX_OUTPUT_TOKENS", 4096, 512, 8192),
    timeoutMs: numberEnv("AI_REQUEST_TIMEOUT_MS", 120000, 1000, 180000),
    maxProviderRequests: numberEnv("AI_MAX_PROVIDER_REQUESTS", 3, 1, 20),
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
  return config.provider === "mock" || !!process.env[config.models?.[0]?.keyEnv||"AI_API_KEY"];
}
