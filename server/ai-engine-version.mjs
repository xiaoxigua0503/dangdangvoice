import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Captured ONCE on module load. An old long-lived process must not acquire the
// fingerprint of replacement files later written into the same checkout.
const sources = [
  'ai-engine-version.mjs', 'ai-pipeline.mjs', 'ai-config.mjs', 'ai-jobs.mjs',
  'ai-worker.mjs', 'worker-start.mjs', 'ai-worker-core.mjs', 'ai-provider.mjs', 'ai-images.mjs',
  'ai-models.mjs','ai-model-runtime.mjs','ai-review.mjs', 'ai-review-jobs.mjs', 'ai-review-prepare.mjs',
];
const hash = createHash('sha256');
for (const source of sources) {
  hash.update(source).update('\0');
  hash.update(readFileSync(new URL(source, import.meta.url), 'utf8').replace(/\r\n/g, '\n')).update('\0');
}
export const AI_ENGINE_VERSION = 'ddv-engine-' + hash.digest('hex');
