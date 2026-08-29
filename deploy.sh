#!/usr/bin/env bash
# 一键部署脚本：自动创建/复用 KV 命名空间，把真实 id 注入配置后再部署；并为缺失的 KV 键写入占位。
# 用法：
#   本地：  ./deploy.sh
#   Cloudflare Workers Builds：把项目的 Build command 设为 ./deploy.sh 即可每次自动建+绑+部署
set -euo pipefail
cd "$(dirname "$0")"

NS_TITLE="NETEASE_KV"
BINDING="NETEASE_KV"

echo "==> 检查 KV 命名空间 '$NS_TITLE' ..."
ID=$(wrangler kv namespace list --json 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let id="";
    try{const a=JSON.parse(s);const f=a.find(x=>x.title==="NETEASE_KV");if(f)id=f.id;}catch(e){}
    console.log(id);
  });
')
if [ -z "$ID" ]; then
  echo "    未找到，创建新命名空间 ..."
  ID=$(wrangler kv namespace create "$NS_TITLE" --json | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).id)});
  ')
fi
echo "    KV id = $ID"

# 生成部署用配置：把 wrangler.toml 中注释掉的 KV 块替换为生效配置（id 注入真实值）
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
echo "==> 部署（配置：.wrangler-deploy.toml）..."
wrangler deploy --config .wrangler-deploy.toml

# 首次部署：为缺失的 KV 键写入占位并提示（容错，不影响部署结果）
echo "==> 检查 KV 配置占位 ..."
if wrangler kv key get --binding "$BINDING" cookie_list >/dev/null 2>&1; then
  echo "    cookie_list 已存在，跳过"
else
  if wrangler kv key put --binding "$BINDING" cookie_list '[]' >/dev/null 2>&1; then
    echo "    cookie_list 已写入空占位 []，请在 KV 填入黑胶会员 Cookie（值形如 [\"MUSIC_U=xxxx; os=pc;\"]）"
  else
    echo "    ⚠️ 无法写入 cookie_list 占位（可能 KV 权限不足），请手动在控制台 NETEASE_KV 添加键 cookie_list"
  fi
fi
if wrangler kv key get --binding "$BINDING" api_token >/dev/null 2>&1; then
  echo "    api_token 已存在，跳过"
else
  if wrangler kv key put --binding "$BINDING" api_token 'CHANGE_ME_API_TOKEN' >/dev/null 2>&1; then
    echo "    api_token 已写入占位 CHANGE_ME_API_TOKEN，请改为你自己的强随机串（否则外部调用需带此占位值）"
  else
    echo "    ⚠️ 无法写入 api_token 占位，请手动在控制台 NETEASE_KV 添加键 api_token（不填则鉴权关闭）"
  fi
fi
echo "==> 完成。访问 /health 确认 cookie_status，外部无 token 调 /song 应返回 401。"
