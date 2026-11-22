# Model-authored report visuals — additive v4 extension

This extends the existing single multimodal report request. The model chooses
all visual topics, captions, claims, comparisons, source mappings and order.
The Web client does not derive insights from the deterministic dashboard. It
only renders the accepted output, counts unique mapped comment IDs and displays
existing duplicate-source diagnostics. The article remains central; visual
blocks follow the article in accepted model order, before purchase checks.

## Output contract and limits

The original `headline`, `summary`, `considerations`, `sourceIds` fields retain
their shapes and limits. Optional `visuals` is a discriminated union array of
0–4 blocks. Empty/missing visuals render the article normally.

| Type | Model-authored fields | Limits / validation |
| --- | --- | --- |
| `topics` | `title`, `topics[{label,note?,commentIds}]` | 1–6 topics; 1–2000 comment IDs/topic; unique IDs counted after normalization |
| `image_observations` | `title`, `images[{imageId,caption,relatedCommentIds?}]` | 1–4 per block, at most 4 across the report; no repeated canonical bytes; image must actually be sent; related comments must belong to that image |
| `experience_comparison` | `title`, `groups[{title,claims[{text,commentIds,imageIds}]}]` | Exactly 2 supported groups, 1–3 claims/group; every claim needs comment or sent-image references |
| `seller_vs_evidence` | `title`, `items[{metadataId,assessment,text,commentIds,imageIds}]` | 1–4 items; assessment `supported`, `different_experience`, `insufficient`; first two require evidence; last may have empty evidence |

Visual titles/labels are at most 80 characters; notes/captions/claims at most 180;
IDs at most 100. Evidence lists are at most 2000 comments / 4 images. Arbitrary
counts, percentages, chart configs and HTML/SVG/code fields are not accepted.
The prompt suggests an 800–1200-character article and concise visual explanations
(total roughly 500 Chinese characters), preferring fewer useful blocks. Existing
output-token, request, retry, fallback and context limits are unchanged. Budgeting
includes the new prompt/schema/catalog and duplicate diagnostics. No hidden
truncation, repair, rereading, second inference or synthesis stage is added.

Model judgment is not verified merely by validating an ID. Prompt and UI distinguish
seller claims, buyer experiences, direct visible observations, inference and
version uncertainty. There are no generated purchase/confidence/fraud scores.
Topic counts are explicitly mapped source IDs, not full-snapshot frequencies,
independent experiences, consensus or sentiment shares. Unassigned comments do
not mean “not mentioned”. Existing exact/near-duplicate comment groups are flagged.

## Sources and task isolation

The existing worker reads immutable task input and private images using `job_id`;
owner/verified/Pro checks and the evidence/image HTTP endpoints are unchanged.
Validation resolves only IDs in that input. Internal IDs take precedence; original
cid normalization requires exactly one task-local `comments[].sourceId` match.
Unknown/ambiguous IDs reject a block, never become replacement sources or empty
arrays. Image aliases normalize only to their known sent-byte representative.
Actual sent image IDs are passed from the worker to validation and the request
payload. An image existing in input/DB or an unread entry is not sufficient.

`metadataSources` is generated from real scalar leaves under `/name` and the
existing seller whitelist (`description`, `price`, `specifications`, `variants`,
`publisher`, `author`, `isbn`), with JSON Pointer escaping and max depth 8.
Its `M…` IDs map to exact paths/text in server-generated `sourceCatalog`.
Missing fields cannot be referenced. Product IDs/site counters are not seller
claim evidence. The existing metadata viewer opens these stored sources.

Only downloaded, deduplicated image bytes are sent. Existing source-quality
metadata is included in model context. Repeated byte aliases cannot form multiple
image-observation entries, including across blocks. Image source/comment relation
checks preserve all recorded occurrences. Image thumbnails use the owned saved
image endpoint; captions are rendered as React text, never HTML. Visual images
and their known byte aliases are excluded from the evidence rail previews to
avoid repetition, without changing the viewer behavior.

## Partial contract and durability

The article structure and its `sourceIds` must pass existing validation. Each
visual is then checked independently against the strict union and task sources.
An invalid visual is omitted **as a whole**; its content is not repaired. A malformed
visual array or more than 4 entries omits the entire visual list. Valid blocks
retain order. Private/result diagnostics contain block index, bounded issue code
and schema path, not full generated content or secrets.

