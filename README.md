# 网易云音乐无损解析 · Cloudflare Worker 版

将 [Suxiaoqinx/Netease_url](https://github.com/Suxiaoqinx/Netease_url) 移植到 Cloudflare Workers。
使用 Netease 的 eapi 协议（AES-128-ECB + MD5 自实现，无需任何 npm 依赖）。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?repository-url=https://github.com/cyqmq/CFworker_Netease_url)

> 一键部署后请按下方「部署 Checklist（速查）」配置：把 **Build command 改为 `./deploy.sh`**，并在 KV 写入 `cookie_list` / `api_token`。Cookie 与 Token 都用 KV 存储，不要用控制台变量（会被 git 部署清空）。

## 功能

- 歌曲搜索、单曲解析、歌词、歌单解析、专辑解析
- 多音质：standard / exhigh / lossless / hires / sky / jyeffect / jymaster / dolby
- 音乐直链获取与代理下载（/download 直接回源流式返回）
- 内置 Web 界面（public/index.html）

## 部署

本项目支持两种部署方式，任选其一。

### 方式一：一键 Deploy（Cloudflare Workers Builds，推荐）

点击 README 顶部的 **Deploy to Cloudflare Workers** 按钮，或访问：

```
https://deploy.workers.cloudflare.com/?repository-url=https://github.com/cyqmq/CFworker_Netease_url
```

按提示用 GitHub 和 Cloudflare 账号授权，会自动连接仓库并构建部署。
此后**每次 `git push` 都会自动重新部署**（Cloudflare Workers Builds 监听仓库）。

部署后基础功能立即可用（标准 / 极高音质）。要解锁会员无损音质与 KV，见下方「变量与 KV 配置」。

### 方式二：本地 wrangler deploy

```bash
npm i -g wrangler        # 或 pnpm add -g wrangler
cd netease-worker
wrangler deploy          # 如需 KV（Cookie 池/缓存），直接跑 ./deploy.sh（自动建+绑+部署）
```

## 部署 Checklist（速查）

1. **部署代码**：点 README 顶部 Deploy 按钮连接 GitHub 仓库，或用本地 `wrangler deploy`。
2. **改 Build command（关键）**：`Workers & Pages → 本项目 → Settings → Build → Build command` 改为 `./deploy.sh`（默认是 `wrangler deploy`），改完 Retry 一次部署。
   - 作用：脚本自动创建/复用 KV 命名空间 `NETEASE_KV` 并**绑定到 Worker**。否则 KV 不绑定，`cookie_list` / `api_token` 都读不到。
3. **填 Cookie（会员无损必填）**：在 KV `NETEASE_KV` 写键 `cookie_list` = `["MUSIC_U=xxxx; os=pc;"]`。
   - 控制台变量 `COOKIE` 会被 git 部署清空，**不要用**。
4. **开鉴权（推荐）**：在 KV `NETEASE_KV` 写键 `api_token` = 任意强随机串。外部调用需带它，同源页面免 token。
5. **验证**：
   - `GET /health` → `cookie_status: "valid"`
   - 外部无 token 调 `/song` → `401`
   - 带 `x-api-key: 你的token` 调 `/song` → `200` + 直链
6. **（可选）自定义域名**：`Workers → 本项目 → 域名`，绑定你的域名（如 `yy.xn--ykq675h.cn`）。

> 首次部署脚本会自动给缺失的 `cookie_list` / `api_token` 写入占位并提示，你再去 KV 改成真实值即可。

## 变量与 KV 配置

### COOKIE（必填才能用会员无损音质）

内容：黑胶会员账号的 Cookie，格式例如：

```
MUSIC_U=xxxx; os=pc; appver=8.9.70;
```

获取方式：登录 music.163.com → F12 → Network → 任意请求 → 复制 `Cookie` 请求头。

**方式一（最稳，推荐用 KV Cookie 池，不受 git 部署影响）**：把 Cookie 写进 KV 键 `cookie_list`（JSON 数组），KV 与部署解耦，每次 `git push` 不会把它清掉。
- 控制台：`Workers & Pages` → `KV` → `NETEASE_KV` → `Add key`
  - key：`cookie_list`
  - value：`["MUSIC_U=xxxx; os=pc;"]`（数组里可放多个轮询）
- 或本地：`wrangler kv key put --binding NETEASE_KV cookie_list '["MUSIC_U=xxxx; os=pc;"]'`

**方式二（Workers Builds 环境变量，不推荐）**：`Settings` → `Variables and Secrets` → `Add` → 名称 `COOKIE`、值填 Cookie 字符串、类型选 **Secret**。
> ⚠️ 坑：通过 GitHub 自动部署（Workers Builds）时，每次 `git push` **都会把控制台里设的 `COOKIE` 变量重置掉**。所以不要用这种方式，优先用上面的 **KV 方式**。

**方式三（本地 wrangler）**：

```bash
wrangler secret put COOKIE
# 按提示粘贴 Cookie 字符串
```

> 不配置 COOKIE 也能解析标准 / 极高音质（视账号限制），但无损 / Hi-Res / SVIP 需要黑胶会员 Cookie。

### API 鉴权（API_TOKEN，防滥用）

新增一个变量 **`API_TOKEN`**，用于防止别人把你部署的 Worker 当公共 API 滥用。**Token 只存在于服务端变量，前端页面不存放、也不展示。**

鉴权规则：
- `API_TOKEN` **未设置** → 关闭鉴权（兼容调试/自用）。
- `API_TOKEN` **已设置**：
  - **同源请求**（来自你自己的页面，即请求 `Origin`/`Referer` 的域名与 Worker 域名一致）→ 自动放行，前端页面正常用，**无需任何 token**。
  - **外部请求**（curl、其他网站调用等）→ 必须携带正确 Token，否则返回 `401`。

- **设置方式（推荐 KV，最稳）**：在 KV 命名空间 `NETEASE_KV` 加键 **`api_token`**，值为任意强随机串（纯文本，不要加引号/JSON）。Worker 每次请求读取，不受 git 部署清空。
  - 兜底机制：Worker 优先读环境变量 `API_TOKEN`，没有再读 KV `api_token`。若你确实想用控制台 Secret `API_TOKEN`，注意 Workers Builds 的 `git push` **每次都会把它清空**，不如直接放 KV。
- **外部调用携带 Token 的三种方式**（任选其一）：
  - 请求头 `Authorization: Bearer <token>`
  - 请求头 `x-api-key: <token>`
  - 查询参数 `?token=<token>`（适合分享链接 / 直接下载跳转）

```bash
# 外部调用需带 Token
curl -H "x-api-key: YOUR_TOKEN" "https://你的worker/song?id=195251&level=exhigh&type=url"
curl "https://你的worker/song?id=195251&level=exhigh&type=url&token=YOUR_TOKEN"
# 无 token 的外部请求 → 401
```

### KV（推荐：Cookie 池 + 直链缓存）

> **绑定名是固定的**：代码中用 `env.NETEASE_KV` 读取，所以 `wrangler.toml` 里的 `binding` 必须叫 `NETEASE_KV`（改名会读不到）。

KV 做两件事：
1. **Cookie 池（轮换，缓解限流）**：多个会员 Cookie 存到 KV 键 `cookie_list`（JSON 数组），每次请求轮询取一个，分散请求避免 `-110` 限流。
2. **直链缓存**：歌曲直链按 `url:{id}:{level}` 缓存，TTL 1100s（网易直链约 20 分钟过期）。

**无需手动填 id（fork 安全）**：`wrangler.toml` 里的 KV 绑定**故意不写 id**。部署时 wrangler（4.45+）会自动在你的账号下创建 `NETEASE_KV` 命名空间并绑定——因为仓库里没有写死任何账号相关的 id，别人 **fork 后部署会得到他们自己的 KV，不会与你冲突**。

- ⚠️ **不要用 Runtime variables / secrets 存任何持久数据**：Workers Builds 每次 `git push` 部署都会把控制台手动加的 Secret / Variable **重置掉**。所以 Cookie、Token、以及 KV 命名空间 id 都**不要**依赖运行时变量。
- 正因为如此，本项目**只用 KV 存数据**：把 `cookie_list` / `api_token` 写进 KV 即可，它们跟着 KV 命名空间走，部署不会清掉。命名空间本身由 wrangler 自动创建并绑定，仓库里不含任何 id，**fork 安全**。
- （可选）想复用**已存在**的 KV（里面已填好 `cookie_list` / `api_token`）：在 Builds 的 **「构建过程使用的变量/机密」** 里加 `KV_ID` = 该命名空间 id（注意必须是**构建作用域**，不是运行时；运行时变量会被部署重置）。`./deploy.sh` 会把它注入并绑定；不设置则自动新建一个空 KV。

**最简启用（推荐）**：把 Build command 设为 `./deploy.sh`，`git push` 即自动部署（并自动建/绑 KV），无需手动操作。

```bash
./deploy.sh          # wrangler 自动创建/复用并绑定 KV（不依赖任何构建 Secret）
```

写入 / 查看 / 清空 Cookie 池：

```bash
wrangler kv key put --binding NETEASE_KV cookie_list \
  '["MUSIC_U=aaaa; os=pc;","MUSIC_U=bbbb; os=pc;","MUSIC_U=cccc; os=pc;"]'
wrangler kv key get  --binding NETEASE_KV cookie_list
wrangler kv key delete --binding NETEASE_KV cookie_index   # 重置轮询游标
```

> 请求也可用 `?cookie=` 或请求头 `x-ner-cookie` 临时覆盖服务端 Cookie（优先级最高）。

## 本地调试

```bash
wrangler dev                                   # 默认 http://localhost:8787，自动托管 public/index.html
COOKIE='MUSIC_U=xxx' wrangler dev              # 带 Cookie 测 VIP 音质
wrangler dev --ip 0.0.0.0 --port 8787          # 局域网访问（手机/其他设备可打开）
```

## API

Base URL 为你的 Worker 地址。支持 GET（query）与 POST（JSON 或 form）。

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/health` | GET | - | 健康检查，显示 cookie 状态 |
| `/api/info` | GET | - | API 信息 |
| `/song` | GET/POST | `id` 或 `url`，`level`，`type`(url/name/lyric/json) | 单曲解析 |
| `/search` | GET/POST | `keyword`，`limit` | 歌曲搜索 |
| `/playlist` | GET/POST | `id` | 歌单解析（批量拉取曲目） |
| `/album` | GET/POST | `id` | 专辑解析 |
| `/download` | GET/POST | `id`，`quality`，`format`(file/json) | 下载/解析 |

所有接口支持 CORS（`Access-Control-Allow-Origin: *`）。

也可通过 `?cookie=` 或请求头 `x-ner-cookie` 临时覆盖服务端 Cookie。

## 说明

- 单文件 Worker，零依赖，纯 Web 标准 API 实现 AES/MD5。
- 加密逻辑与上游 Python 版完全一致，已通过 MD5 / AES 测试向量与真实接口联调验证。
- 仅供学习研究，请遵守网易云音乐相关条款与开源协议（MIT）。
