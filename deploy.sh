#!/usr/bin/env bash
# 一键部署：自动查找/创建名为 NETEASE_KV 的 KV 命名空间并绑定，再部署；为缺失的 KV 键写占位。
# 用法：
#   本地：  ./deploy.sh
#   Cloudflare Workers Builds：把 Build command 设为 ./deploy.sh（原默认 npx wrangler deploy）
set -uo pipefail
cd "$(dirname "$0")"

NS_TITLE="NETEASE_KV"
BINDING="NETEASE_KV"
W="npx wrangler"   # 与原构建命令保持一致

echo "==> wrangler 版本：$($W --version 2>&1 || echo 'unknown')"
echo "==> 查找/创建 KV 命名空间 '$NS_TITLE' ..."

ID=""
RAW=$($W kv namespace list --json 2>&1) || echo "  (wrangler kv list 失败，详见下方错误)"
if echo "$RAW" | head -c 200 | grep -qi 'error\|permission\|unauthorized\|not found'; then
  echo "  wrangler kv list 返回："; echo "$RAW" | head -c 600
else
  ID=$(echo "$RAW" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let id="";
      try{const a=JSON.parse(s);const f=a.find(x=>x.title==="NETEASE_KV");if(f)id=f.id;}catch(e){}
      console.log(id);
    });
  ')
fi

if [ -z "$ID" ]; then
  echo "    未找到，尝试创建 ..."
  RAW2=$($W kv namespace create "$NS_TITLE" --json 2>&1) || echo "  (wrangler kv create 失败，详见下方错误)"
  if echo "$RAW2" | head -c 200 | grep -qi 'error\|permission\|unauthorized\|not found'; then
    echo "  wrangler kv create 返回："; echo "$RAW2" | head -c 600
  else
    ID=$(echo "$RAW2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).id)}catch(e){}});')
  fi
fi

if [ -n "$ID" ]; then
  echo "    KV id = $ID"
  node -e '
    const fs=require("fs");
    let t=fs.readFileSync("wrangler.toml","utf8");
    const block="[[kv_namespaces]]\nbinding = \"NETEASE_KV\"\nid = \"'"$ID"'\""\n";
    if(t.includes("# [[kv_namespaces]]")){
      t=t.replace(/# \[\[kv_namespaces\]\][\s\S]*?# id = .*/m, block);
    } else if(!t.includes("[[kv_namespaces]]")){
      t=t.replace(/\[assets\]/, block+"[assets]");
    }
    fs.writeFileSync(".wrangler-deploy.toml", t);
  '
  echo "==> 部署（已绑定 KV，配置：.wrangler-deploy.toml）..."
  $W deploy --config .wrangler-deploy.toml
else
  echo "    ⚠️ 未能获取/创建 KV 命名空间（权限/网络问题，错误见上）。将不使用 KV 部署。"
  echo "==> 部署（不含 KV，配置：wrangler.toml）..."
  $W deploy
fi

# 首次部署：为缺失的 KV 键写占位（容错）
if [ -n "$ID" ]; then
  echo "==> 检查 KV 配置占位 ..."
  if $W kv key get --binding "$BINDING" cookie_list >/dev/null 2>&1; then
    echo "    cookie_list 已存在，跳过"
  else
    if $W kv key put --binding "$BINDING" cookie_list '[]' >/dev/null 2>&1; then
      echo "    cookie_list 已写空占位 []，请在 KV 填入黑胶会员 Cookie（如 [\"MUSIC_U=xxxx; os=pc;\"]）"
    else
      echo "    ⚠️ 无法写 cookie_list 占位，请手动在控制台 NETEASE_KV 添加"
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
