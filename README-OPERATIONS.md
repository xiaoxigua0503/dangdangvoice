> 当前生产部署与限制见 [部署交接](./README-DEPLOYMENT.md)。下面本地说明不代表生产 SMTP/AI 已验证。

# 独立登录、订阅与管理运维

当前入口先确认会话，再渲染主应用，避免闪现受保护内容。未登录的 `/`、`/app`、`/admin` 转 `/login`；普通用户登录进入 `/app`，管理员进入 `/admin`，后台有打开应用链接。Free/Pro 共用主应用布局；免费 AI 入口打开申请对话框。没有支付、定价或自助授权接口。注册不指定角色或订阅；邮箱统一 trim + lowercase，不移除点或 plus 标签、不限制收件服务商。

## 本地启动与重启

Node 22+，现有 Docker Compose PostgreSQL（不要删除卷）。仅对本地开发库执行以下命令；没有生产部署授权。

```bash
npm ci
# 首次设置才复制；已有 .env 不要覆盖
# cp .env.example .env
docker compose up -d --wait
npm run migrate
npm run bootstrap:local
npm run build
npm start
# 另一个终端，单独的常驻进程
npm run ai:worker
```

访问 `http://localhost:3000`，与 `APP_BASE_URL` 保持一致。两个 npm 启动脚本均自动读取 `.env`，外部环境变量优先。修改配置后，在各进程终端按 Ctrl+C，再分别执行 `npm start` 和 `npm run ai:worker`。静态资源修改后先 `npm run build`。迁移只在发布前显式执行，不在请求内执行。

本轮在本地终端会话中分别启动应用和 worker；日志输出在相应终端。正式常驻运行请配置进程管理器，不能依赖交互终端的生命周期。

## 演示账户

```bash
npm run bootstrap:local
```

只允许非 production 且 DATABASE_URL 指向 localhost/127.0.0.1/::1。创建已验证的 `free@dangdangvoice.example`（Free）、`pro@dangdangvoice.example`（Pro）、`admin@dangdangvoice.example`（唯一管理员，Pro）。这些是本地登录标识，不是真实收件箱，邮件路径明确拒绝投递。其他用户正常注册仍需邮件验证。

初始密码由加密随机数生成，或首次通过 `BOOTSTRAP_FREE_PASSWORD`、`BOOTSTRAP_PRO_PASSWORD`、`BOOTSTRAP_ADMIN_PASSWORD` 环境变量提供（12–128 字符）。密码使用已有 scrypt 实现。私有明文交接文件 `.private/demo-credentials.json` 权限 0600，目录 0700，已 gitignore，发布打包不包含它。不要把它上传或粘贴到聊天。重复运行不会重置现有密码、改动账户权限或清空数据；已有账户缺少凭据时文件会标注而非编造密码。现有业务账户保留。

数据库部分唯一索引限制最多一名 admin，触发器禁止删除或降级已建立的唯一 admin，约束禁止停用 admin。bootstrap 成功时验证恰有该一名管理员；不公开创建管理员 API。后台没有删除/变更角色入口。

## 管理、权限与审计

迁移 [003_admin.sql](./migrations/003_admin.sql) 在 001/002 基础上增加 `users.role`、`disabled_at`、`pro_expires_at`、`upgrade_requests`、`admin_audit`。后台分页查询账户、申请、AI 作业元数据、覆盖、失败数量和已记录词元；不提供其他用户评论/报告内容。每个管理 API 要求已验证 admin，所有写入沿用 Origin+JSON CSRF 校验。授予/撤销、到期调整、审批、停用/启用、撤销会话、CLI 管理和 bootstrap 均留审计记录。

停用会删除全部会话、取消在途 AI 任务，worker 心跳和提交检查阻止旧结果写回。撤销 Pro 取消在途 AI 任务。到期即时通过会话/AI API/worker SQL 检查，过期任务不再领取或提交；已发出的供应商请求无法保证撤销计费，可能保留待处理状态，管理员可撤销 Pro 明确取消。审核通过状态表示历史申请已批准，不等于永久有效权限，以账户当前有效订阅为准。

CLI（具有数据库管理权限者运行）：

```bash
npm run ai:admin -- grant-pro pro@dangdangvoice.example
npm run ai:admin -- grant-pro pro@dangdangvoice.example 2027-01-01T00:00:00Z
npm run ai:admin -- revoke-pro pro@dangdangvoice.example
```

