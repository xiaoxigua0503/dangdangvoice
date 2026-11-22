## Current report extension: model-authored visuals v1

The v4 article now optionally carries up to four model-authored structured visual
blocks in the same request. See [AI visual contract, partial validation, offline
checks and VM update notes](./README-AI-VISUALS.md). Current prompt version is
`ddv-product-summary-18-visuals-1`; the source-ID normalization below remains in
place. Earlier change records below describe their respective releases.

## Report source-ID contract fix (summary prompt 17)

Read-only inspection of task `ecc381eb-b1ca-4538-a83f-a4d1899f70ca` confirmed that both immutable prepare/review inputs contain internal `comments[].id` (`C0`…`C11`) alongside `comments[].sourceId`, copied from original `row.cid`, and `comments[].data.detail_url`. Specifically, `379237662` maps to `C0` and `379197532` to `C1`; each URL also ends in the corresponding original cid. Both saved invalid-reference drafts (attempts 288/289, qwen3.8-flash) were checked offline: all 8/12 returned IDs respectively have unique task-local mappings. No production rows were changed and no inference was called.

[ai-review.mjs](./server/ai-review.mjs) now supplies explicit `allowedSourceIds` and a descriptive JSON Schema instead of the ambiguous `sourceIds:["实际来源编号"]` example. The report prompt requires exact internal comment/image IDs and forbids cid/product IDs/ordinals/invented IDs. Result shape remains unchanged. Compatibility normalization accepts an original cid only through exactly one matching `comments[].sourceId` entry in that same immutable input. Valid internal IDs (including allowed image aliases/unread-image IDs) take precedence and remain unchanged; unknown/duplicate/ambiguous aliases reject the entire response. There is no text/URL/fuzzy/external lookup, ID dropping, forced empty array or repair call. Deduplication happens only after every reference validates.

Rejected IDs, their `sourceIds` indexes, candidate counts and reasons are bounded in `validationIssues`, which the existing worker stores in private attempt diagnostics; full source text/secrets are not added to default logs. Prompt version is `ddv-product-summary-17` in [ai-config.mjs](./server/ai-config.mjs). The existing source fingerprint automatically changes because it hashes both modified files; the existing cache key includes engine and prompt hashes. No historical input/task/cache is rewritten or automatically re-enqueued. Fallback/models/endpoints/quotas/retry budgets, UI and chatbot files are unchanged.

Targeted offline verification: `node scripts/check-report-source-ids.mjs` ([script](./scripts/check-report-source-ids.mjs)); covers internal IDs, unique cid, unknown IDs, duplicate/ambiguous cid, internal-ID precedence, mixed comments/images/aliases, deduplication, immutable input and exact serialized request-byte budgeting. No DB/network/model calls in this script. Typecheck/build are required for release; no production migration, deployment or data repair is part of this change.

# Free / Pro 与独立 AI 深度分析

> 当前待验证实现为单次图文综合 v4，见下方“当前待验证实现”一节；保留 UI editorial。更早的 batch/repair/综合阶段说明与验证记录仅为历史，不代表本轮已执行验证。

此扩展沿用现有邮箱登录、验证、HttpOnly 会话、CSRF、用户所属的 `saved_runs` / `saved_comments`。没有第二套账户/历史，没有支付功能。Free 保持完整的基础词典分析、采集、导入导出、本地档案、重试队列、云历史、评论库、声纹和晒图墙。Pro 添加独立的“AI 深度分析”视图，不把 AI 结论混入基础仪表盘。


## 当前待验证实现：单次图文综合 v4

本节取代下方历史版本的 batch、逐图、综合阶段和 repair 运行说明。
本轮仅修改 source/配置示例/文档，**未执行测试、typecheck、build、浏览器自动化、真实 AI 请求、数据库迁移或服务重启**；不代表已运行成功。

### 数据与输出

