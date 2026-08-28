// 本地冒烟测试：无需 Cloudflare 账号，直接调用 worker 逻辑（Node 22+ 自带 fetch/Request/Response）
// 用法： node test.mjs
import worker from './src/worker.js';

const env = { COOKIE: process.env.COOKIE || '' }; // 可选：COOKIE=xxx node test.mjs
const call = async (path, body) => {
  const req = new Request('http://localhost' + path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : { method: 'GET' });
  const res = await worker.fetch(req, env);
  return res.json();
};

const log = (t, v) => console.log(t, typeof v === 'string' ? v : JSON.stringify(v));

log('== /health ==', await call('/health'));

const s = await call('/search', { keyword: '周杰伦 稻香', limit: 3 });
log('== /search ==', (s.data || []).map((x) => `${x.id} ${x.name} - ${x.artists}`));

log('== /song url ==', await call('/song', { id: '195251', level: 'standard', type: 'url' }));

const a = await call('/album', { id: '34743109' });
log('== /album ==', `${a.data?.album?.name} | tracks:${a.data?.album?.songs?.length}`);

const pl = await call('/playlist', { id: '2478165303' });
log('== /playlist ==', `${pl.data?.playlist?.name} | tracks:${pl.data?.playlist?.tracks?.length}`);
