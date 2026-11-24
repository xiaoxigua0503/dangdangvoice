> Current collector and existing VM service update: [VM release](./README-ENTERPRISE-RELEASE.md). Earlier validation notes below describe their respective historical runs.

# Enterprise market research — Node / PostgreSQL / VM

Enterprise is a third, separate plan. Its `/enterprise` workspace collects public
product pages, saves research batches and immutable report snapshots, runs one
market-analysis request per durable attempt, and provides report-bound DiDi.
`/app` routes Enterprise users to the same workspace. It does not show the buyer
comment dashboard. Free/Pro keep their existing workspace and APIs. Enterprise
does not silently grant Pro access or mix their report/chat histories.

No production migration/deployment/restart, live Dangdang crawl, real AI request
or mail was performed. This implementation was checked with synthetic HTML,
mock fetch/model responses, local Chromium and a disposable PostgreSQL 17 cluster.

## Account and installation

New additive migration: [012_enterprise.sql](./migrations/012_enterprise.sql).
It extends the plan check to `free/pro/enterprise`, adds optional upgrade-request
`target_plan` (old requests default to Pro), and creates separate batch/listing/
snapshot/task/conversation/attempt/cooldown tables. Existing Pro tables and data
are not rewritten. Composite foreign keys bind owner, batch, snapshot, report
and conversation; triggers make snapshots and task input/config/context immutable.

Grant/revoke through the existing protected Admin UI or local CLI, using the
VM's existing private configuration (never paste secrets into a command/log):

```sh
npm run ai:admin -- grant-enterprise account@example.com
npm run ai:admin -- grant-enterprise account@example.com 2027-12-31T00:00:00Z
npm run ai:admin -- revoke-enterprise account@example.com
```

Admin has an Enterprise grant button, shared expiry field, request approval and
audit path. The existing `pro_expires_at` / `proExpiresAt` names remain compatible
and now also carry Enterprise expiry. The upgrade dialog defaults to Pro and can
request Enterprise. Renewing the same plan does not cancel work. Revoking,
disabling or changing plans stops active work; completed snapshots/history remain.

Future authorized VM update:

1. Back up using the current procedure; drain in-flight Pro/Enterprise work under
   its matching release. Do not rewrite old task configs or auto-clone backlog.
2. Run the normal explicit migration command with the current protected VM
   environment. Apply unapplied migrations, including 012, **before** new Web code.
   No migration is run inside HTTP requests.
3. Build/install the reviewed release with the current Node/PostgreSQL setup.
   Update Web, the existing report-worker service and `dangdangvoice-chat-worker`
   together. Preserve actual unit names, working directories, environment files,
   runtime user, database connection and enabled/disabled settings. No fourth
   service or queue broker is introduced. Commands stay `npm start`,
   `npm run ai:worker`, `npm run ai:chat-worker`.
4. Web and both worker services need the same Enterprise source fingerprint.
   The report service processes Enterprise collect/report tasks; the chat service
   processes Enterprise chat tasks. Old workers cannot accidentally claim them
   because the queues are separate tables with protocol/engine guards.

The existing report-engine fingerprint also changes when its worker entry changes;
old Pro reports remain readable, and pending older jobs require their matching
release. No old report, snapshot or conversation is regenerated on open/refresh.

## Configuration and limits

Existing model/endpoint/key allowlist, output tokens, fallback rules, maximum
attempts/provider requests and free-quota confirmation are reused unchanged.
Enterprise stores its own attempt counters and model cooldowns; it does not
consume Pro report/chat retry counters. Model concurrency uses existing report
runtime advisory slots; collection has separate bounded slots. Polling the Web
never runs inference. Missing keys prevent model enqueue/dispatch; public product
collection can still run when the report-worker service is explicitly enabled.