Accepted JSON adds server-owned `visualsVersion:1`, `visualStatus:valid|partial`,
`visualDiagnostics` and `sourceCatalog`. A valid article with any rejected visual
is durably saved with report `partial:true` and job state `partial`, even if input
coverage is complete. The Web displays an explicit omission notice; the existing
AI progress component sees a terminal partial state. No automatic repair/retry is
created. Cache revalidation retains previous partial diagnostics and rechecks the
accepted blocks against the same task/sent images.

Existing provider checks still reject non-`stop` finish reasons and incomplete or
invalid JSON before acceptance. An output cut by the token limit is not displayed
as complete. Existing cancellation, leases, bounded retries and model fallback
are unchanged.

## Version and VM update (not performed)

- Report base schema/pipeline stay `4` / `product-summary-v4`; visuals have additive
  version `1`. Prompt is `ddv-product-summary-18-visuals-1`.
- The existing source fingerprint now includes the new visual-validator module;
  config, prompt, engine and private cache keys therefore change automatically.
  Existing executor-version capability checks prevent old workers claiming new
  jobs. Web/report worker must use the same reviewed release/fingerprint.
- No new DB columns, migration, environment variable, service or model is needed.
  Report JSONB and the existing API retain the additional fields. Saved old reports
  are read unchanged; refresh/open does not create jobs or inference. Existing
  history and snapshot JSON import/export code is unchanged.
- For a future authorized VM release: use the existing backup/release procedure;
  drain active report work under its matching release; build/install the reviewed
  Web and report-worker release together using their actual current service names,
  working directories, protected environment files and Node entry commands. Keep
  the current PostgreSQL, model/endpoint/key and budgets. Do not rewrite old job
  configs, requeue historical tasks or bypass executor checks. No migration is
  required **for this patch**. Keep `dangdangvoice-chat-worker` and its separate
  queue/config unchanged. No production action was performed here.

## Changed files

- Backend/schema/prompt: [ai-review-visuals.mjs](./server/ai-review-visuals.mjs),
  [ai-review.mjs](./server/ai-review.mjs).
- Existing prepare/worker/persistence integration:
  [ai-review-prepare.mjs](./server/ai-review-prepare.mjs),
  [ai-worker-core.mjs](./server/ai-worker-core.mjs),
  [ai-review-jobs.mjs](./server/ai-review-jobs.mjs).
- Version/cache capability: [ai-config.mjs](./server/ai-config.mjs),
  [ai-engine-version.mjs](./server/ai-engine-version.mjs).
- Render/preview/style: [AIVisualBlocks.tsx](./src/AIVisualBlocks.tsx),
  [AIReviewArticle.tsx](./src/AIReviewArticle.tsx),
  [AIEvidenceRail.tsx](./src/AIEvidenceRail.tsx), [styles.css](./src/styles.css).
- Offline checks: [check-report-visuals.mjs](./scripts/check-report-visuals.mjs),
  [check-report-visuals-browser.mjs](./scripts/check-report-visuals-browser.mjs),
  [check-report-source-ids.mjs](./scripts/check-report-source-ids.mjs) (updated
  expected prompt version). Documentation: this file and the current entry in
  [README-PRO.md](./README-PRO.md).

## Verification scope

Targeted offline scripts cover every union, empty/missing visuals, sent/unread or
foreign sources, unique/ambiguous cid, metadata paths, comment duplicates, byte
aliases/duplicates, image limits/relations, invalid block with valid article,
cache partial retention, durable finalization via fake query adapter, unchanged
output cap, and provider finish/JSON errors through a fake HTTP responder.

Local Chromium with every API mocked covers desktop/mobile, keyboard topic bars,
correct comment/image/metadata viewer targets, no duplicate rail thumbnails,
image failure, partial notice, old/empty reports and refresh with zero POSTs.
External requests are aborted. Typecheck/build are also required.

These are mock checks only. No real model output quality, live provider behavior,
production DB round-trip or rollout compatibility on the VM has been verified.
No large test suite, crawl, SMTP, production data change, commit/push/deploy or
service restart is part of this work.

Final local result: both offline report scripts, Chromium fixture checks,
`npm run typecheck`, `npm run build`, server syntax checks and `git diff --check`
passed. Build staging contains the new server validator. Temporary browser harness
files were removed and the local Vite process stopped. No real model or production
DB/service was used.
