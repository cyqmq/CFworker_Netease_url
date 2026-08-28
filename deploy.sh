#!/usr/bin/env bash
# 一键部署脚本：自动创建/复用 KV 命名空间，把真实 id 注入配置后再部署。
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
