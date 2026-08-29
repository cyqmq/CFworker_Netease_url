#!/usr/bin/env bash
# 一键部署：
#   - 若构建变量 KV_ID 已设置（在 Builds 的“构建过程使用的变量/机密”中配置），则把它注入
#     wrangler.toml 的 KV 绑定，复用你已有的 KV 命名空间（保留其中 cookie_list / api_token）。
#   - 若未设置，则直接用 wrangler.toml 中“无 id 的 KV 绑定”，由 wrangler 自动创建并绑定（fork 安全）。
# 注意：KV_ID 必须配置在“构建过程”作用域，而不是“运行时”作用域——运行时变量/机密会被每次部署重置。
set -uo pipefail
cd "$(dirname "$0")"
BINDING="NETEASE_KV"
W="npx wrangler"
KV_ID="${KV_ID:-}"
echo "==> wrangler 版本：$($W --version 2>&1 || echo unknown)"
if [ -n "$KV_ID" ]; then
  echo "==> 检测到构建变量 KV_ID，注入 KV 绑定（复用已有 KV）..."
  cp wrangler.toml .wrangler-deploy.toml
  sed -i '/kv_namespaces/d; /binding = "NETEASE_KV"/d; /# id = /d' .wrangler-deploy.toml
  printf '[[kv_namespaces]]\nbinding = "NETEASE_KV"\nid = "%s"\n' "$KV_ID" >> .wrangler-deploy.toml
  echo "==> 部署（已绑定 KV，配置：.wrangler-deploy.toml）..."
  $W deploy --config .wrangler-deploy.toml
else
  echo "==> 未设置 KV_ID：wrangler 将自动创建并绑定 KV 命名空间（fork 安全）..."
  $W deploy
fi
echo "==> 完成。请确认 KV 'NETEASE_KV' 已写入 cookie_list 与 api_token。"