| Config | Default / cap | Meaning |
| --- | --- | --- |
| `ENTERPRISE_MAX_LINKS` | 20 / 50 | Nonempty input lines per batch, before deduplication |
| `ENTERPRISE_COLLECTION_CONCURRENCY` | 2 / 2 | Global product-page fetch slots; one active Enterprise task per owner |
| `ENTERPRISE_CHAT_HISTORY_TURNS` | 8 / 12 | Recent stored turns sent as context; UI shows sent/total |
| Existing `AI_WORKER_ENABLED` | existing policy | Report worker + Enterprise collection/report work |
| Existing `AI_CHAT_WORKER_ENABLED` | explicit true | Existing DiDi service + Enterprise DiDi work |

A link has at most five user-triggered collection attempts; monotonic cooldown
20/40/80/120 seconds is persisted and honors Retry-After. No automatic retries of
challenge/GeoBL/access denial. One product GET per attempt, 20-second timeout,
2 MB response cap, no cookies, redirects, browser execution or WAF evasion.
At most one active report per owner, five report submissions per batch/day;
80 writes per owner/15 minutes; 80 stored turns per conversation. One active turn
per conversation. Known retryable provider HTTP responses can retry durably
inside existing budgets; only configured allowlisted model errors can advance
fallback. Lost leases/unknown provider outcomes fail without automatic replay.
Cancellation and entitlement are checked at claim, heartbeat, before dispatch
and before commit. Late responses cannot overwrite cancelled or newer work.

Questions are at most 2000 characters. Source strings are sanitized/bounded to
4000 characters; official gallery/description URL lists to 30 each. Truncations
record field/listing and original/kept scope. Report/chat budget preflight counts
exact JSON bytes plus conservative UTF-8/context framing against current provider
limits, reserving the existing output limit. If it does not fit, enqueue is refused
with an explanation. Inputs/history are not silently sampled or shortened to fit.
History-window limits are declared; all stored turns remain readable.

## Collection / extractor evidence matrix

The fixture [enterprise-product.html](./tests/fixtures/enterprise-product.html)
is **synthetic HTML**, constructed from the user's inspected field values. It is
not a captured response. Production selector compatibility has not been checked.
Each value is saved with field/listing ID, normalized value, sanitized source
value, URL, layer, collection timestamp, region if known and observation status.
Conflicting observations are retained; DOM has first-value precedence in normalized
fields and the model receives all observations. Unknown is `null`, not zero/false
or confirmed empty. Missing fields have addressable `coverage/not_observed`
records; these document absence of observation, not absence of a product feature.

| Layer / extractor | Fields currently handled | Verification / limitations |
| --- | --- | --- |
| Product DOM | name/subtitle, breadcrumb, displayed/list prices and their labels, currency, requested product's visible store link/name/self-operated label | User-supplied values for 30119333 + synthetic fixture; no live selector verification. Strict single-price parsing; ranges stay unparsed with raw source |
| Product specification DOM | ISBN, author/translator/publisher/date/edition/binding/format/paper/combo/gifts; brand/model/barcode/variant; additional public specification fields | Known label mapping, fixture-only coverage; fields absent stay null. Does not infer a name from comments or model output |
| `prodSpuInfo` embedded literal or declared JSON | `productId`, `mainProductId`, `shopId`, `ddShopId`, `supId`, `shopType`, `categoryId`, `categoryPath` | User-inspected IDs reproduced in fixture. Restricted data literal parser, no eval/VM/script execution. Functions/expressions/getters/unsafe keys are rejected. Unsafe-size integer literals remain strings |
| Other embedded business scalars | allowlisted business-name prefixes in `extra_metadata`, with field source IDs | Raw field-name semantics explicitly unverified. No guessing that stock/supplier/etc. names imply confirmed inventory/shop identity |
| Declared Product/Book JSON-LD | name/description/brand/model/GTIN; offer price/currency; aggregate rating count/score | Synthetic typed-data fixture, not callback response verification. Conflicting DOM/JSON prices remain separate observations. No `review` content is read |
| DOM `data-*` | promo ID/type/label/link, explicit edition; scoped product-container identity attributes | Fixture values include promo `6575370`, type `102`, label `限时抢`; no guessed meaning for numeric promo type. Time/threshold/audience/stacking remain null unless actually observed |
| Product-only DOM images | official cover, scoped gallery and description image URLs | URLs only, allowlisted ddimg hosts, no pixels sent to AI. Review nodes are excluded; no comment endpoint/image downloads |
| Delivery/service DOM | explicitly present region/status/fee/time/gift-wrap/returns, seller/fulfillment/after-sales text | Conservative selectors, fixture-only/not production-confirmed. Raw fee/status text is not converted into exact inventory or landed price |
| `#sellers_list` real records | explicit listing ID + actual store link, optional explicit price | Synthetic record test only. Recommendations/ads/templates are excluded. Empty hidden container remains `other_sellers_count=null`, `other_seller_offers=null`; template `sellersCount/minPrice/itemInfo` never become data. Explicit observed count zero is distinct from unknown |
| Observed `get-promise` request parameters | warehouse referenced in an independently supplied observed request | Fixture context verifies `warehouseId=30`; no stock quantity inferred. Runtime collector does not manufacture/execute such a request; field is null without observation. Region names/codes are not guessed |
| `callback/product-info` | none | Response body/parameters/meaning unverified; extractor and fetch disabled |
| `callback/transfer` | none | Response unverified; disabled |
| `callback/score-service` | none | Response unverified; disabled; only product-page aggregate data may be kept |
| `callback/detail` | none | Response unverified; disabled |
| `callback/get-bang-rank` | none | Response unverified; disabled; category ranks not counted as sellers |
| `callback/get-promise` response | none | Request warehouse context does not verify response schema; disabled |
| `callback/spu-prod` | none | Response unverified; disabled; child products/variant prices stay unknown |

