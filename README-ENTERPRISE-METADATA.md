# Enterprise metadata verification — 2026-11-24

## Result

New real collection batch: http://localhost:3001/enterprise?research=441753f4-a5cf-4213-9b22-0c45631b26f4

Created through the local UI against Docker PostgreSQL on loopback 5432. Both
product Document requests returned access verification in this run. Both listings
are paused (`challenge_detected`), their collection tasks ended as failed with
that code, and reload performs no retry. There is **no successful new collected
snapshot** for this batch and no new report/chat/model task. No Qwen request was
made. Do not describe the browser-only data below as collected snapshot data.

The previously completed real Qwen report remains readable, with its original
four accepted observations and sources:
http://localhost:3001/enterprise?research=7fc5774f-61ea-4ad6-aaab-43730e8e30e2&enterpriseReport=33afe10a-0bc0-422b-9d29-a0aa02d51a7a

## Source observations and before/after

Chrome response listeners and comment/review-image blocking were installed before
navigation. An initial 30119333 navigation returned Verification; a later bounded
ordinary navigation returned the product. 24193243 also rendered normally. The
browser received public callback response bodies without solving a challenge.
No source script was evaluated by the parser, and no cookie/session/header data
was saved to fixtures or transferred into the collector.

The “old batch” below is e6ff547b-5ddb-41dc-9d1a-d12c403778b0. It is not rewritten.
“Parser” means sanitized document fixture verification, not a successful new live
batch. Publication values below were also present in the previously captured
product document fragments.

| Group | 30119333 | 24193243 |
|---|---|---|
| Product / edition | 洪业：清朝开国史（修订版）（当当专享特装版）; ISBN 9787513364119. Edition labels derive from the unchanged title, with title provenance. Old batch had title/ISBN but normalized edition null. | 洪业：清朝开国史（增订版）; ISBN 9787513323802. Same title-derived edition rule; old normalized edition null. |
| Byline / publishing | 魏斐德; translators 陈苏镇、薄小莹等; 新星出版社; 2026年11月. Document `.messbox_info`; current parser supports these, old batch normalized values null. | Same author/publisher/translators; 2017年03月. Document `.messbox_info`; old batch normalized values null. |
| Specifications | 16开 / 精装 / 是否套装 否; paper remains unknown because source row empty. Document `#detail_describe li`. | 16开 / 精装 / 胶版纸 / 是否套装 否. Same DOM source. |
| Shop | 新星出版社当当自营店, store.dangdang.com/258 from `#service-more .title a`; shopId=0, ddShopId=258, supId=19640 separately from prodSpuInfo. Title also declares 当当自营; no fabricated shop name from title. Old batch had IDs only. | Same confirmed shop/IDs; title does not independently declare self-operation, shop DOM does. Old batch had IDs only. |
| Price | Initial Document #dd-price/#original-price = 168/168, labels 当当价/定价. Chrome product-info salePrice=138, originalPrice=168; rendered #dd-price=138. Old snapshot remains 168/168. Dynamic 138 **not imported into collector data**. | Document and rendered DOM 118/118. Chrome product-info salePrice=118, originalPrice=118. These are two distinct fields with equal values, not one field copied twice. Old snapshot already 118/118. |
| Promotions | Chrome product-info p102 / promoId 6575370 / 限时抢 / directPrice138; July 1–Dec 31 2026 as source strings. Browser-only; public Node HTTP returned verification. | Chrome product-info: 6577917 满额减（每满¥100减¥50）; 6577930 满1件打6折; 6053522 ebook add-on, separate product1900676918, not a seller of this edition. Browser-only, conditions not treated as unconditional checkout prices. |
| Stock / region / shipping | Chrome stockStatus1 / stockType realStock are raw codes, not a quantity. transfer returned default 北京/北京市/昌平区/城北街道 and warehouse reference30. No verified shipping fee, arrival time or stock quantity; promise returned empty data. Not saved as zero. | Same raw stock code/type and transfer default address/warehouse. Promise returned HTML, but field-level shipping semantics not captured/verified; no fee/time inferred. |
| Service conditions | score-service publicly readable through Node HTTP: gift wrap18/order, optional card2; 15天换货; 支持7天无理由退货; 差价返还. New extractor + snapshot mapping verified offline; live batch Document was challenged before this step. Gift-wrap charges are **not shipping fees**. | Chrome shows same service declarations; same schema is tested for this listing identity. No successful service request for this listing in the new live batch because its Document was challenged. |
| Variants / other sellers | spu-prod data empty string; no concrete SKU/variant records established. #sellers_list empty/hidden, template placeholders excluded. other_sellers_count/offers stay null. | Same. Neither null nor an empty response string establishes “no other shops”. |
| Description / official images | Chrome detail contains content, editorial recommendation, catalog and official feature image. Browser-only. Static cover +8 gallery images already saved; new UI exposes gallery/source. | Chrome detail contains content, recommendation, catalog and feature image. Browser-only. Static cover +2 gallery images already saved; new UI exposes gallery/source. |
| Categories | #detail-category-path gives 图书>历史>中国史>明清史; embedded category50958/path01.36.04.07.00.00. New parser prefers full category DOM over breadcrumb with a truncated title. | Same primary category plus 图书>文化>传统文化>其他 in category DOM. |

