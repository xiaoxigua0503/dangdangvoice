> 最新验证：2026-11-18，实际商品 30033347 已在 local 与 Vercel 从链接采集、云保存、全量 AI 到历史/刷新完成。Web hnd1，worker iad1；本次返回 12 条有内容评论、0 张 review 图片。详见文末，不能据此承诺所有商品或网络始终可采集。

# 当前源码的生产部署（2026-11-18）

当前生产入口：**https://dangdangvoice.vercel.app/login**。托管项目 `xiaoxigua/dangdangvoice`，Web 区域 `hnd1`，独立 AI daemon 区域 `iad1`。Web 为 Vercel Node 22 Functions + 当前 Vite 静态资源，AI 为独立 Vercel Daemon `ai-worker`。没有以旧 ZIP 发布，也没有把缺失后端的静态页面称为完成。

## 已完成与尚未完成

- 已创建 Vercel Hobby 项目，明确选择 Neon `free_v3` 免费方案创建独立 `dangdangvoice-prod` PostgreSQL（Singapore），关闭 Neon 自带认证，复用本项目现有账户实现。通过 Vercel Marketplace 完成了 Neon 集成安装；没有升级套餐、购买服务或开启付费方案。
- 新生产库已显式应用 001、002、003 迁移；没有复制本机用户、密码、评论、AI 报告或 Docker 卷。笔记本数据库仍保持原样，不暴露公网。
- `DATABASE_URL` 由集成提供，HTTP 使用其连接；`WORKER_DATABASE_URL` 使用同库的 **unpooled 直连**，避免事务池化破坏 worker 的会话级 advisory locks。HTTP `/readyz` 查询数据库迁移版本，worker 启动也检查直连与迁移。生产连接显式使用 verify-full，worker 镜像包含系统 CA 文件，不关闭证书校验。
- 环境配置使用 Vercel production secrets，实际固定 `APP_BASE_URL=https://dangdangvoice.vercel.app`、`NODE_ENV=production`、`TRUST_PROXY=false`。保持正式 Host + Origin/Referer、JSON、CSRF cookie/header 校验。HTTPS cookie 使用 Secure，CSRF cookie 使用 `__Host-`。`NODEJS_HELPERS=0` 保留原始 HTTP body stream。
- Qwen 北京 endpoint、`qwen3.7-flash`、120 秒超时、并发 2 和现有本地 AI key 已配置到服务端生产 secrets。**未发送自动模型测试请求**。按 owner 最新指令已设置 `AI_WORKER_ENABLED=true` 并重新部署，等待 owner 在 UI 手动提交分析。空闲时两个并发循环各每 1.5 秒轮询 PostgreSQL；没有工作单元时不调用模型，但会保持数据库活跃并消耗 Daemon 内存额度。
- **SMTP 已补齐生产配置，未验证真实投递**：Gmail 主机、465/TLS、SMTP 用户名/密码及 MAIL_FROM 已配置。MAIL_FROM 使用同一认证地址。用户本轮提供的凭据实际位于本地私有 `.env`，此前生产项目环境列表没有 SMTP 变量；已安全补入该项目 Production secrets，未输出地址或密码。没有发送邮件或验证 SMTP 登录/实际投递。
- **生产 owner 使用受控 CLI 提升**：没有默认管理员、没有导入演示账户。本轮没有擅自指定或提升邮箱；真实 owner 需正常注册和完成验证，再运行下面的命令。未验证账户不能被此命令提升，既存其他管理员会阻止替换。

这是已部署并启用 worker 的完整技术栈；SMTP 真实投递、模型推理仍由 owner 手动验证，生产 owner 需通过下方受控命令初始化。

## Qwen 优先检查结果

从仓库原打包说明找到既有页面 `app-8f4234b7-4ed153f9` / https://waf8xws9.qwenwork.page/，对其 `/healthz` 的最小 HTTP 请求返回 200。没有删除、重新创建、改环境变量、迁移或覆盖这个页面。