For fixture 30119333: `shopId=0`, `ddShopId=258`, `supId=19640` remain separate;
store is `新星出版社当当自营店`, displayed price 138 / `抢购价`, list price 168 /
`定价`, ISBN `9787513364119`, edition `当当专享特装版`. Only the displayed store is
identified; no other seller count is invented from the empty template.

Not yet observed/supported by a verified response extractor: dynamic subtitle or
specifications not present in initial HTML, child-SKU data, member/variant price
conditions, full promotion eligibility/stacking, warehouse stock quantities,
region-dependent delivery responses and complete other-seller feeds. A route name
seen in Chrome does not enable an extractor. Add one only after a body/meaning/
scope fixture is verified. No shop Open API credentials or cross-region bypass.

HTML/scripts, token/cookie/account/tracking keys and contact information are
removed before persistence/model context. Raw bodies/scripts are never logged or
stored. Public author/publisher metadata remains business data, not reviewer
profiling. Source URLs remove credentials, tracking/private query parameters;
input line associations preserve the sanitized entered URL and canonical product.

## Statistics, AI and DiDi contract

Backend statistics distinguish input lines, unique fetched pages, observed sale
records and deduplicated identifiable shops. Supplier IDs never identify shops;
shopId zero never becomes a shop. Conflicting ddShop/store identities are unknown.
Real other-seller records can contribute identifiable shops; template/advertising/
recommendation/category-rank records cannot. Known price numbers and counts are
rendered from backend facts and saved fields, not model-written totals.

ISBN alone does not establish an equivalent edition. Groups require explicit
edition and key book packaging/format/paper/combo/gift data, or adequate nonbook
variant/barcode identity; otherwise remain unconfirmed. Same-family different
editions and category-similar products are distinguished. Price contexts compare
only exact observed conditions within equivalent groups. Unknown conditions split
contexts; single-listing contexts have no asserted price spread. No landed-price
comparison is asserted without known matching region/ship context.

Enterprise uses its own senior-market-research prompt/schema and protocol
`enterprise-market-v1`, plus a source fingerprint captured at process start.
Reports cover all snapshot listings exactly once, with separate scope, competitor
rows, sections and verification questions. Claims carry typed topics, source IDs,
stat IDs and `observed/inference/missing` evidence state. Missing claims must cite
unknown fields; concrete claims need non-null appropriate field evidence. Every
reference must resolve inside the immutable batch snapshot. No fuzzy source match
or source lookup in another batch/account/Pro table.

