# Cloud Clipboard：Cloudflare 控制台界面部署指南

本指南用于把 GitHub Actions 生成的 `cloud-clipboard-pages.zip` 通过 Cloudflare Pages 的 Direct Upload（直接上传）界面部署。ZIP 内含已经构建的前端资源和 Pages advanced mode 所需的 `_worker.js`。

> [!IMPORTANT]
> 上传 ZIP 只会部署应用代码和静态资源。D1、R2、绑定、环境变量、密钥、CORS、生命周期和 Cloudflare Access 不会随 ZIP 导入，必须按本文逐项配置。

> [!CAUTION]
> 在 Cloudflare Access 保护整个生产域名之前，不要保存敏感文本或上传私人文件。R2 Bucket 必须保持私有；不要开启公开访问。

## 0. 部署清单和边界

准备以下内容：

- 一个可使用 Workers、Pages、D1、R2 和 Zero Trust Access 的 Cloudflare 账号。
- GitHub 仓库 Releases 页面下载的 `cloud-clipboard-pages.zip`。
- 一个由 Cloudflare 托管 DNS 的自定义域名，用于完整配置 Access。`pages.dev` 地址可用于部署检查，但不能替代最终 Access 验收。
- 一个只允许可信邮箱登录的 Access 策略。

本次界面部署会创建：

| 资源 | 建议名称 | 应用中的绑定名 |
| --- | --- | --- |
| Pages 项目 | `cloud-clipboard` | 不适用 |
| D1 数据库 | `cloud-clipboard` | `DB` |
| R2 Bucket | `cloud-clipboard` | `FILES` |

完成标准：代码上传、资源配置和安全边界均通过本文最后的验收表。任何单项失败都不应视为部署完成。

## 1. 从 GitHub 下载部署 ZIP

1. 打开 GitHub 仓库，进入 **Releases**。
2. 打开需要部署的版本。发布工作流会在推送 `v*` 标签时运行，也可以在 Actions 页面手动运行并填写一个已经存在、以 `v` 开头的标签。
3. 在该 Release 的 **Assets** 区域下载 `cloud-clipboard-pages.zip`。
4. 同时下载 `cloud-clipboard-pages.zip.sha256`；可执行 `sha256sum -c cloud-clipboard-pages.zip.sha256` 检查下载文件完整性。
5. 不要解压 `cloud-clipboard-pages.zip`，Cloudflare Pages Direct Upload 可以直接接收该文件。

> **截图 1 占位：GitHub Release 及 Assets 下载区域**  
> 建议文件名：`01-github-release-assets.png`

人工验收：

- 对应版本的 Workflow 状态为绿色成功，Release 已创建。
- Release Assets 中同时存在部署 ZIP 和 SHA-256 校验文件。
- 部署 ZIP 的根目录包含 `index.html` 和 `_worker.js`，且不包含 `.dev.vars`、`wrangler.jsonc` 或 `migrations/`。

## 2. 创建 D1 数据库并初始化表

1. 登录 Cloudflare Dashboard。
2. 进入 **Storage & Databases > D1 SQL database**。
3. 选择 **Create Database**，名称填写 `cloud-clipboard`，然后创建。
4. 打开该数据库的 **Console**。
5. 打开仓库中的 `migrations/0001_initial.sql`，完整复制 SQL 到控制台并执行。
6. 在控制台执行以下只读检查：

   ```sql
   SELECT name
   FROM sqlite_schema
   WHERE type IN ('table', 'index')
   ORDER BY name;
   ```

7. 确认结果包含 `clips`、`files` 及各自索引。

> **截图 2 占位：D1 数据库创建完成页面**  
> 建议文件名：`02-d1-created.png`

> **截图 3 占位：D1 Console 执行迁移和表结构检查结果**  
> 建议文件名：`03-d1-schema.png`

人工验收：数据库名正确；迁移无错误；`clips`、`files` 两张业务表存在。

## 3. 创建私有 R2 Bucket 和 24 小时生命周期

1. 进入 **Storage & Databases > R2 object storage**。
2. 选择 **Create bucket**，名称填写 `cloud-clipboard`。
3. 不要为 Bucket 配置公开域名，也不要启用公开开发 URL。
4. 打开 Bucket，进入 **Settings > Object Lifecycle Rules > Add rule**。
5. 规则名称填写 `delete-after-one-day`；范围选择全部对象（不设置前缀）；到期删除设置为 **1 day**；保存。

> **截图 4 占位：R2 Bucket 列表及私有状态**  
> 建议文件名：`04-r2-private-bucket.png`

> **截图 5 占位：1 天删除的 Object Lifecycle Rule**  
> 建议文件名：`05-r2-lifecycle.png`

