import {AI_ENGINE_VERSION} from './ai-engine-version.mjs';
// Capabilities are code-owned, never taken from a job or environment variable.
export const WORKER_CAPABILITIES = Object.freeze({
 'product-summary-v4':Object.freeze({schema:4,engineVersion:AI_ENGINE_VERSION,kinds:Object.freeze(['prepare','review'])}),
});
export function pipelineFor(config) {
  return config.pipelineVersion || (config.schemaVersion === 1 ? 'evidence-v1' : config.schemaVersion === 2 ? 'product-review-v2' : config.schemaVersion === 3 ? 'product-review-v3' : config.schemaVersion===4?'product-summary-v4':null);
}
export function supportsUnit(config, kind) {
  const capability = WORKER_CAPABILITIES[pipelineFor(config)];
  return !!capability && capability.schema === config.schemaVersion && (!config.executorVersion||capability.engineVersion===config.executorVersion) && capability.kinds.includes(kind);
}
export async function advertiseWorker(c) {
  await c.query("SELECT set_config('ddv.ai_worker_capabilities',$1,true)", [JSON.stringify(WORKER_CAPABILITIES)]);
}