新任务仍通过 Pro/owner 校验创建不可变快照，由持久 worker 领取。
prepare 使用原有 SSRF、格式、像素及字节限制下载图片（并发 2），复用已保存字节。
全部匿名评论（原文/全文、评分、日期、版本、默认标记）、白名单商品资料与评论—图片映射进入一个 JSON。
去重图片以真正的 `image_url` base64 输入附在同一 chat-completions 请求中；URL/字节重复保留全部来源映射，不视作独立支持。
商品资料与评论者体验分开；不传账户名、邮箱等身份字段。

模型仅返回 `summary`、`considerations`、`sourceIds` 和可选 `headline`。
只有 JSON/基本结构、非空文本、当前任务来源 ID 和资源边界检查；没有逐段 citation、原文抄写要求、句式正则判定或生成式 repair。
schema/prompt/cache 已版本化。UI 直接呈现 summary，原文证据仍从 owner API 读取。
质量诊断独立折叠，不作为文章接受条件。服务失败、截断、空输出或非法引用不会伪装成成功，也不会触发内容修复或因内容质量切换模型。

容量以精确 HTTP JSON 字节数、官方图片数量/单图限制，以及 UTF-8 字节保守 token 上界和最大视觉 token 预检；字符数不是精确 token 数。上下文保守上界超限只表示无法确认可容纳（context_budget_unconfirmed），不声称 provider 一定会拒绝，也不自动拆分或抽样。
若完整输入超限或限制未配置，停止在 prepare，保留全部原始数据，报告未处理评论/图片数量；不自动拆分、抽样或启动 synthesis。
下载失败的图片保留具体条目；成功读取的全部去重图片与全部评论仍共同输入，报告标记缺失范围。

### 配置主模型与候补

未设置 `AI_MODELS_JSON` 时，继续使用现有 `AI_MODEL`、**原样配置区域/业务空间的** `AI_BASE_URL`、`AI_API_KEY`，没有隐式备用模型。
不改 `.env`，不寻找其他 key，不自动改写到北京、workspace 或其他地域。

`AI_MODELS_JSON` 是 server-only 有序允许列表：第一项为主模型，后续才是候补。
每项必须明确 `model`、完整 `endpoint`、`vision:true`，`keyEnv` 默认 `AI_API_KEY`，只写变量名。
仅支持兼容 OpenAI chat-completions 多模态和 JSON-object 输出的模型。
不存在已核实内置容量的模型必须填写 limits；不能继承主模型的容量。
以下全部尖括号均为待填写占位符，**不是有效模型、可运行配置或免费额度声明**：

```json
[
  {
    "model": "<复制当前 AI_MODEL>",
    "endpoint": "<复制当前完整 AI_BASE_URL，不更换地域或 workspace>",
    "keyEnv": "AI_API_KEY",
    "vision": true,
    "freeTierStopConfirmed": false
  },
  {
    "model": "<运营者自行确认并允许的视觉模型 ID>",
    "endpoint": "<该模型与其 key 对应的完整区域端点>",
    "keyEnv": "AI_FALLBACK_KEY",
    "vision": true,
    "freeTierStopConfirmed": false,
    "requestOptions": {},
    "limits": {
      "context": "<替换为官方正整数>",
      "maxOutput": "<替换为官方正整数>",
      "maxImages": "<替换为官方正整数>",
      "imageTokens": "<替换为单图最大视觉 token 正整数>",
      "requestBytes": "<替换为端点请求字节上限正整数>",
      "dataUriBytes": "<替换为单图 data URI 字节上限正整数>",
      "documentation": "<无凭据的官方 HTTPS 文档地址>"
    }
  }
]
```

容量声明和 `vision:true` 是运营者配置，不是代码探测的结果。无 key、限制未知、不能容纳**同一份全部文本及图片**的候补会被跳过并记录原因；不会去掉图片以适配。
`requestOptions` 仅允许布尔 `enable_thinking`、`enable_search`；Qwen 默认关闭两者，其他模型默认不发送这两个扩展参数。可填 `{}` 使用端点默认值。
Cache 同时区分实际模型、精确端点、配置、请求选项、prompt、input 和图片哈希。每次领取还会与当前 server 允许列表求交集，已撤销的条目不再调用；旧任务不会继承允许列表中新加的模型或偷偷改用新端点。

### 有限 fallback、退避与免费额度

