# 问问 DiDi · product snapshot Q&A

Implemented on `fix/ai-flow-node-pg`: Node 22+, PostgreSQL, existing verified account/Pro entitlement, immutable `ai_jobs` / `ai_comments` / `ai_images` and React. No QwenWork Pages runtime assumptions. The report prompt, schema, model configuration, report worker and generation pipeline are unchanged.

## Storage and HTTP

[009_product_chat.sql](./migrations/009_product_chat.sql) adds conversations, ordered request/message pairs, provider attempts and chat-only model cooldowns. A conversation binds owner + report job + run + immutable input hash + report hash, retaining a copy of its report context. Each request row retains the complete user message and, when successful, its assistant text and typed references. Failed/cancelled messages remain stored. Deleting the owning account/run/job cascades to its chat.

- `GET /api/ai/jobs/:job/chat`: reads the current report's conversation without creating one or invoking inference.
- `POST /api/ai/jobs/:job/chat`: `{requestId: UUID, question, useImages: boolean}`. Creates only durable queue state. Identical replays resolve the original request; reuse with different content/owner/job is rejected. Same-conversation active requests are prevented by a partial unique index; owner row locking serializes submissions and chat quota checks.
- `POST /api/ai/jobs/:job/chat/:requestId/cancel`: cancels pending/running work. Repeated cancellation is harmless. A cancelled running request retains its processing slot until worker acknowledgment or lease expiry.

All endpoints pass through existing fixed-origin/CSRF checks and verified effective-Pro authentication; database owner checks apply to every read/write. Free users retain the existing upgrade dialog. Chat has its own rate/turn/concurrency/request limits and never updates report quotas, attempts, cache, cooldowns or model cursor. HTTP does not do inference. No conversation is stored in localStorage. Chat errors do not modify reports.

## Worker, evidence and budget

Run [chat-worker-start.mjs](./server/chat-worker-start.mjs) as a **separate supervised persistent process**, using the same environment-loading rules and worker direct PostgreSQL connection as [worker-start.mjs](./server/worker-start.mjs). The separate tables and `product-chat-v1` protocol prevent old report workers from claiming chat. `AI_WORKER_JOB_ID`, when set, also scopes chat to that report job. Report worker startup/readiness is unchanged; chat startup checks migration 009 separately.

The chat worker uses the existing ordered operator model allowlist, official/documented capacity configuration, model identity and provider error classification. It only falls back for the existing exact provider error pairs, to a model still allowed by the current configuration, with the identical payload. It does not retry ambiguous network failures, invalid output or cancelled/interrupted requests. Each dispatch intent is recorded before the provider call. Running leases are renewed every two seconds; expiry becomes a visible failure and is never automatically dispatched again. Cancellation aborts the fetch/response stream when possible; a provider may already have consumed input before receiving cancellation. No automatic replay claims an exactly-once guarantee at the remote provider.

The [chat prompt, schema and budget](./server/ai-chat-context.mjs) are separate from reports. Every question sends **all immutable snapshot comments** or fails the conservative budget check before calling a model. Metadata, report and selected completed history are included as untrusted data. Reports/history are reference context, never primary evidence. No tools or crawling are provided. Answers follow the question's language, defaulting to simplified Chinese.

Text questions send no image pixels by default. The explicit image option ranks already stored images by question overlap with their linked original comments, then uses at most the configured image count. The worker reads only previously validated stored bytes, rechecks hash and reuses the existing `validateImage` MIME/byte/pixel/dimension validation, and uses the existing provider-compatible Base64 image representation. It never downloads/crawls on chat. This ranking is a relevance heuristic, not an exhaustive visual search. All comment–image links and image availability are included; only images actually transmitted can be cited. The displayed scope gives all-comment coverage, actual selected/total image count and included/omitted history counts. Even if the selected count equals the image total, the UI conservatively labels the selection. Unavailable images are not represented as seen.

Only the latest configured number of completed history turns goes to the model; every message stays in PostgreSQL and remains readable. Oversized history/source/context is rejected rather than silently truncated. The UTF-8 byte token upper bound, framing reserve, documented image token upper bound, output tokens, exact serialized request bytes, image limits and Data URI bytes are checked against both the chat cap and confirmed model capacity. Unknown model capacity fails closed. This is conservative budgeting, not an exact tokenizer.

Responses are strict JSON `{text, references:[{type:'comment'|'image', id}]}`. IDs are validated against the exact input, then again against the owned snapshot at read time. React renders plain text. References call the existing comment/image evidence dialog; viewer behavior is unchanged. This validates membership, not the semantic correctness of every model statement. Account/report/snapshot changes remount chat and abort its UI requests; cancelled/late worker output cannot commit over another turn/report. Default worker logs contain readiness only, no full conversations, provider bodies or credentials. Actual model, usage and sanitized failures are stored server-side.

## Configuration

