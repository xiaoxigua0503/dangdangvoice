import {AI_ENGINE_VERSION} from './ai-engine-version.mjs';
// Capabilities are code-owned, never taken from a job or environment variable.
export const WORKER_CAPABILITIES = Object.freeze({
  'evidence-v1': Object.freeze({ schema: 1, kinds: ['text', 'image'] }),
  'product-review-v2': Object.freeze({ schema: 2, engineVersion:AI_ENGINE_VERSION, kinds: ['prepare', 'review', 'synthesis'] }),
});
export function pipelineFor(config) {
  return config.pipelineVersion || (config.schemaVersion === 1 ? 'evidence-v1' : config.schemaVersion === 2 ? 'product-review-v2' : null);
}
export function supportsUnit(config, kind) {
  const capability = WORKER_CAPABILITIES[pipelineFor(config)];
  return !!capability && capability.schema === config.schemaVersion && (!config.executorVersion||capability.engineVersion===config.executorVersion) && capability.kinds.includes(kind);
}
export async function advertiseWorker(c) {
  await c.query("SELECT set_config('ddv.ai_worker_capabilities',$1,true)", [JSON.stringify(WORKER_CAPABILITIES)]);
}
