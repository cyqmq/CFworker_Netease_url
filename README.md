# 网易云音乐无损解析 · Cloudflare Worker 版

将 [Suxiaoqinx/Netease_url](https://github.com/Suxiaoqinx/Netease_url) 移植到 Cloudflare Workers。
使用 Netease 的 eapi 协议（AES-128-ECB + MD5 自实现，无需任何 npm 依赖）。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?repository-url=https://github.com/cyqmq/CFworker_Netease_url)

> 一键部署后还需：① 在 Workers 设置里 `wrangler secret put COOKIE`（VIP 音质）；② 用到 KV 时先 `wrangler kv namespace create NETEASE_KV` 并把 id 填进 `wrangler.toml`，再 `wrangler kv key put` 写入 `cookie_list`。

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
wrangler deploy          # 如需 KV，先把 wrangler.toml 里 [[kv_namespaces]] 注释取消并填真实 id
```

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

**方式二（Workers Builds 环境变量）**：`Settings` → `Variables and Secrets` → `Add` → 名称 `COOKIE`、值填 Cookie 字符串、类型选 **Secret**。
> ⚠️ 坑：通过 GitHub 自动部署（Workers Builds）时，每次 `git push` 可能会把控制台里设的 `COOKIE` 变量重置为空。若发现 `/health` 显示 `cookie_status: invalid`，优先改用上面的 **KV 方式**。

**方式三（本地 wrangler）**：

```bash
wrangler secret put COOKIE
# 按提示粘贴 Cookie 字符串
```

> 不配置 COOKIE 也能解析标准 / 极高音质（视账号限制），但无损 / Hi-Res / SVIP 需要黑胶会员 Cookie。

### API 鉴权（API_TOKEN，防滥用）

新增一个变量 **`API_TOKEN`**，所有解析接口都必须携带正确 Token，否则返回 `401`。`/health`、`/api/info` 免鉴权。

- **设置方式**：Cloudflare 控制台 → `Settings` → `Variables and Secrets` → `Add` → 名称 `API_TOKEN`、值自定义一个强随机串、类型选 **Secret**。
  - 若用 Workers Builds 自动部署把控制台变量清空了，可在 KV 命名空间 `NETEASE_KV` 里加一个键 **`api_token`**（值同上）作为兜底，Worker 会优先用环境变量、没有再读 KV。
  - **留空 = 关闭鉴权**（兼容调试/自用，但不防滥用）。
- **携带 Token 的三种方式**（任选其一）：
  - 请求头 `Authorization: Bearer <token>`
  - 请求头 `x-api-key: <token>`
  - 查询参数 `?token=<token>`（适合分享链接 / 直接下载跳转）

```bash
# 带 Token 调用示例
curl -H "x-api-key: YOUR_TOKEN" "https://你的worker/song?id=195251&level=exhigh&type=url"
curl "https://你的worker/song?id=195251&level=exhigh&type=url&token=YOUR_TOKEN"
```

> Web 页面已内置 Token 输入框（自动记忆到 localStorage），所有请求会自动带上。

### KV（可选，推荐：Cookie 池 + 直链缓存）

> **绑定名是固定的**：代码中用 `env.NETEASE_KV` 读取，所以 `wrangler.toml` 里的 `binding` 必须叫 `NETEASE_KV`（改名会读不到）。KV 命名空间的 **title 也建议叫 `NETEASE_KV`**（脚本靠 title 查找/复用）。命名空间本身的 **id 每个账号不同**，由下面的脚本/命令自动生成并填入，无需手填。

KV 做两件事：
1. **Cookie 池（轮换，缓解限流）**：多个会员 Cookie 存到 KV 键 `cookie_list`（JSON 数组），每次请求轮询取一个，分散请求避免 `-110` 限流。
2. **直链缓存**：歌曲直链按 `url:{id}:{level}` 缓存，TTL 1100s（网易直链约 20 分钟过期）。

**最简启用（推荐）：用 `deploy.sh` 自动建 + 绑 + 部署**

```bash
./deploy.sh          # 自动创建/复用 NETEASE_KV，把真实 id 注入配置后 wrangler deploy
```

Cloudflare Workers Builds（Deploy 按钮连 GitHub 后）：把该项目的 **Build command** 设为 `./deploy.sh`（默认是 `wrangler deploy`），之后每次 `git push` 都会自动创建/绑定 KV 并部署，无需手动操作。

**手动启用（Workers Builds）步骤**：
1. Cloudflare 控制台 → `Workers & Pages` → `KV` → `Create a namespace`，命名为 `NETEASE_KV`，复制其 ID。
2. 编辑 `wrangler.toml`，取消 `[[kv_namespaces]]` 注释并把 `id` 换成真实值，`git push` 触发重建。
3. 写入 Cookie 池（命令见下，也可在控制台 KV 页手动添加键 `cookie_list`）。

**手动启用（本地 wrangler）**：

```bash
wrangler kv namespace create NETEASE_KV   # 拿到 id，填进 wrangler.toml（或用 ./deploy.sh）
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
