#!/usr/bin/env bash
# 一键部署：
#   - 若设置了构建机密 KV_ID，则把它注入 wrangler.toml 的 KV 绑定（复用已有 KV，保留其中数据）；
#   - 若未设置，则直接用 wrangler.toml 中“无 id 的 KV 绑定”，由 wrangler 自动创建并绑定（fork 安全）。
# 用法：
#   本地：  export KV_ID=你的KV命名空间id && ./deploy.sh   （KV_ID 可选）
#   Cloudflare Workers Builds：Build command 设为 ./deploy.sh；
#           可选在 Worker → Settings → Variables and Secrets 添加 Secret：名称 KV_ID，值=你的 KV 命名空间 id
# 说明：KV 命名空间 id 不在仓库中，fork 不会冲突；fork 者不设置 KV_ID 时会自动新建自己的 KV。
set -uo pipefail
cd "$(dirname "$0")"
BINDING="NETEASE_KV"
W="npx wrangler"
KV_ID="${KV_ID:-}"
echo "==> wrangler 版本：$($W --version 2>&1 || echo unknown)"
if [ -n "$KV_ID" ]; then
  echo "==> 使用构建机密 KV_ID 注入 KV 绑定 ..."
  cp wrangler.toml .wrangler-deploy.toml
  sed -i '/kv_namespaces/d; /binding = "NETEASE_KV"/d; /# id = /d' .wrangler-deploy.toml
  printf '[[kv_namespaces]]\nbinding = "NETEASE_KV"\nid = "%s"\n' "$KV_ID" >> .wrangler-deploy.toml
  echo "==> 部署（已绑定 KV，配置：.wrangler-deploy.toml）..."
  $W deploy --config .wrangler-deploy.toml
  CFG=".wrangler-deploy.toml"
else
  echo "==> 未设置 KV_ID：wrangler 将自动创建并绑定 KV 命名空间（fork 安全）..."
  $W deploy
  CFG="wrangler.toml"
fi
echo "==> 检查 KV 配置占位（最佳努力）..."
if $W kv key get --binding "$BINDING" cookie_list --config "$CFG" >/dev/null 2>&1; then
  echo "    cookie_list 已存在，跳过"
else
  if $W kv key put --binding "$BINDING" cookie_list '[]' --config "$CFG" >/dev/null 2>&1; then
    echo "    cookie_list 已写空占位 []，请在 KV 填入黑胶会员 Cookie（如 [\"MUSIC_U=xxxx; os=pc;\"]）"
  else
    echo "    ⚠️ 无法写入 cookie_list（可稍后在控制台 NETEASE_KV 手动添加）"
  fi
fi
if $W kv key get --binding "$BINDING" api_token --config "$CFG" >/dev/null 2>&1; then
  echo "    api_token 已存在，跳过"
else
  if $W kv key put --binding "$BINDING" api_token 'CHANGE_ME_API_TOKEN' --config "$CFG" >/dev/null 2>&1; then
    echo "    api_token 已写占位 CHANGE_ME_API_TOKEN，请改为你自己的强随机串"
  else
    echo "    ⚠️ 无法写入 api_token（可稍后在控制台 NETEASE_KV 手动添加；不填则鉴权关闭）"
  fi
fi
echo "==> 完成。"
