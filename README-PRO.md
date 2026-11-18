# Free / Pro 与独立 AI 深度分析

此扩展沿用现有邮箱登录、验证、HttpOnly 会话、CSRF、用户所属的 `saved_runs` / `saved_comments`。没有第二套账户/历史，没有支付功能。Free 保持完整的基础词典分析、采集、导入导出、本地档案、重试队列、云历史、评论库、声纹和晒图墙。Pro 添加独立的“AI 深度分析”视图，不把 AI 结论混入基础仪表盘。

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