## AI 配置与常驻执行

在私有 `.env` 加入百炼北京地域 API key，重启 HTTP 和 worker：

```dotenv
AI_PROVIDER=qwen
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_API_KEY=
AI_MODEL=qwen3.7-flash
AI_REQUEST_TIMEOUT_MS=120000
AI_MAX_CONCURRENCY=2
```

已核对官方 [图像理解](https://help.aliyun.com/zh/model-studio/vision/) 和 [兼容 Chat API](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)：服务端 `/chat/completions`，实际图片字节通过 `image_url` Base64 Data URI，顶层 `enable_thinking:false`，不启用搜索或工具。这是阿里云 API。当前批次默认文本 9000 字符和一张受限图片，控制在远低于超长上下文的范围；不是精确 tokenizer 预算。长文全部分段、全部图片关联保留，没有 440 条限制或隐藏采样。原有 durable pipeline、安全图片下载、引用校验、重试与历史报告复用保留。

本地默认没有密钥，worker 启动后只等待配置，不领取工作。没有发送真实/付费请求，也未验证模型权限、推理质量或额度。加密钥前确认供应商权限、预算、数据处理告知及可用网络。QW Pages HTTP 实例不执行模型；必须另有持续运行的 worker 主机，共用 PostgreSQL，使用进程管理器处理重启。不要声称 HTTP promises 能跨实例关闭存活。

## 真实 SMTP 仍需提供凭据

本地原配置是 capture，并无 SMTP 主机/发件人/认证信息；不是 Gmail 验证格式问题。本轮改为默认 `MAIL_TRANSPORT=smtp`，缺少配置则验证/重发/重置诚实返回 503。不会报告成功投递。已注册未验证账户直接使用 `/verify-email` 重发，无需再次注册。

```dotenv
MAIL_TRANSPORT=smtp
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
APP_BASE_URL=http://localhost:3000
```

从实际事务邮件服务获取主机及认证信息，MAIL_FROM 使用已验证的发件地址/域名。按服务商要求配置 SPF、DKIM、DMARC 和域名授权，确认出站 SMTP 端口可达；465 一般 SECURE=true，587 为 STARTTLS（生产强制 TLS）。生产 APP_BASE_URL 必须是实际 HTTPS 域名。发送域与收件邮箱服务商无关；用户的 Gmail/QQ/163 邮箱并不会自动赋予本应用发信资格。Gmail、QQ、163 实际投递均未验证。

邮件失败日志仅记录类型和安全错误码，不输出收件人、密码、令牌或供应商响应正文。SMTP 发送成功也只代表服务商接收，不保证进入收件箱。生产拒绝 capture；本地只有显式选择 `MAIL_TRANSPORT=capture` 才写开发捕获，绝不声称真实投递。不要在生产使用演示密码/开发数据库配置。

## 本轮执行范围

已仅在既有本地数据库应用 003 并引导演示账户，构建静态资源和独立发布包。按要求未运行测试套件、TypeScript 检查、浏览器测试、基准或真实 AI 请求，未新建测试，未部署或修改生产数据。构建成功不等于账户/管理流程已通过运行验证。既有测试记录属于之前版本，不能用于证明本轮改动。

## 本地来源与 CSRF

本地统一使用 `http://localhost:3000`，`APP_BASE_URL` 保持此值，`NODE_ENV=development`。监听地址 `HOST=127.0.0.1` 只限制网卡，不是浏览器入口。127.0.0.1:3000 的 GET/HEAD 会重定向到 localhost；写请求不能通过地址别名绕过校验。`npm start` 使用 `server/start.mjs` 从应用根目录解析 `.env`，外部显式环境变量仍优先。

登录、注册、找回/重置与验证页面初始化同源 `/api/auth/csrf`。所有前端 API 写入在提交前获取新安全凭据（并发初始化合并），以 `X-CSRF-Token` 提交，与 host-only、HttpOnly、SameSite=Strict cookie 比较。令牌仅存在内存和 cookie，无 localStorage。服务端同时验证配置的固定 Origin（缺失时校验 Referer 来源）、Host、Fetch Metadata 和 JSON Content-Type，不使用通配符或 X-Forwarded-* 推断可信来源。生产反向代理必须保留正式 Host。本地 HTTP 不加 Secure；HTTPS/production 会话 cookie 保留 Secure，HTTPS CSRF cookie 使用 __Host- 前缀。源码更新后重新构建并重启 Web 服务。
