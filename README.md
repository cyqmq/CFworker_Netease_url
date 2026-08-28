# 网易云音乐无损解析 · Cloudflare Worker 版

将 [Suxiaoqinx/Netease_url](https://github.com/Suxiaoqinx/Netease_url) 移植到 Cloudflare Workers。
使用 Netease 的 eapi 协议（AES-128-ECB + MD5 自实现，无需任何 npm 依赖）。

## 功能

- 歌曲搜索、单曲解析、歌词、歌单解析、专辑解析
- 多音质：standard / exhigh / lossless / hires / sky / jyeffect / jymaster / dolby
- 音乐直链获取与代理下载（/download 直接回源流式返回）
- 内置 Web 界面（public/index.html）

## 部署

```bash
npm i -g wrangler        # 或 pnpm add -g wrangler
cd netease-worker

# 1) 创建 KV 命名空间，并把 id 填进 wrangler.toml 的 [[kv_namespaces]].id
wrangler kv namespace create NETEASE_KV

# 2)（可选）单个 Cookie：用 secret 设置，作为无 KV 列表时的回退
wrangler secret put COOKIE
# 内容例如： MUSIC_U=xxxx; os=pc; appver=8.9.70;

wrangler deploy
```

> 不配置 COOKIE / KV 也能解析标准/极高音质（视账号限制），但无损/Hi-Res/SVIP 音质需要黑胶会员 Cookie。
> Cookie 获取：登录 music.163.com → F12 → Network → 复制请求的 Cookie。

### 使用 KV（推荐）

KV 用于两件事：

1. **Cookie 池（轮换，缓解限流）**：把多个会员 Cookie 存到 KV 键 `cookie_list`（JSON 数组），
   每次请求按轮询取一个，分散请求避免 `-110` 限流。
2. **直链缓存**：歌曲解析直链按 `url:{id}:{level}` 缓存，TTL 1100s（网易直链本身约 20 分钟过期）。

写入 Cookie 池：

```bash
wrangler kv key put --binding NETEASE_KV cookie_list \
  '["MUSIC_U=aaaa; os=pc;","MUSIC_U=bbbb; os=pc;","MUSIC_U=cccc; os=pc;"]'
```

查看 / 清空：

```bash
wrangler kv key get  --binding NETEASE_KV cookie_list
wrangler kv key delete --binding NETEASE_KV cookie_index   # 重置轮询游标
```

> 请求中仍可用 `?cookie=` 或请求头 `x-ner-cookie` 临时覆盖服务端 Cookie（优先级最高）。

本地调试：

```bash
wrangler dev
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
