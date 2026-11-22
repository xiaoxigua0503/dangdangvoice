# 问问 DiDi · product snapshot Q&A

Current implementation: Node 22+, PostgreSQL and persistent VM chat service **`dangdangvoice-chat-worker`**, with its own durable queue. Entry remains [chat-worker-start.mjs](./server/chat-worker-start.mjs). Report workers, report prompt/schema/pipeline, authentication, account entitlements, saved reports and collection workflows are unchanged. No QwenWork Pages runtime assumptions.

## Conversations, compatibility and API

[009_product_chat.sql](./migrations/009_product_chat.sql) stores owner + report job + run + immutable input hash + report hash, report reference context, ordered request/message pairs, attempts and chat-only cooldowns. [010_chat_sessions_evidence.sql](./migrations/010_chat_sessions_evidence.sql) adds explicit sessions, selected image IDs and optional purchase purpose. Migration 010 assigns every existing message to its original conversation's initial session without rewriting questions, answers, references or reports. New sessions keep all previous sessions readable. Total turns per report, daily quota and rate limits still apply across sessions.

- `GET /api/ai/jobs/:job/chat[?session=UUID]`: reads current-report chat, session list, saved image catalog and reference provenance. Without a session parameter, reads the latest session. Does not create a conversation or inference.
- `POST .../chat/preflight`: `{requestId: UUID, question, imageIds: string[], purpose, sessionId?}`. Validates owner/snapshot images, complete input and primary-model budget, without creating any conversation, request, quota usage or model call.
- `POST .../chat`: same body. Repeats preflight in the submission transaction before queueing. Identical replay returns the original request, including after cancellation. Conflicting reuse is rejected. Client URLs are never accepted; image IDs must belong to the owned report snapshot. Unknown/unavailable/duplicate/excessive selected images fail, never silently disappear.
- `POST .../chat/sessions`: `{sessionId: UUID}` explicitly creates an empty session with no inference. Idempotent. No automatic session creation on report/history reads. New session retains the composer draft; sessions remain selectable.
- `POST .../chat/:requestId/cancel`: cancels pending/running work. A cancelled running request holds its slot until worker acknowledgment or lease expiry.
- `GET .../chat/evidence?comment=ID|image=ID`: chat-only provenance viewer. Reports keep their original viewer and evidence behavior.

All endpoints reuse fixed-origin/CSRF checks, verified effective-Pro authentication and owner checks. The Free upgrade mechanism is unchanged. A unique active-request index and owner row lock preserve order/concurrency and idempotency. Chat never writes report quotas, attempts, cache, cooldowns, model cursor or report content. No localStorage chat source. Changing product/account/snapshot remounts chat and aborts old UI requests; source loads have their own abort protection.

New requests use `product-chat-v2`; new workers claim both v1 and v2. Old chat workers filter for v1 and cannot claim the new explicit-image/citation protocol. Existing v1 requests and messages remain supported. Pending legacy v1 image requests retain their original configured selection behavior; newly submitted turns always persist explicit image IDs. Updating Web and the existing chat service together is required.

## Natural conversation and source awareness

The [chat-only prompt](./server/ai-chat-context.mjs) handles greetings, ordinary typos/homophones and follow-up context naturally, without an intent-regex patch list. Clear “你还在马” intent is treated as “你还在吗”; genuinely ambiguous intent gets a short clarification. Greetings need no product citation. Language follows the user's current message. Optional purchase purpose is `unspecified` (default), `beginner`, `research`, `gift` or `collection`; changing it or selecting an image never sends a question or invokes AI.

The input distinguishes:

- `metadata`: unverified seller information.
- `comments`: original buyer comments, preserving text, detail URL, actual variant and source product ID when extractable from the existing URL.
- `reportReference`: explicitly marked previous AI output, not original evidence.
- `history`: previous AI answers with their planned/confirmed image scope where available; never self-authenticating original evidence. Legacy unknown scope remains unknown.
- Current images: exactly the selected saved pixels attached this turn; image catalog/URLs alone are not visual observations.

With zero current images, the prompt prohibits “图片展示了…” as a fresh observation. Reusing an old report's description must be attributed, e.g. “此前报告提到……，本轮未重新查看图片”. Earlier AI image descriptions cannot verify themselves; reselect the original image to inspect it. No semantic wording-regex validator or whole-answer repair was added. These are prompt/source-contract protections; real model adherence remains unverified.