人工验收：Bucket 没有公开访问入口；生命周期规则覆盖全部对象并在 1 天后删除。

## 4. 通过 Pages Direct Upload 上传 ZIP

1. 进入 **Workers & Pages**。
2. 选择 **Create application > Get started > Drag and drop your files**。
3. 项目名填写 `cloud-clipboard`。
4. 将未解压的 `cloud-clipboard-pages.zip` 拖入上传区。
5. 选择 **Deploy site**（界面若显示 **Save and Deploy**，选择该按钮）。
6. 等待首次部署成功并记录 `https://<project>.pages.dev` 地址。

> [!NOTE]
> Pages 的 Dashboard 拖放支持 ZIP 和根目录中的 `_worker.js`，但不编译源码。本项目的 GitHub Workflow 已提前完成 TypeScript、React 和 Worker 的构建。

> **截图 6 占位：Pages Drag and drop 上传 ZIP 页面**  
> 建议文件名：`06-pages-direct-upload.png`

> **截图 7 占位：Pages 首次部署成功页面**  
> 建议文件名：`07-pages-deployment-success.png`

人工验收：部署状态成功；首页能加载。此时 API 因绑定尚未配置而失败属于预期，禁止录入敏感内容。

## 5. 配置兼容性、变量与资源绑定

打开 Pages 项目 **Settings**，在生产环境配置下列项目。Cloudflare 调整控制台布局时，字段可能分别位于 **Bindings**、**Variables and Secrets** 或 **Runtime** 区域。

### 5.1 兼容性

- Compatibility date：`2026-07-11`
- Compatibility flag：`nodejs_compat`

### 5.2 普通环境变量

| 变量名 | 值 | 类型 |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | 当前 Cloudflare Account ID | Text / plaintext |
| `R2_BUCKET_NAME` | `cloud-clipboard` | Text / plaintext |
| `RETENTION_SECONDS` | `86400` | Text / plaintext |
| `MAX_FILE_BYTES` | `5368709120` | Text / plaintext |

Account ID 可从 Dashboard 的账号详情中复制。它是标识符，不是密钥。

### 5.3 D1 和 R2 绑定

1. 添加 **D1 database binding**：Variable name 填 `DB`，数据库选择 `cloud-clipboard`。
2. 添加 **R2 bucket binding**：Variable name 填 `FILES`，Bucket 选择 `cloud-clipboard`。
3. 保存后按控制台提示重新部署。绑定和变量通常需要新部署才能生效；可回到 **Deployments** 创建新部署并重新上传同一个 ZIP。

> **截图 8 占位：Compatibility date 和 nodejs_compat**  
> 建议文件名：`08-pages-compatibility.png`

> **截图 9 占位：四个普通环境变量**  
> 建议文件名：`09-pages-variables.png`

> **截图 10 占位：DB 与 FILES 绑定**  
> 建议文件名：`10-pages-bindings.png`

人工验收：变量名、大小写和值完全一致；`DB` 指向 D1；`FILES` 指向私有 R2；重新部署成功。

## 6. 创建仅限该 Bucket 的 R2 S3 凭据

1. 回到 **R2 object storage** 首页。
2. 在 **Account Details** 下找到 **API Tokens**，选择 **Manage**。
3. 创建 Account API token 或 User API token。
4. 权限选择 **Object Read & Write**。
5. Bucket 范围只选择 `cloud-clipboard`，不要授权全部 Bucket。
6. 创建后，Cloudflare 只显示一次 **Access Key ID** 和 **Secret Access Key**。在安全位置临时保存，禁止复制到仓库、Issue、截图或聊天记录。
7. 回到 Pages 项目的 **Settings > Variables and Secrets**，添加：
   - `R2_ACCESS_KEY_ID`：类型选择 **Secret**，值为 Access Key ID。
   - `R2_SECRET_ACCESS_KEY`：类型选择 **Secret**，值为 Secret Access Key。
8. 保存并重新部署同一个 ZIP，使 Secrets 对新部署生效。

> **截图 11 占位：R2 Token 的权限和单 Bucket 范围（不得包含密钥结果页）**  
> 建议文件名：`11-r2-token-scope.png`

> **截图 12 占位：Pages 中两个 Secret 的名称和已加密状态（不得显示值）**  
> 建议文件名：`12-pages-secrets.png`

人工验收：两个 Secret 名称完全一致且值不可见；Token 仅有目标 Bucket 的 Object Read & Write 权限。

## 7. 配置 R2 CORS

浏览器使用预签名 URL 直接访问私有 R2，因此必须允许生产页面的精确 Origin。

