#!/usr/bin/env bash
# 一键部署：优先读取 Cloudflare 构建机密 KV_ID 注入 KV 绑定；否则若 wrangler.toml 已含 [[kv_namespaces]] 也行。
# 用法：
#   本地：  export KV_ID=你的KV命名空间id && ./deploy.sh   （或 wrangler.toml 已含 [[kv_namespaces]]）
#   Cloudflare Workers Builds：Build command 设为 ./deploy.sh，并在
#     Worker → Settings → Variables and Secrets 添加 Secret：名称 KV_ID，值=你的 NETEASE_KV 命名空间 id
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
elif grep -q '^\[\[kv_namespaces' wrangler.toml; then
  echo "==> wrangler.toml 已含 KV 绑定，直接部署 ..."
  $W deploy
else
  echo "==> 未检测到 KV_ID 机密，且 wrangler.toml 无 KV 绑定 -> 不使用 KV 部署（worker 将以无 KV 上线）"
  $W deploy
fi
if [ -n "$KV_ID" ] || grep -q '^\[\[kv_namespaces' wrangler.toml; then
  echo "==> 检查 KV 配置占位 ..."
  if $W kv key get --binding "$BINDING" cookie_list >/dev/null 2>&1; then
    echo "    cookie_list 已存在，跳过"
  else
    if $W kv key put --binding "$BINDING" cookie_list '[]' >/dev/null 2>&1; then
      echo "    cookie_list 已写空占位 []，请在 KV 填入黑胶会员 Cookie（如 [\"MUSIC_U=xxxx; os=pc;\"]）"
    else
      echo "    ⚠️ 无法写 cookie_list 占位（构建凭证可能无 KV 写权限），请手动在控制台 NETEASE_KV 添加"
    fi
  fi
  if $W kv key get --binding "$BINDING" api_token >/dev/null 2>&1; then
    echo "    api_token 已存在，跳过"
  else
    if $W kv key put --binding "$BINDING" api_token 'CHANGE_ME_API_TOKEN' >/dev/null 2>&1; then
      echo "    api_token 已写占位 CHANGE_ME_API_TOKEN，请改为你自己的强随机串"
    else
      echo "    ⚠️ 无法写 api_token 占位，请手动在控制台 NETEASE_KV 添加（不填则鉴权关闭）"
    fi
  fi
fi
echo "==> 完成。"