All new settings are server-only; examples are in [.env.example](./.env.example). No provider/model/endpoint/key setting is added or changed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_CHAT_WORKER_ENABLED` | `false` | Explicit chat inference opt-in |
| `AI_CHAT_CONCURRENCY` | `1` | Database-wide running chat ceiling across worker processes |
| `AI_CHAT_USER_MAX_ACTIVE` | `1` | Pending/running/stopping turns per owner |
| `AI_CHAT_MAX_QUESTION_CHARS` | `2000` | Server question length limit |
| `AI_CHAT_MAX_TURNS` | `60` | Stored turns per report conversation |
| `AI_CHAT_DAILY_TURNS` | `100` | Submitted turns per owner per rolling 24 hours |
| `AI_CHAT_RATE_PER_15_MIN` | `20` | Accepted new turns per owner per 15-minute window |
| `AI_CHAT_HISTORY_TURNS` | `8` | Latest completed turns sent, all others retained |
| `AI_CHAT_CONTEXT_TOKENS` | `100000` | Conservative input + output token upper-bound cap |
| `AI_CHAT_OUTPUT_TOKENS` | `2048` | Response token cap |
| `AI_CHAT_MAX_IMAGES` | `4` | Saved-image selection maximum when explicitly requested |
| `AI_CHAT_MAX_PROVIDER_REQUESTS` | `3` | Total dispatches including allowlisted fallback per turn |

Each chat worker process runs one turn at a time; multiple supervised instances may run up to the database-wide chat ceiling. These slots are independent of report-worker slots.

## Future VM update (not performed)

1. Back up PostgreSQL using the existing operations procedure. Install the reviewed source/dependencies into the existing release directory; retain the current private environment, database, SMTP, model allowlist and keys. No bootstrap/account or password commands are needed.
2. Run the existing explicit migration command `npm run migrate` **once**, with the VM's existing private environment loaded. It applies only unapplied migrations, including 009. Do not run migrations in HTTP or point a development command at production accidentally.
3. Build the reviewed client (`npm run build`) and restart the existing Web service using its actual service name/configuration. No concrete systemd unit names are committed in this repository, so none are assumed here. The existing report service continues using `node server/worker-start.mjs` unchanged.
4. Add a supervised chat service by copying the existing worker service's runtime user, working directory, Node binary, private `EnvironmentFile`, restart policy and direct database configuration. Change only its command to `node server/chat-worker-start.mjs` (or `npm run ai:chat-worker`). Keep `AI_CHAT_WORKER_ENABLED=false` for readiness checks. Do not run this command inside the HTTP handler.
5. After explicit AI spending authorization, set `AI_CHAT_WORKER_ENABLED=true` in that service's existing protected configuration and start/restart **the chat service**. Do not change existing `AI_WORKER_ENABLED`, models, endpoints or keys. Check sanitized chat readiness, then manually ask a small question on an authorized Pro report. Refresh must not dispatch again. Disable/stop the chat service to pause chat; stored conversations/reports remain.

## Verification and limits

The targeted [mock check](./scripts/check-product-chat.mjs) refuses non-loopback/non-disposable databases and replaces `fetch` with a throwing function. It uses a fresh empty database named `ddv_chat_check`, applies migrations **only there**, creates disposable fixtures, and covers authentication/Pro/email/account status, CSRF/ownership, idempotency, order/concurrency, image relationships/references/budget, refresh without inference, actual abort and late response rejection, expired leases and changed-report isolation. Never run it against an existing application database.

```sh
# Supply only the address of a NEW disposable local database, no production env.
NODE_ENV=test AI_PROVIDER=mock APP_BASE_URL=http://localhost:3000 \
 DATABASE_URL=postgresql://postgres@127.0.0.1:DISPOSABLE_PORT/ddv_chat_check \
 node scripts/check-product-chat.mjs
```

No real AI, crawling, email, production migration, commit, push or deployment was performed for this feature. Real multilingual answer quality, provider-side billing/cancellation, live fallback and browser/mobile/IME interactions require later manual acceptance. Existing report behavior is protected by leaving its pipeline files unchanged; the large regression suite was intentionally not run.


## Changed files and completed checks

- UI: [AIChat.tsx](./src/AIChat.tsx), [AIReport.tsx](./src/AIReport.tsx), [styles.css](./src/styles.css).
- API/context/provider: [ai-api.mjs](./server/ai-api.mjs), [ai-chat-api.mjs](./server/ai-chat-api.mjs), [ai-chat-context.mjs](./server/ai-chat-context.mjs), [ai-chat-provider.mjs](./server/ai-chat-provider.mjs), [ai-chat-transport.mjs](./server/ai-chat-transport.mjs).
- Worker: [ai-chat-worker-core.mjs](./server/ai-chat-worker-core.mjs), [ai-chat-worker.mjs](./server/ai-chat-worker.mjs), [chat-worker-start.mjs](./server/chat-worker-start.mjs).
- Storage/config/checks: [009_product_chat.sql](./migrations/009_product_chat.sql), [.env.example](./.env.example), [package.json](./package.json), [check-product-chat.mjs](./scripts/check-product-chat.mjs), and this document.

Completed locally: `npm run typecheck` once (passed), `npm run build` once (passed), server-module syntax checks, `git diff --check`, and the targeted mock check against a fresh temporary PostgreSQL 17 container. The final mock pass includes the existing safe image validator. The container/database were removed afterward. No broad test suite was run. Browser/IME/mobile interaction and real provider execution remain unverified.