Dangdang may group variants. A comment for another product ID is **not automatically wrong**. Chat preserves `targetProductId`, `sourceProductId`, `detailUrl`, `variant` and displays “可能为其他版本／版本未确认” or “版本未确认”. Neither matching IDs alone nor a nonempty variant string proves an exact edition mapping. Shared content experiences may inform cautious guidance; an unconfirmed variant cannot establish sprayed edges, signatures, cover material, gifts or packaging of the currently sold special edition. No version mapping or crawling is invented. These badges are restricted to chat context and chat's viewer.

All source/user text is untrusted and cannot override system instructions or request tools/secrets. There are no crawling/tools in the chat worker.

## Explicit images, citations and compact UI

The picker shows already stored thumbnails, an exact selected count and up to four images (or a smaller configured chat limit). Selection order/IDs are preserved. “问问 DiDi” on a thumbnail or chat image viewer puts that image and a suggested question into the composer **without sending it**. Available bytes are read from PostgreSQL, hash checked, and passed through the existing safe `validateImage` MIME/byte/dimension/pixel validator. No new download occurs and report image limits do not change.

New answers are strict JSON `{text, references:[{citation:1, type:'comment'|'image', id}]}`. Each `[n]` maps to an explicitly stored source; duplicate sources, conflicting numbers, unknown markers and invalid IDs fail validation rather than triggering repair. Only current comments/current transmitted images may be cited. IDs are checked again on reads. The renderer supports line breaks and simple lists, with React text nodes and citation buttons, no raw HTML. Existing messages without a stored numeric mapping show clearly named source buttons; their old `[1]` text is not guessed to mean the first reference. Repeated use of one citation does not add duplicate footer buttons.

Header is “正在讨论：《商品名》”. Per-turn counts, history window, purpose, model, UUID and source-version details live in “本轮依据”. Missing/unreadable images, source limitations and budget errors remain directly visible. Planned input is distinguished from confirmed delivery: failures/legacy scope do not claim delivery. Mock delivery is explicitly labeled as mock, never as a real model receiving images. Stop/retry, uncertain-submit idempotency, Enter/Shift+Enter and composition handling remain in place.

## Budget investigation and preflight

The previous budget code does **not** tokenize base64 as text or count images twice. History contains questions/answers, not repeated complete snapshots/reports. The separate default chat ceiling is **100,000** versus the repository's documented primary-model **1,000,000** context. The documented conservative per-image maximum is **16,386**; four images reserve **65,544**. Framing reserves 8,192 and output defaults to 2,048, leaving **24,216** for all text, including prompt, full comments, report and history. A 78-comment/6-history-turn/4-image input can therefore exceed the chat cap while fitting the model's context. Exact production payload/environment was not accessed, so the specific historical request's budget cannot be reconstructed from those counts alone.

No limit was raised and no model/endpoint/key was changed. Budget now reports distinct causes: unverified model configuration, chat context cap, model context cap, request bytes, image count, single-image Data URI size and output configuration. `chatBudget` exposes text bytes, single-count image reserve, framing, output, request bytes and both context ceilings. Base64 contributes only to exact HTTP request bytes. UTF-8 byte token estimates are intentionally conservative, not an exact tokenizer. Unknown limits fail closed.

Preflight runs before enqueue **and** before model dispatch. A capacity problem never selects another model or silently removes comments, chosen images or history. User can deselect specific images or explicitly start a new session while preserving the draft and all stored history. The configured window (default latest 8 completed turns in that session) is disclosed before send and in each turn's basis; omitted older turns remain stored/readable. All immutable comments are always included or the request is rejected. Source/report sample limitations remain visible. No conclusion about all site comments may be drawn from a snapshot subset.

Existing fallback remains restricted to the operator's configured allowlist and exact existing provider error classification. A provider failure may switch only under that bounded policy with identical input. Ambiguous network failures, invalid output, cancellation and expired leases are not automatically redispatched. Dispatch intent is persisted before each provider call; lease renewal checks account entitlement every two seconds. Cancellation aborts transport when possible; the provider may already have consumed input. Actual model, usage and sanitized failure are stored server-side; default logs omit conversation contents, credentials and raw provider responses.

## Configuration (unchanged defaults)