1. 打开 R2 Bucket 的 **Settings > CORS Policy**（界面名称也可能显示为 CORS rules）。
2. 选择添加或编辑规则。
3. 参考仓库 `cloudflare/r2-cors.example.json` 配置：
   - Allowed origins：最终生产 Origin，例如 `https://clipboard.example.com`。
   - Allowed methods：`GET`、`PUT`、`HEAD`。
   - Allowed headers：`content-type`。
   - Exposed headers：`etag`。
   - Max age：`3600` 秒。
4. Origin 必须是 `scheme://host[:port]`，不能包含路径或结尾 `/`。
5. 如需在 `pages.dev` 地址测试上传，可临时把该精确 Origin 作为第二项加入；正式验收后只保留实际使用的 Origin。

> **截图 13 占位：R2 CORS 规则完整配置**  
> 建议文件名：`13-r2-cors.png`

人工验收：没有通配符 Origin；生产 Origin 精确匹配；只开放需要的方法和请求头。

## 8. 绑定自定义域名并配置 Cloudflare Access

1. 在 Pages 项目进入 **Custom domains**，添加最终生产域名并等待状态生效。
2. 进入 **Zero Trust > Access controls > Applications**。
3. 选择 **Create new application > Self-hosted and private > Add public hostname**。
4. Hostname 填写 Pages 项目的完整生产域名，路径保持为空，以保护整个站点和全部 `/api/*` 请求。
5. 创建 **Allow** 策略，只包含受信任邮箱或受控身份组；不要配置公共 Bypass。
6. 设置合适的 Session Duration 并创建应用。
7. 使用无痕窗口访问生产域名，应先跳转到 Cloudflare Access 登录页，而不是直接显示剪切板。

> **截图 14 占位：Pages 自定义域名 Active 状态**  
> 建议文件名：`14-pages-custom-domain.png`

> **截图 15 占位：Access 应用的完整 hostname 和 Allow 策略（隐去私人邮箱）**  
> 建议文件名：`15-access-application.png`

> **截图 16 占位：无痕窗口中的 Access 登录页**  
> 建议文件名：`16-access-login.png`

人工验收：未登录请求被 Access 拦截；Access 覆盖根路径和 `/api/*`；只有授权身份可登录。

## 9. 最终功能验收

登录后仅使用无敏感信息的测试内容：

1. 首页样式和亮色/暗色主题正常。
2. 新建并编辑多条测试文本，确认同一轮编辑只更新当前记录，刷新后列表仍按新到旧显示。
3. 上传一个小型无敏感文件，进度完成后状态进入可下载。
4. 下载该文件并核对内容一致。
5. 删除文件，确认列表立即更新。
6. 检查浏览器开发者工具，API 和 R2 请求无 CORS、绑定或 5xx 错误。

> **截图 17 占位：登录后的首页和文本历史列表**
> 建议文件名：`17-functional-clipboard.png`

> **截图 18 占位：测试文件上传完成后的列表**  
> 建议文件名：`18-functional-file.png`

最终验收表：

| 检查项 | 通过标准 | 结果 |
| --- | --- | --- |
| GitHub 打包 | Workflow 成功，ZIP 根目录结构正确 | ☐ |
| D1 | 两张业务表和索引存在 | ☐ |
| R2 隐私 | Bucket 未公开 | ☐ |
| R2 生命周期 | 全部对象 1 天后删除 | ☐ |
| Pages 部署 | ZIP 上传和重新部署成功 | ☐ |
| 运行时配置 | compatibility、变量、DB/FILES 绑定正确 | ☐ |
| Secrets | 两个密钥名正确、值不可见、Token 仅限单 Bucket | ☐ |
| CORS | 精确 Origin，GET/PUT/HEAD 正常 | ☐ |
| Access | 匿名访问被拦截，授权身份可登录 | ☐ |
| 文本功能 | 保存、刷新、历史顺序正常 | ☐ |
| 文件功能 | 上传、下载、删除正常 | ☐ |

## 10. 后续版本更新

1. 在 GitHub Actions 下载最新的 `cloud-clipboard-pages.zip`。
2. 打开既有 Pages 项目的 **Deployments**。
3. 选择 **Create a new deployment**，上传新 ZIP 到 Production。
4. 部署后重复匿名 Access、文本和小文件检查。
5. D1 只有在仓库出现新的迁移文件时才执行新增迁移；不要重复修改已应用的迁移。

若新版本失败，在 Pages 的 Deployments 中重新激活上一个正常生产部署；D1、R2 等存储状态不会随代码部署一起回滚。

## 官方参考

- [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages advanced mode `_worker.js`](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [D1 getting started](https://developers.cloudflare.com/d1/get-started/)
- [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [R2 API token authentication](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