Narrative does not reproduce numerical prices/counts; it points to backend facts
and field citations. A small numeric guard rejects generated digit/currency/count
literals, rather than repairing them. Backend tables/fact cards render actual
numbers and product names. Source validity is not a guarantee that a qualitative
model judgment is true. Untrusted metadata/user text cannot supply tools, code,
keys or system instructions. Incomplete provider finish reasons or malformed JSON
are not accepted as completed reports. No web search or image vision is claimed.

Report creation freezes successful listings plus explicit failed/rejected/truncated
coverage. Retrying a listing later cannot change that snapshot, report or chat.
DiDi is tied to owner + batch + report task + snapshot + conversation. Focus is
stored per turn, affects question context and never triggers inference itself;
it does not silently filter away the rest of the batch. Report text is AI context,
while factual answers cite saved original fields or backend statistics. Price
answers use collection timestamps and are not real-time price queries. Read/open/
refresh are GET only; conversations are created only on explicit send. Stop,
failed-turn editing, IME, Enter/Shift+Enter and server idempotency are supported.

## Files and checks

- Migration: [012_enterprise.sql](./migrations/012_enterprise.sql).
- New server modules: [enterprise-product.mjs](./server/enterprise-product.mjs),
  [enterprise-context.mjs](./server/enterprise-context.mjs),
  [enterprise-api.mjs](./server/enterprise-api.mjs),
  [enterprise-worker.mjs](./server/enterprise-worker.mjs).
- Integration: [server.mjs](./server.mjs), [accounts.mjs](./server/accounts.mjs),
  [admin-api.mjs](./server/admin-api.mjs), [ai-admin.mjs](./server/ai-admin.mjs),
  [ai-worker.mjs](./server/ai-worker.mjs),
  [ai-chat-worker.mjs](./server/ai-chat-worker.mjs).
- UI: [Enterprise.tsx](./src/Enterprise.tsx), [Entry.tsx](./src/Entry.tsx),
  [Account.tsx](./src/Account.tsx), [Admin.tsx](./src/Admin.tsx),
  [UpgradeDialog.tsx](./src/UpgradeDialog.tsx), [styles.css](./src/styles.css).
- Targeted tests: [check-enterprise.mjs](./scripts/check-enterprise.mjs),
  [check-enterprise-db.mjs](./scripts/check-enterprise-db.mjs),
  [check-enterprise-browser.mjs](./scripts/check-enterprise-browser.mjs),
  [enterprise-product.html](./tests/fixtures/enterprise-product.html).

```sh
node scripts/check-enterprise.mjs
# Fresh, disposable loopback PG only; script creates ddv_enterprise_check.
ENTERPRISE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/ddv_enterprise_check node scripts/check-enterprise-db.mjs
# Against local Vite port 4174; APIs mocked, external requests aborted.
node scripts/check-enterprise-browser.mjs
npm run typecheck
npm run build
```

Checks cover fixture values and source layers, privacy/literal safety, URL and
batch deduplication, edition/condition/unknown-price grouping, duplicate shops,
partial/retry/snapshot coverage, report/DiDi foreign source rejection, missing
fields, auth/CSRF/plan/ownership, admin grant/revoke, durable worker persistence,
cancel and revoked rights before/during inference, refresh without inference,
IME, field viewer targets and desktop/mobile overflow. Existing targeted Pro chat,
report-source-ID and challenge fixtures were also used for regression checks.
No large suite or real provider/crawl/mail request is needed for these checks.

Still unverified: actual production HTML layout, all callback bodies/regions,
real model narrative quality, performance under production concurrent load and
VM rollout. This patch does not claim full-category extraction or reliable access
through Dangdang restrictions merely because fixtures pass.

Final local result: typecheck/build, Enterprise pure fixtures, PostgreSQL 17
integration checks, Chromium mocks, existing Pro chat checks, report-source-ID
and challenge fixtures passed. Batch/report/conversation lists are paginated;
reads and page changes do not create tasks. The final build staging includes the
new server modules and migration. Enterprise forces provider web search off and
never fetches callback/comment endpoints. Local Vite and the temporary PostgreSQL
cluster were stopped after verification. Temporary native PostgreSQL test tooling
was installed outside the repository, not as an application dependency.