All settings are server-only, in [.env.example](./.env.example); no new environment variable is required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_CHAT_WORKER_ENABLED` | `false` | Explicit chat inference opt-in |
| `AI_CHAT_CONCURRENCY` | `1` | DB-wide running chat ceiling |
| `AI_CHAT_USER_MAX_ACTIVE` | `1` | Pending/running/stopping owner turns |
| `AI_CHAT_MAX_QUESTION_CHARS` | `2000` | Question length |
| `AI_CHAT_MAX_TURNS` | `60` | Total stored turns across report sessions; also session-count ceiling |
| `AI_CHAT_DAILY_TURNS` | `100` | Rolling 24-hour owner submissions |
| `AI_CHAT_RATE_PER_15_MIN` | `20` | Accepted owner turns per window |
| `AI_CHAT_HISTORY_TURNS` | `8` | Latest completed turns sent in selected session |
| `AI_CHAT_CONTEXT_TOKENS` | `100000` | Conservative input + output cap |
| `AI_CHAT_OUTPUT_TOKENS` | `2048` | Output cap |
| `AI_CHAT_MAX_IMAGES` | `4` | Explicit image maximum, clamped to 1–4 for new turns |
| `AI_CHAT_MAX_PROVIDER_REQUESTS` | `3` | Total bounded dispatch/fallback budget |

## Future VM update — not performed

Use the existing release/backup procedure, private environment/configuration, database and service identities. Apply the normal explicit `npm run migrate` with the VM's existing environment, which adds unapplied migration **010**, never in an HTTP request. Build the Web release, then update Web and the existing **`dangdangvoice-chat-worker`** together so v2 requests reach a v2-capable worker. Retain its existing runtime user, working directory, Node command, environment file, restart policy and direct PostgreSQL connection. No new service is needed. The chat command remains `node server/chat-worker-start.mjs` / `npm run ai:chat-worker`; report service remains unchanged.

Do not reset accounts, copy development data, change keys/models/endpoints, or alter existing spending authorization/worker-enable settings. Only restart/deploy when explicitly authorized. This work did not migrate or restart production.

## Verification and changed files

Targeted PostgreSQL mock check: [check-product-chat.mjs](./scripts/check-product-chat.mjs). Refuses non-loopback/non-disposable databases and forbids `fetch`; uses a fresh empty `ddv_chat_check` DB and applies migrations only there. Covers owner/Pro/email/status/CSRF, idempotency/concurrency/cancel/late output/lease, no-image delivery scope, exact selected images/foreign IDs, provenance, no duplicate image budgeting/base64 tokens, preflight without queue creation, new sessions/history and legacy citation compatibility. Real model answer quality is not checked by this mock.

Local browser check: [check-chat-browser.mjs](./scripts/check-chat-browser.mjs), with loopback Vite and installed Chromium only. It creates/removes temporary harness files, mocks every API/image request and blocks non-loopback requests. Covers picker/max4, image question draft, purpose/no inference, IME/Enter/Shift+Enter, explicit citation→comment viewer, source version, old mapping fallback, preserved draft on preflight rejection, new session/refresh without inference and 390/1280px layout.

```sh
# Fresh disposable loopback database only, never an app/production database:
NODE_ENV=test AI_PROVIDER=mock APP_BASE_URL=http://localhost:3000 \
 DATABASE_URL=postgresql://postgres@127.0.0.1:DISPOSABLE_PORT/ddv_chat_check \
 node scripts/check-product-chat.mjs
# With local Vite running; uses /usr/bin/google-chrome unless overridden:
CHAT_CHECK_BASE_URL=http://127.0.0.1:4174 node scripts/check-chat-browser.mjs
```

Changed: [010 migration](./migrations/010_chat_sessions_evidence.sql); [chat context](./server/ai-chat-context.mjs), [API](./server/ai-chat-api.mjs), [worker core](./server/ai-chat-worker-core.mjs), [worker readiness](./server/ai-chat-worker.mjs); [AIChat](./src/AIChat.tsx), [answer renderer](./src/AIChatAnswer.tsx), [chat-only viewer](./src/AIChatEvidence.tsx), [AIReport integration](./src/AIReport.tsx), [styles](./src/styles.css); both check scripts and this README. Existing migrations and stored report content are unchanged.

No large suite, real provider inference, crawl, email, production migration/restart, commit, push or deployment. Production typo interpretation, answer quality/language, accurate visual reasoning, live fallback/billing and remote cancellation still need future real-provider acceptance. Mock checks do not prove these behaviors.

Completed in this source revision: TypeScript typecheck and production build passed; final targeted PostgreSQL 17 mock and local Chrome checks passed; `git diff --check` passed. The temporary PostgreSQL container and browser harness files were removed and the local Vite process was stopped. These checks used mock responses only and do not verify real AI understanding or visual-answer quality.