These are different ISBNs/editions, not two shops offering the same SKU. No
platform seller count, sales, market share, exact inventory or comparable-edition
price spread is inferred.

## Dynamic extractor ledger

| Route | Browser response | Public collector HTTP verification | Runtime extractor |
|---|---|---|---|
| callback/product-info | Both JSON schemas verified, prices/promotions/raw stock codes | 30119333 and24193243 returned non-JSON verification | Disabled; browser-only fixture |
| callback/score-service | Both service HTML responses observed | 30119333 JSON/service HTML succeeded twice | Enabled, one bounded request following a valid Document |
| callback/transfer | Both JSON, default region/warehouse context | 30119333 non-JSON/unrecognized HTML | Disabled |
| callback/detail | Both JSON with data.html; named product sections verified | Both Node HTTP attempts non-JSON/verification | Disabled; no entire #detail scraping (contains recommendations) |
| callback/get-bang-rank | 30119333 JSON 历史新书 rank6;24193243 response not parsed | 30119333 verification | Disabled; no seller interpretation |
| callback/get-promise | 30119333 empty data;24193243 HTML, field semantics incomplete | 30119333 non-JSON/unrecognized HTML | Disabled |
| callback/spu-prod | Both data empty string | 30119333 verification | Disabled; variants remain unknown |

No guessed dynamic endpoint or unverified parameter is requested. The new
score-service request copies the observed parameter names and the current
Document's own numeric prodSpuInfo values, requiring matching product identity.
No cookies are forwarded. It has an8-second timeout,100KB response cap, no automatic
retry, and failure retains the valid Document metadata. Challenge access is not
bypassed. Actual response outcome/status/type/size/time is retained without body.

## Changed files

- [enterprise-product](./server/enterprise-product.mjs): verified service request
  parameters, bounded field extraction from inert service HTML, response source
  validation/path/time, distinct callbacks' capability/outcome states, fuller
  categories and explicit DOM/embedded paths. Additional business flags remain
  raw extra metadata, not inferred availability or quantity.
- [enterprise-worker](./server/enterprise-worker.mjs): additive collection-only
  service read. Existing report inference/validation/retry/model logic unchanged.
- [snapshot context](./server/enterprise-context.mjs): coverage wording reflects
  observed service sources in new snapshots; no prompt/schema/inference change.
- [Enterprise UI](./src/Enterprise.tsx), [styles](./src/styles.css): compact metadata
  details, translator/paper/combo/official gallery, service/source diagnostics,
  response-source viewer. Existing observations remain available. No rewriting
  of legacy reports or batch fields.
- [metadata fixtures](./tests/fixtures/enterprise-metadata/): stripped service DOM
  and selected browser business JSON/snippets. Browser-only fixture is explicitly
  labelled and is not a runtime extractor or a saved production snapshot.
- [metadata checks](./scripts/check-enterprise-metadata.mjs),
  [UI checks](./scripts/check-enterprise-metadata-browser.mjs), and the capability
  assertion in [existing checks](./scripts/check-enterprise.mjs).

No migration or new configuration is needed. Future reports freeze the new
observations through the existing snapshotDocument path; the fixture verifies
this without creating report tasks. Since the real new batch obtained no
Document data, this turn cannot demonstrate newly collected service observations
in a real stored report snapshot.

## Verification / local operations

Passed: metadata fixtures, Enterprise/access/report fixtures, metadata UI source
buttons for both identities, missing fields, desktop/mobile overflow and refresh
without POST; typecheck and build. Real UI verified new batch paused0/2 across
refresh, generation disabled, and the old real Qwen report/source viewers still
readable. Hash comparison:6 old non-collection tasks,10 old snapshots,4 old listing
data records unchanged. New provider requests:0.

Web remains http://localhost:3001 using Docker PostgreSQL5432. The explicitly
collection-only local runner finished and exited; report/chat workers remain off.
No pending report backlog was run. No deployment, migration, production access,
commit or push. For later VM updates use the existing release/services procedure,
rebuild web and restart web/report worker from the same checkout so the existing
Enterprise engine fingerprint matches; this was **not performed** here.