[QwenWork 官方文档](https://docs.qwenwork.ai/web/platform) 确认动态页面支持 Node.js 与可选托管数据库；但本会话没有 Qwen 发布工具/控制面凭据，浏览器 QwenWork 为 Guest，无法核实当前账户的秘密配置、原始 PostgreSQL 直连权限、常驻 worker、SMTP 与 Qwen API 出站权限。历史源码中的数据库额度拒绝记录不能证明当前账号仍相同，也不能证明托管数据库能供外部 worker 直连。没有把 HTTP 实例内 promise 当作常驻 worker。因这些条件无法验证，使用已登录、能够实际部署 Daemon 的 Vercel 备选。

## 免费资源限制与出站能力

已核对 [Vercel Daemons](https://vercel.com/docs/daemons)、[Daemon 配置](https://vercel.com/docs/daemons/config-reference) 与 [额度](https://vercel.com/docs/daemons/limits)：当前 Public Beta 包含 Hobby。这里显式使用一个 1 GiB 实例，而非默认 2 GiB；独立容器运行 `node server/worker-start.mjs`，由平台监督和重启，SIGTERM 有 30 秒清理时间，任务与恢复状态仍在 PostgreSQL。

Hobby 每月 420 GB-hours 内存、5 Active CPU-hours；即使等任务，常驻内存也计入额度。1 GiB 连续运行约 420 小时（17.5 天）即达到内存额度，不能承诺免费整月 24/7。到额度会停止到下月；未自动升级。需要整月可靠运行时必须另行确认容量/费用方案。Neon 免费计算/存储也有额度，持续数据库轮询会消耗它；在供应商面板监测，不能声称无限免费。Hobby 限个人非商业用途，正式商业运营另需确认计划许可，见 [Hobby 说明](https://vercel.com/docs/plans/hobby)。

[Vercel 官方 SMTP 说明](https://vercel.com/kb/guide/serverless-functions-and-smtp) 允许出站 SMTP（25 端口除外），本项目使用 587 或 465。生产 Web 到 PostgreSQL 已通过就绪请求确认；worker 的直连由启动日志确认。真实 SMTP 没有凭据无法验证，Qwen 实际推理按要求未验证。Function 请求体仍受平台约 4.5 MB 上限影响，不能接受本地服务器支持的全部 20 MB 单次云保存；这不会把数据静默截到 440 条，但大快照需要后续分块上传适配或采用请求体限制更宽松的 HTTP 托管。应用基础分析和本地完整导出保留。Function 设置 60 秒，只处理有限 relay/API 请求，AI 不在其中运行。

## 从当前源码再次发布

发布准备使用严格文件允许列表，只拷贝当前构建、后端、迁移、Node adapter 和 worker 依赖。`.env*`、`.private/`、演示密码、Docker 卷与历史 ZIP 均不在发布包中。worker Dockerfile 也只 COPY package 文件、server 和 migrations，不使用 `COPY . .`。

```bash
npm run release:prepare
# 第一次链接；再次 prepare 会保留既有 project.json 关联
vercel link --yes --project dangdangvoice --scope xiaoxigua --cwd .release/vercel
# 所有凭据在平台 production environment 设置，不要用 --env KEY=secret 暴露在命令行
vercel deploy --prod --yes --scope xiaoxigua --cwd .release/vercel --logs
vercel daemons inspect ai-worker --scope xiaoxigua --cwd .release/vercel
vercel logs --query 'source:daemon' --since 10m --scope xiaoxigua --cwd .release/vercel
```

首次 `vercel link` 可能生成 `.env.local`；发布忽略规则排除它。生产 Web/worker 不读取随代码附带的开发 `.env`。所有 provider 更新都要保留账户与历史库，运行迁移只用一次性 release 命令，不在 HTTP 请求内执行。

## 生产环境变量与 owner

平台配置入口： https://vercel.com/xiaoxigua/dangdangvoice/settings/environment-variables 。环境为 Production。

| 配置 | 当前状态 |
| --- | --- |
| DATABASE_URL | Neon 集成提供，生产 PostgreSQL |
| WORKER_DATABASE_URL | 同库直连，Secret |
| APP_BASE_URL | https://dangdangvoice.vercel.app |
| NODE_ENV / NODEJS_HELPERS / TRUST_PROXY | production / 0 / false |
| MAIL_TRANSPORT | smtp |
| SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM | 已补齐，不在文档中记录值 |
| SMTP_PORT / SMTP_SECURE | 465 / true（Gmail） |
| AI_PROVIDER / AI_MODEL | qwen / qwen3.7-flash |
| AI_BASE_URL | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| AI_API_KEY | Secret 已设置；权限与推理未验证 |
| AI_REQUEST_TIMEOUT_MS / AI_MAX_CONCURRENCY | 120000 / 2 |
| AI_WORKER_ENABLED | true；owner 通过 UI 手动提交任务 |

真实发信服务需要已验证发件域/地址、SMTP 认证及必要 SPF/DKIM/DMARC；APP_BASE_URL 已用于验证/重置链接。不要使用本地捕获模式或演示标识替代真实邮箱。

本机的 `.private/production.env` 是通过 CLI 下载的生产数据库凭据，目录 0700、文件 0600，已 gitignore，绝不作为网站资产。它没有本地演示密码。不要公开内容，也不要用它覆盖本地 `.env`。以下命令明确使用生产配置，不会误运行本地 bootstrap：

```bash
# 确认 SMTP 配置并重新部署后，owner 在生产站点正常注册并验证。
# 替换 OWNER_EMAIL，命令拒绝保留演示邮箱、未验证账户及其他既存管理员。
NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/owner-admin.mjs OWNER_EMAIL https://dangdangvoice.vercel.app
# 单独、明确地授予或撤销用户 Pro（也可由生产管理员后台操作）
NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/ai-admin.mjs grant-pro USER_EMAIL
NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/ai-admin.mjs revoke-pro USER_EMAIL
```

owner 命令不创建/重置密码，不跳过邮箱验证，使用数据库事务锁与唯一管理员约束，并写审计。数据库迁移已有成功记录；下次变更先备份再按 release 程序显式迁移。

## 本轮检查范围

只构建、查看部署/容器日志、执行必要的新生产库迁移和最小 HTTP readiness。未运行测试套件、浏览器测试、基准或真实 AI 调用，未发送邮件。HTTP `/login`、`/healthz`、`/readyz`、`/api/auth/me`、`/api/auth/csrf` 返回 200；空登录 POST（正式 Origin + CSRF）到达参数校验返回 422；不可信 Origin 返回 403；未登录管理员接口返回 401。没有验证真实生产账户全流程、邮件或模型输出。

最终部署版本：`dpl_D948s9Kex8sePnDtyZiSXDRR9Knt`，可在 [部署日志](https://vercel.com/xiaoxigua/dangdangvoice/D948s9Kex8sePnDtyZiSXDRR9Knt) 查看。系统 CA 与 verify-full 更新后的 worker 数据库就绪日志及 1/1 ready 已确认。

## 比赛演示后的暂停命令

```bash
vercel daemons scale ai-worker iad1=0 --project dangdangvoice --scope xiaoxigua
```

这会停止整个 Daemon 实例，停止其分配内存消耗，保留 Web、数据库、用户、任务与报告。仅把 `AI_WORKER_ENABLED` 改为 false 不会停止实例内存计量。需要恢复时 `iad1=1`（此时仍会使用最新已部署的环境变量）。缩容覆盖会保留到后续部署，除非修改或 --reset。

本次 CLI `vercel billing usage --json --scope xiaoxigua` 返回当前计费周期的 usage/cost data unavailable（不能视为用量为零）。官方 Hobby 月配额仍为 420 GB-hours 内存、5 Active CPU-hours，当前实例分配 1 GiB / 1 vCPU，剩余实时额度未能从该 CLI 取得，需在账户 Usage 面板查看。没有升级或购买资源。

最新部署（SMTP / worker 启用）：`dpl_E2wouD3TWYH1gewExwRvAHSo7hr1`。Web 与 worker 的脱敏运行时摘要均确认 Gmail:465/TLS、真实 SMTP 模式、capture 关闭、发件人与认证地址一致、AI key 存在、北京端点与 qwen3.7-flash、worker enabled、生产 Neon 同库且 worker 直连；Daemon 1/1 ready，/readyz 返回 200。请求显式 enable_thinking=false、enable_search=false，不启用其他工具。未运行测试、浏览器测试、邮件发送或模型调用。

管理员命令可显式清除继承的数据库变量，避免终端环境覆盖指定的生产文件：

```bash
env -u DATABASE_URL -u WORKER_DATABASE_URL -u DDV_PROCESS_ROLE \
 NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/owner-admin.mjs \
 OWNER_EMAIL https://dangdangvoice.vercel.app
```

## 2026-11-18 AI 状态/历史修复发布

当前发布 `dpl_6CzrKrG9sc4qVvdmER7iPiBiTJdF`，生产别名仍为 https://dangdangvoice.vercel.app 。Web 与独立 daemon 已切换到本次 Node/PostgreSQL 修复，未合并 Qwen 转换、未执行迁移或重建数据。Daemon 1/1 ready；运行时脱敏摘要确认 production、同一 Neon neondb/public、worker 直连、Qwen 北京端点、qwen3.7-flash、key 存在且 enabled=true。HTTPS /readyz=200，未登录 AI 接口=401。

本地用实际管理员账户从导入 UI 创建了仅含一条原评论与一张原图的独立诊断快照；任务 38940e51-9d24-4b3a-9bbb-b0aacd6fe658 经真实模型处理，UI 显示 0/2→1/2→2/2，最终 complete、非 partial；图片格式校验失败后的有限自动重试成功。刷新后同一报告及任务历史仍可读，移动宽度 390px 无横向溢出。TypeScript/build 通过，没有运行批量测试。

生产本次真实模型与已登录 UI 验证尚待拥有者在共享浏览器登录 Pro/admin 账户；尚未提交生产诊断任务，不能将部署 ready 声称为生产 AI 已验证。旧生产任务的 worker_error/图片失败细因超出历史日志保留期限，需在授权的小任务上使用新阶段日志核实。没有重置账号或替换已有 key。


## 2026-11-18 已完成生产 UI / 真实多模态验证

最新生产发布：`dpl_9T5QpRc8G1NLxMcZV9jn4HbMHgBE`，URL https://dangdangvoice.vercel.app 。Web 仍在 sin1，worker 现为 iad1 的一个 1 GiB Daemon；不增加实例配额、不购买资源。保留同一 Neon neondb/public、worker 直连、北京 DashScope、原 key 和 qwen3.7-flash。

实际问题与修复：sin1/hkg1 container 到北京 API 和当当 CDN 的 TCP 连接超时，而控制域 HTTPS 成功；iad1 的 API HEAD 得到 HTTP 响应、图片 HEAD=200，随后真实文本与图片推理成功。另修复 prompt 未明确 quotes 对象结构的问题，补充动态引用约束，校验正文中的证据编号。仅对本次诊断任务的一个不合格图片单元重新校验并通过 UI 重试，没有重试旧生产任务或整个 backlog。缓存额外绑定真实 system prompt 哈希，新任务 prompt version 为 ddv-evidence-3。

已由 owner 的已验证 Pro/admin 会话从 UI 导入明确标注的一条原评论/一张原图并启动任务 `8b28836a-1ef7-4399-a78d-909dda4558da`，snapshot `b48188d4`。UI 观察到运行与 retry 状态、1/2→2/2；最终评论 1/1、图片 1/1、失败 0、complete=true、partial=false，两个发现。图片证据通过已授权接口读回 image/jpeg、149872 bytes。刷新后 task ID、两条发现、历史状态和生成时间保留；尝试数维持 13，刷新没有 POST AI 请求。累计记录 5210 input / 1547 output tokens（含失败校验的有限尝试）。没有验证真实邮件投递。

临时网络诊断默认关闭，只有 AI_NETWORK_DIAGNOSTICS=true 且提供 AI_NETWORK_DIAGNOSTIC_JOB_ID 才执行无 Authorization、无推理的有界 HEAD 检查。生产保留的该任务 UUID 自身不会触发检查；CLI 删除环境项需要显式人工确认，因此未绕过平台确认。不要为日常 worker 开启探测。

暂停演示后的 worker：
```bash
vercel daemons scale ai-worker iad1=0 --project dangdangvoice --scope xiaoxigua
```

生产最终 UI 补充：切换到旧 task 再切回、从 cloud history 恢复同一快照均保持正确报告；390px viewport 无横向溢出。最后再次 GET 状态/报告时 attempts 仍为 13，两个单元用最新引用/引文 validator 复核均通过。

## 实际商品 30033347 复核（2026-11-18）

输入 https://product.dangdang.com/30033347.html ，保持默认全部列表页与详情设置。local 和生产 UI 均完成两页 12 条评论的采集及账户云保存，再由各自真实 qwen3.7-flash 完成一个文本工作单元：local c92907d8-5d25-42b1-b79e-a5b07e966eec，生产 a43d555b-5fac-48da-b652-a8f78f6809af。两边各一次模型请求、12/12 评论完成、0 失败，报告落库后刷新与历史恢复不重新推理。站点 summary 为 1822 总计、1810 自动评价、12 内容评价、0 图片，不能声称分析了 1822 条原文或此次验证了图片推理。没有用抽样导入替代这次 URL 采集。

生产原 Web 出口出现 fetch failed，改为 iad1 后实测上游 HTTP 403；将 Web 改为 hnd1 后真实页面及两页列表成功。worker 保持 iad1。Vercel 的部分详情页仍可能受风控，本次保留完整短评列表，未获取成功的封面/价格不会编造。新 UI 区分网络错误、超时、HTTP 状态和风控；详情计数改为尝试次数，长评详情失败会标注范围限制。采集/导入/主动恢复新的快照时清除旧 aiJob 选择，默认只自动选择当前快照的报告，避免旧商品状态被误认为本次任务。全账户历史仍保留且可手动切换。

本次最终发布 `dpl_3XRQ5DPpGTe6mrvwEQjxJEvXLR95`（https://dangdangvoice.vercel.app）。最终资源 index-D8i2PEL-.js 已在 local/生产页面加载，恢复当前云快照自动选择同一任务，观测到 0 次新建 AI POST，数据库两边 attempts 仍为 1。生产 Daemon 最终发布 ready 1/1，iad1 一实例；local 仅一 web 与一 worker。执行 typecheck、生产 build、allowlist 独立发布打包；没有运行测试套件。本次不验证 SMTP 或其他商品、所有区域的持续可达性。