按 [Aliyun 错误码](https://help.aliyun.com/zh/model-studio/error-code/) 的具体 status + code 分类：

| HTTP + provider code | 行为 |
| --- | --- |
| 403 `AllocationQuota.FreeTierOnly` | 该模型免费额度用尽，冷却并选择允许的候补 |
| 400/403 `Arrearage` | provider 确认欠费/credit 问题，冷却并选择候补 |
| 403 `Model.AccessDenied` | 对应模型无调用权限，冷却并选择候补 |
| 404 `ModelNotFound` | 配置端点报告该模型不可用，冷却并选择候补；不推断具体下线原因 |
| 429 `Throttling.RateQuota` / `Throttling.ResourceExhausted` / `Throttling.ServiceOverloaded` | 同模型有限退避，不 fallback |
| 408、5xx、网络中断 | 同模型有限重试，不因这些错误换模型 |
| 泛化的 403/429、`AccessDenied`、`insufficient_quota`、`Throttling.AllocationQuota` 或未知错误码 | 不猜测额度耗尽，不自动换模型；保留 status/code 并停止 |

没有把任意 404/403 当作模型退役证明。新错误码须先按 provider 官方文档明确语义再加入精确映射。
HTTP `Retry-After`（秒或日期）是最小等待时间；超过 `AI_MAX_RETRY_AFTER_SECONDS` 则停止自动重试，而不是截短等待后提前调用。
不在 HTTP 中循环调用或等待：每次尝试是一个 durable worker attempt，通过 next_at 延后。
`AI_MAX_PROVIDER_REQUESTS=3` 是每个 job 的总请求预留上限，覆盖 fallback、自动/手动重试和不确定网络结果；请求发出前事务预留，崩溃不返还。
`AI_MAX_ATTEMPTS` 还限制单元尝试次数，两者先到者停止。手动重试不会重置总请求计数。
`AI_MODEL_COOLDOWN_SECONDS=3600` 持久冷却相同 model/endpoint/keyEnv 配置，不轮转回已耗尽的条目；显式手动重试从列表头重新检查冷却。
报告处理详情记录实际生成模型、端点 host、attempt、HTTP/code、fallback 原因与跳过原因；不存 key 值或 provider 原始错误文本。

若只允许免费额度，先按 [用完即停说明](https://help.aliyun.com/zh/model-studio/new-free-quota/) 在 Aliyun 控制台对**每个**允许模型打开“用完即停”，再设置 `AI_FREE_QUOTA_ONLY=true`，逐项填写 `freeTierStopConfirmed:true`。
单模型旧配置使用 `AI_FREE_TIER_STOP_CONFIRMED=true` 确认。
未确认主模型会拒绝配置；未确认候补不参与调用。这只是运营者确认，代码不能打开控制台开关或精确查询剩余额度，不能保证候补还有免费额度。
不支持该开关或没有免费额度的模型不能被当成 free-only 候补。

### 增量迁移与历史

本轮新增 `008_ai_model_fallback.sql`：只增加 `ai_jobs.model_cursor` 与持久 `ai_model_cooldowns`。
需要先应用仍未部署的 `007_ai_article_outcomes.sql`（任务失败/部分状态和总请求计数）；迁移脚本按版本顺序执行，不改已应用 migration、不在请求内迁移。
没有执行任何 migration。未来更新 VM 时先备份并按运维流程显式运行迁移，再让 web 与 worker 使用同一 release/fingerprint/数据库；本轮不 deploy 或 restart。
新 worker 只声明 `product-summary-v4` 的 prepare/review 能力，旧 worker 不能领取 v4。
已有 v1/v2/v3 报告、缓存、原始数据和尝试记录保留原样，前端继续兼容读取。
旧版未完成任务不被新 worker 偷换 prompt/schema 接管：可保留旧 release worker 的匹配隔离范围，或用户从原快照显式创建新版本任务；不会自动重跑生产 backlog。
旧 repair/v3 authoring 模块已移除；legacy `ai-evidence.mjs` 仅保留供历史契约回归资料使用，不被 v4 worker/provider 导入。


## 历史版本说明

## 迁移、启动与演示权限

先按 [账户文档](./README-ACCOUNTS.md) 配置 PostgreSQL 和邮箱。对已有数据库应用增量迁移；不要重建数据库或修改已应用的 001 迁移：

```bash
npm ci
node --env-file=.env server/migrate.mjs
npm run typecheck
npm run build
node --env-file=.env server.mjs
```

新迁移 `002_pro_ai.sql` 给 `users` 增加默认 `free` 的 plan，保留现有账户与历史。增加 `ai_jobs`、`ai_comments`、`ai_images`、`ai_image_comments`、`ai_units`、`ai_unit_comments`、`ai_attempts`、`ai_cache` 和共享并行限制 `ai_runtime`，包含外键、约束和索引。任务删除随原始云记录删除级联清除，包括缓存、图片字节和尝试记录。

独立登录、三个本地演示账户、升级申请与管理员后台见 [本地与发布运维](./README-OPERATIONS.md)。现在可以由唯一管理员在 `/admin` 审核申请、授予/撤销 Pro 和设定到期时间，也保留受数据库权限保护的 CLI。所有管理动作写入审计表；公开注册始终为 user/Free。新增 003 迁移保留原数据，扩展 role、停用时间、Pro 到期、申请与审计记录。

```bash
npm run bootstrap:local
npm run ai:admin -- grant-pro pro@dangdangvoice.example
npm run ai:admin -- revoke-pro pro@dangdangvoice.example
# 可选到期时间（UTC）
npm run ai:admin -- grant-pro pro@dangdangvoice.example 2027-01-01T00:00:00Z
npm run ai:admin -- concurrency 2 1
npm run ai:worker
```

本地 `.env` 已切换到 qwen，不启用 mock。缺少密钥的 worker 仅等待配置，不领取任务、不产生模型调用；加密钥后需重启。保留 mock 适配仅供显式开发/已有自动化测试，生产禁止使用，历史 mock 报告始终标识未真实推理。

## Qwen 适配与配置

实现前已核对百炼的 [官方视觉兼容接口](https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai) 和 [Chat 请求参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。适配器对 `/chat/completions` 发起服务端 POST，使用 `messages[].content` 的 `text` 与 `image_url`，图片是校验后的真实字节组成的 Base64 Data URL。当前选择 `qwen3.7-flash`，不是 `qwen-plus` 之类的纯文本模型。通过请求体顶层 `enable_thinking: false` 关闭 thinking，限制输出 token；不依赖可能不受某模型支持的 JSON Schema 强制模式，而是在提示词要求 JSON 后用服务端 Zod 严格校验。

默认大陆 endpoint 为仍受支持的 `https://dashscope.aliyuncs.com/compatible-mode/v1`。官方目前推荐业务空间域名：`https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。区域、Key、业务空间和模型可用性必须匹配；以自己的控制台为准，禁止把 Key 放在 URL、`VITE_*`、前端或日志里。

| 变量 | 默认 / 作用 |
|---|---|
| `DATABASE_URL` | 与现有账户同一个 PostgreSQL，HTTP 与 worker 必须共享 |
| `AI_PROVIDER` | `qwen`；`mock` 只允许非生产，本地输出始终标注未真实推理 |
| `AI_BASE_URL` | 上述 HTTPS compatible-mode/v1 地址，无用户名、密码或 query |
| `AI_API_KEY` | 后端/worker 密钥；Qwen 无密钥时拒绝启动任务，worker 空闲等待配置 |
| `AI_MODEL` | `qwen3.7-flash`；支持 Qwen3.7 Flash、Qwen3-VL plus/flash、Qwen-VL plus/max 家族和日期后缀；模型确实在所选区域可用仍需控制台确认 |
| `AI_REQUEST_TIMEOUT_MS` | 120000，1000–180000；下载与整个单元也有总超时 |
| `AI_MAX_CONCURRENCY` | 每个 worker 本地并行循环数，默认 2，最多 8；还受 PostgreSQL 全局/单账户限制 |
| `AI_BATCH_CHARS` / `AI_BATCH_COMMENTS` | 9000 / 20；长评论分段而不截断；每个多模态单元只带一张图片及有界的完整上下文批次 |
| `AI_MAX_OUTPUT_TOKENS` | 单次最多 4096，最大 8192；截断输出不算成功 |
| `AI_MAX_ATTEMPTS` | 每单元每轮最多 3 次（上限 5），指数退避 5–120 秒 |
| `AI_MAX_RETRY_ROUNDS` | 手动失败/取消项重试最多 2 轮（上限 5）；已成功单元不重算 |
| `AI_USER_MAX_ACTIVE_JOBS` / `AI_USER_MAX_DAILY_JOBS` | 每账户 2 个在途任务 / 滚动 24 小时最多 10 个新任务；复用已有任务不新增推理 |
| `AI_MAX_COMMENTS` / `AI_MAX_IMAGES` / `AI_MAX_UNITS` | 20000 / 200 个唯一图片地址 / 2000 个单元；超过时启动前拒绝，不抽样 |
| `AI_MAX_IMAGE_BYTES` | 每图 8 MiB；当前硬上限 12 MiB。旧 DashScope 域有请求体限制，建议维持默认，Base64 会增大体积 |
| `AI_MAX_TOTAL_IMAGE_BYTES` | 每任务图片字节总预算 200 MiB；无法预知下载体积，开始前明确告知，超出部分逐项记为失败 |
| `AI_MAX_IMAGE_PIXELS` | 每图 1600 万像素；不自动裁剪、降分辨率或改用缩略图掩盖超限 |

`.env.example` 只含占位/本地配置。数据库保存 provider/endpoint/model、prompt/schema 版本及任务执行限制，**不保存 AI_API_KEY**。修改限制、模型或提示词会形成新的配置身份，可新建任务；已有快照按创建时的规则执行。密钥可在 worker 环境轮换。

## 执行生命周期与部署

HTTP 只建立任务、读取进度和报告，**不会启动后台 Promise 执行 AI**。当前 QW Pages 为可能冷启动/停止的 HTTP 实例，没有在本次验证中获得其持久后台 worker 运行能力，因此必须另外配置受监督的常驻 Node 22+ worker（VM、容器服务或支持长任务的 worker 主机）：

```bash
# HTTP 服务
node --env-file=.env server.mjs
# 独立进程；必须在配置供应商、费用预算并允许实际付费推理之后启动。
node --env-file=.env server/ai-worker.mjs
```

HTTP 与 worker 可在不同主机，但必须访问同一 PostgreSQL；worker 需能访问百炼 HTTPS API 和当当图片 CDN，配置证书验证、连接/存储预算、进程重启、SIGTERM 排空与监控。不要在 FC HTTP 进程里顺带启动 worker，不要承诺实例关闭后 Promise 还能继续。发布产物继续包含 `server/`、`migrations/` 及运行依赖；无需数据库功能订阅，仍可连接外部 PostgreSQL，不申请或假定 QW Pages 计划包含数据库。迁移只在 release 步骤执行。

工作单元通过 `FOR UPDATE SKIP LOCKED` 领取；单元、全局并行槽和账户并行槽持有 PostgreSQL **会话级 advisory locks** 至处理结束，不在长时间数据库事务内等待网络。lease 由 heartbeat 更新，重启后可领取过期 lease。即便旧 lease 已到期，只要旧连接仍持有锁，另一个 worker 也不能并行处理同一单元。结果使用随机 lease token 栅栏写入，取消/撤销后迟到结果不能提交。SIGTERM 取消在途 I/O，已提交结果保留，未完成项之后恢复。

重要限制：供应商没有本实现可用的 exactly-once 计费承诺。若进程在远端已接收请求后崩溃，恢复可能重发该请求；网络分区也无法保证远端立即停止工作。我们保证 PostgreSQL 中唯一有效提交与并行协调，**不能承诺远端只收费一次**。使用小批次、有限尝试数和供应商预算预警。全局 slots 还约束多个 worker，部署方应给所有 worker 提供一致配置，数据库连接池每进程 10，预留 API、heartbeat 与运维连接；需要 session pooling，不能把 advisory locks 放到不保持会话的 transaction-pooling 代理后。

## 全量输入、图片与隐私

创建任务时只接收所属云端 run ID，禁止浏览器提交任意替代评论/产品。服务端把现有云记录复制为不可变输入快照。每条评论获得稳定 `C<ordinal>`，保留原 comment ID，所有非空列表/全文都被完整分段；相同字段不重复发送。空文本也占一条待处理记录。前端本地档案的 440 条上限不应用于 AI 输入。

每个 `pics` 项取大图（没有大图才取原有缩略图地址），相同规范化 URL 去重且保留全部评论关联。标记晒图却没有 URL 时生成明确的不可用线索，无法从缺失数据推知真实照片数量，不能声称这些照片已被分析。所有关联评论上下文完整分批，长上下文可能让同一图片在多次请求中出现，以避免隐瞒截断。图片观测与评论 ID 始终对应。

仅抓取 HTTPS `ddimg.cn` 及其子域，验证每次重定向、DNS 公网地址并绑定解析结果；拒绝私网/本机、其他域、非 HTTPS、凭据和自定义端口。下载限时、限字节，按内容识别 PNG/JPEG/WebP 并检查像素上限。HTML/SVG/损坏头信息、404、超限或不受支持的图片明确失败。保存首次下载字节、时间与 SHA-256，重启或重试不悄悄改用已经下载图片的另一版本。下载成功不等于 vision 分析成功。

相同图片字节按哈希计为唯一图片，保留所有 URL 与关联；相同字节 **且相同评论上下文** 的请求可以复用经过校验的结果。不同上下文仍完整处理，不为了节约费用丢弃评论。图片总预算按实际保存的字节计算（不同 URL 的相同图片仍可能分别保存）。缓存限制在同一用户、同一不可变任务内，key 包含输入、图片内容哈希、模型和 prompt/schema 配置；不跨用户或跨不同云快照复用私有证据。

发送内容仅包括商品名、评论文本、内部证据 ID 与图片，不发送评论者账户名、等级、用户登录邮箱、会话或产品价格等无关字段。原始评论/照片本身可能含个人信息或图片内嵌元数据，本实现不声称自动脱敏；正式上线前需要配置合适的数据处理地域、隐私告知和服务商保留政策。图片快照保存在受控 PostgreSQL，生产使用数据库 TLS、备份和静态加密措施。

## 报告、覆盖与证据

覆盖数字全部由 SQL/代码计算：评论只有全部文本分段成功才算完成；图片按已知内容哈希或未下载 URL 分组，全部相关上下文单元成功才算完成。地址缺失的晒图线索单列，不编造实际未知的照片张数，并使覆盖保持 partial。任何未完成/失败/取消项均不能标为覆盖完整。`completed` 表示任务无待执行单元，仍可能是 **partial** 报告；UI 同时显示任务状态与覆盖状态。站点/采集本身的 partial/sample 提示单独保留，完整分析这份快照不等于分析站点全部评论。

模型只输出严格 JSON 的有界发现。服务端检查结构、当前单元内评论/图片 ID、非空证据和引文逐字匹配；拒绝不存在的引用、虚构引文、模型生成的百分比/汇总计数和确定性真伪断言。抓取文本/图片是低信任数据，放在用户数据部分，系统指令禁止执行其中指令，不提供工具、联网或跨账户资料。校验能检查引用与原文，不代表语义推理绝不出错；报告始终显示不确定性，不保证照片能鉴定正版。

报告是全量分批发现的结构化汇编，**没有假称一个超长请求“通读一切”**，各发现仅针对引用证据。按执行概览、优势、问题、方面、冲突与不确定性、买家指导、优先卖家行动分章；程序还交叉提示相同方面同时出现优势与问题的证据。章节/发现分页只改变显示，不采样输入，也不丢弃已通过验证的发现。可从发现直接打开匿名化原评论或本次任务保存的图片；相关详情和图片下载都校验当前用户所有权。历史恢复只读取数据库，不触发模型调用。退出登录会清空当前账户报告界面，但已授权的后台任务仍属于原账户并继续执行；如需停止处理和后续费用，请先取消任务。

## 验证

```bash
npm run typecheck
npm test
# 与账户测试一样，必须使用真实、独立的测试数据库；每次随机 schema，结束时删除。
TEST_DATABASE_URL=postgresql://dangdangvoice:local-development-only@127.0.0.1:5432/dangdangvoice_test npm run test:ai
RUN_BROWSER_TESTS=1 BROWSER_EXECUTABLE=/usr/bin/google-chrome TEST_DATABASE_URL=postgresql://dangdangvoice:local-development-only@127.0.0.1:5432/dangdangvoice_test npm run test:ai
RUN_BROWSER_TESTS=1 BROWSER_EXECUTABLE=/usr/bin/google-chrome TEST_DATABASE_URL=postgresql://dangdangvoice:local-development-only@127.0.0.1:5432/dangdangvoice_test npm run test:accounts
```

AI 测试使用确定性 mock 与注入的图片下载器，验证真实 PNG 字节进入 vision 请求；Qwen 请求格式测试使用假 fetch 拦截并验证实际 Base64 payload，不访问付费 endpoint。覆盖 Free/Pro、跨用户全部路由、601 条评论与超长全文、重复/坏图片、不可变快照、缓存、分页报告、worker lease 恢复与重复保护、全局限制、验证失败重试、取消、配额和权限撤销。可选浏览器验证独立模式、证据、历史恢复不重复调用、登出/Free 切换与桌面/手机布局。

**本次没有发送付费 AI 请求，没有验证真实 Qwen 文本/图像推理质量，没有对外部署或修改生产数据。** 生产仍需百炼模型权限和密钥、明确费用预算、常驻 worker 主机、网络/数据库连接、供应商限流与数据处理政策配置；基础功能不依赖这些 AI 配置即可继续使用。

前一阶段的历史验证结果（不代表本次修改已测试）：TypeScript、生产构建、11 项基础回归/发布包测试、4 项账户集成测试及 7 项 Pro/AI 集成测试全部通过。Pro/账户与独立发布包也在 Node 22.23.5 上验证，数据库为 Docker PostgreSQL 17.12，浏览器为本机 headless Chrome（1440px / 390px）。`npm audit --omit=dev` 为 0 个已知漏洞；原有开发工具链仍有上游 advisory，未声称整个开发依赖树无漏洞。本地开发库已应用 002，演示账户 `pro-demo@example.com` 已通过现有邮箱验证流程并由 admin 命令授 Pro。初始随机密码未保留；使用开发捕获的密码重置邮件设置登录密码。演示真实样例存在晒图地址缺失，mock 报告诚实标为 partial。没有真实 Qwen 推理或生产部署。

本轮入口/后台改动按用户要求没有运行测试、浏览器检查或真实 AI 请求，仅构建发布包并执行本地迁移与账户引导。

## AI 状态与历史排障（2026-11-18）

- AI 下拉框默认展示当前账户的全部商品/快照，可切换为当前快照，数据库每页 20 个任务；每项标明商品、快照和任务编号。`GET /api/ai/jobs?page=1&runId=<optional UUID>` 始终按账户过滤，不提供跨账户访问。
- 当前任务的轮询同步更新下拉框状态；创建、取消、重试后刷新状态。切换任务和卸载使旧响应失效。`/app?aiJob=<UUID>` 可在刷新后恢复报告，仍要求账户、邮箱、Pro 和任务 ownership。
- 待处理、运行、等待重试、下次重试时间、过期租约和最近错误均由状态 API 返回；一分钟无新结果显示检查 worker 的提示，不能把 ready 等同于任务完成。
- worker 日志含时间、task/unit ID、阶段和安全错误码；validation 仅记录字段路径/错误类型，不记录原始评论、输出正文或凭据。图片观察不能作为评论引文；输入提供合法证据 ID，并在有限重试时附上上次校验错误。不关闭证据/引文校验。
- 本地 worker 默认从项目根读取 `.env`，已有 shell 环境优先。HTTP 用 `DATABASE_URL`，worker 优先 `WORKER_DATABASE_URL`；不要从 production shell 启动本地进程。启动日志可核对环境、数据库名、schema、API 主机和 enabled/key-ready 布尔值。`AI_BASE_URL` 是模型 API `/v1` 根地址，不能是应用网址。
- `AI_WORKER_JOB_ID=<UUID>` 可将诊断 consumer 限于指定 task；它不会跳过 ownership/Pro/lease/并发条件。诊断结束取消该环境变量并重启正常 worker。生产部署前先核对 backlog，避免把全队列当作验证任务。

- 当前生产 worker 在 iad1，避免已观测的 sin1/hkg1 到北京 API/CDN 的 TCP 超时。仍使用北京端点与原 model/key，不应通过关闭 TLS 检查解决网络问题。
- quotes 元素必须是 {commentId,text} 对象；图像观察不当作评论引文。结构化 ID 与正文里提及的证据 ID 均经过校验。系统 prompt 哈希也纳入中间缓存 key；完成报告默认打开有发现的章节，避免空概览造成误解。

## Pending article-v3 diagnostic (2026-11-20; not ready for rollout)

This uncommitted change has **not** produced an accepted real article. Do not
release it based on typecheck/build alone. The production task and snapshot were
read in a read-only PostgreSQL transaction; no production data was modified.
The separate local diagnostic database contains all 78 comments and 22 cached
images, with SHA-256 checked against the downloaded originals. No recrawl ran.

The authoring contract uses short text blocks and source IDs. Code materializes
comment text, separates seller metadata citations, checks reference types and
image/comment relationships, and retains v1/v2 history rendering. Validation
rejects unsupported conclusions and unverifiable quotes rather than assigning
replacement evidence. Repair recomputes current errors, reports field paths and
received types, and resends only images involved in visual corrections. Failed
prose is excluded from repair source material. Worker claims remain protected by
pipeline/schema/executor fingerprints and the database trigger.

Migration `007_ai_article_outcomes.sql` adds failed/partial job outcomes and a
persistent provider-request counter. Requests are reserved before HTTP, so a
crash or network failure cannot refund a possibly sent request. The default
`AI_MAX_PROVIDER_REQUESTS=3` covers all automatic/manual retries and repair;
changing it affects new immutable jobs, not existing tasks. Oversized plans
which cannot fit their total request budget stop before provider execution.

Measured local attempt (diagnostic job `10871a22-fe21-46dc-9d5f-0ce73fcb0379`):

| Request | Pixels sent | Input tokens | Output tokens | Provider time | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 22 | 13,221 | 1,253 | 37.895 s | Wrong comparison enum fields; unsupported claims |
| 2 | 4 relevant originals | 9,219 | 1,387 | 10.004 s | Unsupported claims/citations retained |
| 3 | 4 relevant originals | 8,060 | 627 | 9.939 s | Article strings lacked per-paragraph references |

Total: **3 requests, 33,767 tokens** (30,500 input + 3,267 output),
57.838 s provider time; 331.423 s from local job creation to its failed outcome,
including pauses for diagnosis/code edits. Cached image preparation/planning took
0.370 s. These timings are not a comparable successful baseline.
The requests used the existing local Beijing workspace endpoint; the inspected
production task used the general DashScope compatible-mode endpoint. Both used
`qwen3.7-flash`. This endpoint mismatch was discovered after the bounded run and
must be corrected explicitly before any further real verification.

Typecheck/build and targeted guards passed. The actual failure UI shows no
completed article, retains source quality diagnostics, opens the matching source
comment and serves matching image bytes. Reload/history preserved `failed` and
the request count stayed at 3. Successful article citations remain unverified
because no accepted article exists. All further AI calls stopped at the cap.

Before a future VM update: finish real full-snapshot acceptance on the explicitly
confirmed endpoint; review and commit only related changes; stop the old worker,
back up PostgreSQL, run versioned migrations explicitly, build, then restart web
and worker from the same release against the same database. Verify `/readyz`,
worker capability/fingerprint logs, and saved report reload without AI calls.
No VM/Vercel deployment or production migration was performed in this diagnostic.
