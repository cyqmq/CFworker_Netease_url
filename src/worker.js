/**
 * 网易云音乐无损解析 - Cloudflare Worker 版
 * 移植自 https://github.com/Suxiaoqinx/Netease_url
 *
 * 部署：
 *   wrangler secret put COOKIE   # 填入黑胶会员 Cookie
 *   wrangler deploy
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154';
const REFERER = 'https://music.163.com/';

const API = {
  // 播放直链：interface3 常被数据中心 IP 封锁，优先用 music.163.com 主机（CF 可达），interface3 作兜底
  SONG_URL_V1: 'https://music.163.com/eapi/song/enhance/player/url/v1',
  SONG_URL_V1_ALT: 'https://interface3.music.163.com/eapi/song/enhance/player/url/v1',
  SONG_DETAIL_V3: 'https://interface3.music.163.com/api/v3/song/detail',
  LYRIC: 'https://interface3.music.163.com/api/song/lyric',
  SEARCH: 'https://music.163.com/api/cloudsearch/pc',
  PLAYLIST: 'https://music.163.com/api/v6/playlist/detail',
  ALBUM: 'https://music.163.com/api/v1/album/',
};

const VALID_LEVELS = ['standard', 'exhigh', 'lossless', 'hires', 'sky', 'jyeffect', 'jymaster', 'dolby'];

/* ============================ 加密工具 ============================ */

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/* ---- MD5 (返回 Uint8Array) ---- */
function md5Raw(msgBytes) {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  const bitLen = msgBytes.length * 8;
  const newLen = (((msgBytes.length + 8) >> 6) + 1) * 64;
  const bytes = new Uint8Array(newLen);
  bytes.set(msgBytes);
  bytes[msgBytes.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(newLen - 8, bitLen >>> 0, true);
  view.setUint32(newLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let off = 0; off < newLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  const hv = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) {
    out[i * 4] = hv[i] & 0xff;
    out[i * 4 + 1] = (hv[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (hv[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (hv[i] >>> 24) & 0xff;
  }
  return out;
}
const md5hex = (s) => toHex(md5Raw(typeof s === 'string' ? enc(s) : s));

/* ---- AES-128 ECB ---- */
const SBOX = (() => {
  const sbox = new Uint8Array(256);
  const mul = (a, b) => {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  };
  const gfInv = (a) => {
    if (a === 0) return 0;
    let r = 1;
    for (let i = 0; i < 254; i++) r = mul(r, a);
    return r;
  };
  for (let i = 0; i < 256; i++) {
    let inv = gfInv(i);
    let r = inv, res = inv;
    for (let j = 0; j < 4; j++) { r = ((r << 1) | (r >> 7)) & 0xff; res ^= r; }
    sbox[i] = res ^ 0x63;
  }
  return sbox;
})();

function keyExpansion(key) {
  const w = new Uint8Array(176);
  w.set(key.subarray(0, 16), 0);
  const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
  for (let i = 4; i < 44; i++) {
    let t0, t1, t2, t3;
    if (i % 4 === 0) {
      const a = w[(i - 1) * 4], b = w[(i - 1) * 4 + 1], c = w[(i - 1) * 4 + 2], d = w[(i - 1) * 4 + 3];
      t0 = SBOX[b]; t1 = SBOX[c]; t2 = SBOX[d]; t3 = SBOX[a];
      t0 ^= rcon[i / 4 - 1];
    } else {
      t0 = w[(i - 1) * 4]; t1 = w[(i - 1) * 4 + 1]; t2 = w[(i - 1) * 4 + 2]; t3 = w[(i - 1) * 4 + 3];
    }
    t0 ^= w[(i - 4) * 4]; t1 ^= w[(i - 4) * 4 + 1]; t2 ^= w[(i - 4) * 4 + 2]; t3 ^= w[(i - 4) * 4 + 3];
    w[i * 4] = t0; w[i * 4 + 1] = t1; w[i * 4 + 2] = t2; w[i * 4 + 3] = t3;
  }
  return w;
}

function aesEncryptBlock(block, w) {
  const state = block.slice();
  const addRoundKey = (r) => { for (let i = 0; i < 16; i++) state[i] ^= w[r * 16 + i]; };
  const subBytes = () => { for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]]; };
  const shiftRows = () => {
    const t = state.slice();
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) state[r + 4 * c] = t[r + 4 * ((c + r) % 4)];
  };
  const xtime = (a) => { let r = (a << 1) & 0xff; if (a & 0x80) r ^= 0x1b; return r; };
  const mixColumns = () => {
    for (let c = 0; c < 4; c++) {
      const i = 4 * c;
      const s0 = state[i], s1 = state[i + 1], s2 = state[i + 2], s3 = state[i + 3];
      state[i] = xtime(s0) ^ (xtime(s1) ^ s1) ^ s2 ^ s3;
      state[i + 1] = s0 ^ xtime(s1) ^ (xtime(s2) ^ s2) ^ s3;
      state[i + 2] = s0 ^ s1 ^ xtime(s2) ^ (xtime(s3) ^ s3);
      state[i + 3] = (xtime(s0) ^ s0) ^ s1 ^ s2 ^ xtime(s3);
    }
  };
  addRoundKey(0);
  for (let r = 1; r <= 9; r++) { subBytes(); shiftRows(); mixColumns(); addRoundKey(r); }
  subBytes(); shiftRows(); addRoundKey(10);
  return state;
}

/* 匹配 Python json.dumps 默认格式 (ensure_ascii=True, ", " 与 ": ") */
function pyJson(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'number') return Number.isInteger(obj) ? String(obj) : String(obj);
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'string') {
    let s = '"';
    for (const ch of obj) {
      const code = ch.codePointAt(0);
      if (code === 0x22) s += '\\"';
      else if (code === 0x5c) s += '\\\\';
      else if (code === 0x08) s += '\\b';
      else if (code === 0x0c) s += '\\f';
      else if (code === 0x0a) s += '\\n';
      else if (code === 0x0d) s += '\\r';
      else if (code === 0x09) s += '\\t';
      else if (code < 0x20) s += '\\u' + code.toString(16).padStart(4, '0');
      else if (code > 0x7f) s += '\\u' + code.toString(16).padStart(4, '0');
      else s += ch;
    }
    return s + '"';
  }
  if (Array.isArray(obj)) return '[' + obj.map(pyJson).join(', ') + ']';
  const parts = Object.keys(obj).map((k) => pyJson(k) + ': ' + pyJson(obj[k]));
  return '{' + parts.join(', ') + '}';
}

function encryptParams(url, payload) {
  const u = new URL(url);
  const path = u.pathname.replace('/eapi/', '/api/');
  const json = pyJson(payload);
  const digest = md5hex(`nobody${path}use${json}md5forencrypt`);
  const params = `${path}-36cd479b6b5-${json}-36cd479b6b5-${digest}`;
  const data = enc(params);
  const pad = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + pad);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) padded[i] = pad;
  const key = enc('e82ckenh8dichen8');
  const w = keyExpansion(key);
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) out.set(aesEncryptBlock(padded.subarray(i, i + 16), w), i);
  return toHex(out);
}

/* ============================ 请求辅助 ============================ */

/* 从 KV Cookie 池轮换取一个 Cookie，回退到 env.COOKIE */
async function getCookieFromPool(kv, env) {
  let list = [];
  if (kv) {
    try { const raw = await kv.get('cookie_list'); if (raw) list = JSON.parse(raw); } catch (_) {}
  }
  if (!Array.isArray(list) || list.length === 0) return env.COOKIE || '';
  let idx = 0;
  if (kv) {
    try { idx = parseInt((await kv.get('cookie_index')) || '0', 10) || 0; } catch (_) {}
    const next = (idx + 1) % list.length;
    kv.put('cookie_index', String(next)).catch(() => {});
  }
  return list[idx % list.length];
}

function buildCookie(userCookie) {
  const merged = { os: 'pc', appver: '', osver: '', deviceId: 'pyncm!' };
  if (userCookie) {
    for (const part of userCookie.split(/[;\n]/)) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) merged[k] = v;
      }
    }
  }
  return Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ');
}

const baseHeaders = (cookieStr) => ({
  'User-Agent': UA,
  'Referer': REFERER,
  'Cookie': cookieStr,
});

async function eapiRequest(url, payload, cookieStr) {
  const params = encryptParams(url, payload);
  const body = `params=${encodeURIComponent(params)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders(cookieStr), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return resp.json();
}

async function apiRequest(url, form, cookieStr, method = 'POST') {
  let body = null;
  const headers = baseHeaders(cookieStr);
  if (method === 'POST') {
    body = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(form).toString();
  }
  const resp = await fetch(url, { method, headers, body });
  return resp.json();
}

/* ============================ 扫码登录（eapi） ============================ */

/* 从 Set-Cookie（数组或字符串）解析出 "name=value; name=value" 形式的 cookie 串 */
function parseSetCookie(val) {
  const arr = Array.isArray(val) ? val : (val || '').split(',');
  const parts = [];
  for (const item of arr) {
    const pair = item.split(';')[0].trim();
    if (pair && pair.includes('=')) parts.push(pair);
  }
  return parts.join('; ');
}

/* 网易云扫码登录：参考 laowang/Netease_url，使用 eapi 加密（AES-128-ECB + MD5），
   无需 RSA/weapi。interface3 域名在 CF 上被墙，改用 music.163.com 主机。 */
async function handleQrGenerate() {
  const config = { os: 'pc', appver: '', osver: '', deviceId: 'pyncm!' };
  const payload = { type: 1, header: pyJson(config) };
  const r = await eapiRequest('https://music.163.com/eapi/login/qrcode/unikey', payload, '');
  const unikey = r && r.unikey;
  if (!unikey) return err('获取二维码失败: ' + JSON.stringify(r), 500);
  return ok({ unikey, qr_url: `https://music.163.com/login?codekey=${unikey}` }, '获取二维码成功');
}

async function handleQrCheck(key) {
  if (!key) return err("必须提供 'key'");
  const config = { os: 'pc', appver: '', osver: '', deviceId: 'pyncm!' };
  const payload = { key, type: 1, header: pyJson(config) };
  const url = 'https://music.163.com/eapi/login/qrcode/client/login';
  const params = encryptParams(url, payload);
  const body = `params=${encodeURIComponent(params)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders(''), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  let r = {};
  try { r = await resp.json(); } catch (_) {}
  const code = (r && r.code) || 0;
  let cookie = '';
  if (code === 803) {
    const sc = (resp.headers && resp.headers.getSetCookie)
      ? resp.headers.getSetCookie()
      : (resp.headers.get('set-cookie') || '');
    cookie = parseSetCookie(sc);
  }
  return ok({
    code,
    cookie,
    message: (r && r.message) || '',
  }, '检查完成');
}

/* ============================ 网易云 API ============================ */

function neteaseEncryptId(idStr) {
  const magic = '3go8&$8*3*3h0k(2)2';
  const arr = idStr.split('');
  for (let i = 0; i < arr.length; i++) {
    arr[i] = String.fromCharCode(arr[i].charCodeAt(0) ^ magic.charCodeAt(i % magic.length));
  }
  const m = arr.join('');
  const raw = md5Raw(enc(m));
  let result = btoa(String.fromCharCode(...raw)).replace('/', '_').replace('+', '-');
  return result;
}
function getPicUrl(picId, size = 300) {
  if (picId == null) return '';
  return `https://p3.music.126.net/${neteaseEncryptId(String(picId))}/${picId}.jpg?param=${size}y${size}`;
}

function genRequestId() {
  return String(Math.floor(Math.random() * 10000000) + 20000000);
}

async function getSongUrl(songId, level, cookieStr, kv) {
  const cacheKey = `url:${songId}:${level}`;
  if (kv) {
    try { const c = await kv.get(cacheKey); if (c) return JSON.parse(c); } catch (_) {}
  }
  const config = { os: 'pc', appver: '', osver: '', deviceId: 'pyncm!', requestId: genRequestId() };
  const payload = {
    ids: [Number(songId)],
    level,
    encodeType: level === 'dolby' ? 'mp4' : 'flac',
    header: pyJson(config),
  };
  if (level === 'sky') payload.immerseType = 'c51';
  let r = null;
  for (const host of [API.SONG_URL_V1, API.SONG_URL_V1_ALT]) {
    r = await eapiRequest(host, payload, cookieStr);
    const d = r?.data?.[0] || r?.data;
    if (d?.url || d?.data?.url) break;
    if (r?.code === -110) await new Promise((s) => setTimeout(s, 800));
  }
  if (kv && (r?.data?.[0]?.url || r?.data?.url)) {
    kv.put(cacheKey, JSON.stringify(r), { expirationTtl: 1100 }).catch(() => {});
  }
  return r;
}

function getSongDetail(songId, cookieStr) {
  return apiRequest(API.SONG_DETAIL_V3, { c: pyJson([{ id: Number(songId), v: 0 }]) }, cookieStr);
}
function getLyric(songId, cookieStr) {
  return apiRequest(API.LYRIC, {
    id: String(songId), cp: 'false', tv: '0', lv: '0', rv: '0', kv: '0', yv: '0', ytv: '0', yrv: '0',
  }, cookieStr);
}
function searchMusic(keywords, cookieStr, limit = 30) {
  return apiRequest(API.SEARCH, { s: keywords, type: '1', limit: String(limit) }, cookieStr);
}
function getPlaylistDetail(playlistId, cookieStr) {
  return apiRequest(API.PLAYLIST, { id: String(playlistId) }, cookieStr);
}
function getAlbumDetail(albumId, cookieStr) {
  return apiRequest(API.ALBUM + albumId, {}, cookieStr, 'GET');
}

/* ============================ 工具 ============================ */

async function extractMusicId(input) {
  input = input.trim();
  if (input.includes('163cn.tv')) {
    try {
      const r = await fetch(input, { redirect: 'follow' });
      input = r.url;
    } catch (_) { /* ignore */ }
  }
  if (input.includes('music.163.com')) {
    const idx = input.indexOf('id=');
    if (idx > -1) return input.slice(idx + 3).split('&')[0].split('#')[0];
  }
  return input;
}

function formatSize(bytes) {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let s = Number(bytes), i = 0;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(2)}${units[i]}`;
}

const QUALITY_NAMES = {
  standard: '标准音质', exhigh: '极高音质', lossless: '无损音质', hires: 'Hi-Res音质',
  sky: '沉浸环绕声', jyeffect: '高清环绕声', jymaster: '超清母带', dolby: '杜比全景声',
};

/* ============================ 响应封装 ============================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}
function ok(data, message = 'success') {
  return json({ status: 200, success: true, message, data }, 200);
}
function err(message, status = 400) {
  return json({ status, success: false, message }, status);
}

/* ============================ API 鉴权 ============================ */

/* 取 API Token：优先环境变量 API_TOKEN，其次 KV 键 api_token（Workers Builds 可能清空控制台变量，KV 更稳） */
async function resolveApiToken(kv, env) {
  const fromEnv = (env.API_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  if (kv) {
    try { const v = await kv.get('api_token'); if (v) return v.trim(); } catch (_) {}
  }
  return '';
}

/* 判断请求是否来自同源（即你自己部署的页面）。Origin/Referer 的 host 与请求 host 一致即为同源 */
function isSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin) { try { if (new URL(origin).host === url.host) return true; } catch (_) {} }
  const referer = request.headers.get('Referer');
  if (referer) { try { if (new URL(referer).host === url.host) return true; } catch (_) {} }
  return false;
}

function checkAuth(request, url, apiToken) {
  const p = url.pathname.toLowerCase();
  if (p === '/health' || p === '/api/info' || p.startsWith('/login/qr')) return null; // 放行健康检查、信息接口与扫码登录
  if (!apiToken) return null; // 未配置则关闭鉴权（兼容调试/自用）
  if (isSameOrigin(request, url)) return null; // 同源（你自己的页面）免 token
  // 外部调用：必须携带正确 token
  const auth = request.headers.get('Authorization') || '';
  let provided = '';
  if (auth.toLowerCase().startsWith('bearer ')) provided = auth.slice(7).trim();
  if (!provided) provided = request.headers.get('x-api-key') || '';
  if (!provided) provided = url.searchParams.get('token') || '';
  if (provided && provided === apiToken) return null;
  return err('未授权：外部调用需携带正确的 API Token', 401);
}

/* ============================ 路由 ============================ */

async function handleSong(data, cookieStr, kv) {
  const songIds = data.ids || data.id || data.url;
  const url = data.url;
  const level = data.level || 'lossless';
  const type = data.type || 'url';
  if ((!songIds && !url) || !level) return err("必须提供 'id' / 'ids' / 'url' 与 'level'");
  if (!VALID_LEVELS.includes(level)) return err(`无效的音质参数: ${level}`);
  if (!['url', 'name', 'lyric', 'json'].includes(type)) return err(`无效的类型参数: ${type}`);

  const musicId = await extractMusicId(String(songIds || url));

  try {
    if (type === 'url') {
      const r = await getSongUrl(musicId, level, cookieStr, kv);
      const d = r?.data?.[0];
      if (!d || !d.url) return err('获取音乐 URL 失败，可能是版权限制或音质不支持', 404);
      return ok({
        id: d.id, url: d.url, level: d.level,
        quality_name: QUALITY_NAMES[d.level] || d.level,
        size: d.size, size_formatted: formatSize(d.size),
        type: d.type, bitrate: d.br,
      }, '获取歌曲 URL 成功');
    }
    if (type === 'name') {
      const r = await getSongDetail(musicId, cookieStr);
      return ok(r, '获取歌曲信息成功');
    }
    if (type === 'lyric') {
      const r = await getLyric(musicId, cookieStr);
      return ok(r, '获取歌词成功');
    }
    // json
    const songInfo = await getSongDetail(musicId, cookieStr);
    const urlInfo = await getSongUrl(musicId, level, cookieStr, kv);
    const lyricInfo = await getLyric(musicId, cookieStr);
    const sd = songInfo?.songs?.[0];
    if (!sd) return err('未找到歌曲信息', 404);
    const out = {
      id: musicId, name: sd.name,
      ar_name: (sd.ar || []).map((a) => a.name).join(', '),
      al_name: sd.al?.name || '',
      pic: sd.al?.picUrl || '',
      level,
      lyric: lyricInfo?.lrc?.lyric || '',
      tlyric: lyricInfo?.tlyric?.lyric || '',
    };
    const ud = urlInfo?.data?.[0];
    if (ud && ud.url) { out.url = ud.url; out.size = formatSize(ud.size); out.level = ud.level; }
    else { out.url = ''; out.size = '获取失败'; }
    return ok(out, '获取歌曲信息成功');
  } catch (e) {
    return err('服务器错误: ' + e.message, 500);
  }
}

async function handleSearch(data, cookieStr) {
  const keyword = data.keyword || data.keywords || data.q;
  if (!keyword) return err("必须提供 'keyword'");
  const limit = Math.min(parseInt(data.limit || '30', 10) || 30, 100);
  try {
    const r = await searchMusic(keyword, cookieStr, limit);
    const songs = (r?.result?.songs || []).map((it) => ({
      id: it.id, name: it.name,
      artists: (it.ar || []).map((a) => a.name).join('/'),
      album: it.al?.name || '', picUrl: it.al?.picUrl || '',
    }));
    return ok(songs, '搜索完成');
  } catch (e) {
    return err('搜索失败: ' + e.message, 500);
  }
}

async function handlePlaylist(data, cookieStr) {
  const pid = data.id;
  if (!pid) return err("必须提供 'id'");
  try {
    const r = await getPlaylistDetail(pid, cookieStr);
    const pl = r?.playlist || {};
    const trackIds = (pl.trackIds || []).map((t) => t.id);
    const allTracks = [];
    for (let i = 0; i < trackIds.length; i += 100) {
      const batch = trackIds.slice(i, i + 100);
      const form = { c: pyJson(batch.map((id) => ({ id: Number(id), v: 0 }))) };
      const sd = await apiRequest(API.SONG_DETAIL_V3, form, cookieStr);
      for (const s of sd?.songs || []) {
        allTracks.push({
          id: s.id, name: s.name,
          artists: (s.ar || []).map((a) => a.name).join('/'),
          album: s.al?.name || '', picUrl: s.al?.picUrl || '',
        });
      }
    }
    return ok({
      status: 'success',
      playlist: {
        id: pl.id, name: pl.name, coverImgUrl: pl.coverImgUrl,
        creator: pl.creator?.nickname || '', trackCount: pl.trackCount,
        description: pl.description || '', tracks: allTracks,
      },
    }, '获取歌单详情成功');
  } catch (e) {
    return err('获取歌单失败: ' + e.message, 500);
  }
}

async function handleAlbum(data, cookieStr) {
  const aid = data.id;
  if (!aid) return err("必须提供 'id'");
  try {
    const r = await getAlbumDetail(aid, cookieStr);
    const al = r?.album || {};
    const songs = (r?.songs || []).map((s) => ({
      id: s.id, name: s.name,
      artists: (s.ar || []).map((a) => a.name).join('/'),
      album: s.al?.name || '', picUrl: getPicUrl(s.al?.pic),
    }));
    return ok({
      status: 200,
      album: {
        id: al.id, name: al.name, coverImgUrl: getPicUrl(al.pic),
        artist: al.artist?.name || '', publishTime: al.publishTime,
        description: al.description || '', songs,
      },
    }, '获取专辑详情成功');
  } catch (e) {
    return err('获取专辑失败: ' + e.message, 500);
  }
}

async function handleDownload(data, cookieStr, request, kv) {
  const musicId = data.id || data.url;
  const quality = data.quality || 'lossless';
  const format = data.format || 'file';
  if (!musicId) return err("必须提供 'id'");
  if (!VALID_LEVELS.includes(quality)) return err(`无效的音质参数: ${quality}`);
  const id = await extractMusicId(String(musicId));
  try {
    const songInfo = await getSongDetail(id, cookieStr);
    const sd = songInfo?.songs?.[0];
    if (!sd) return err('未找到音乐信息', 404);
    const urlInfo = await getSongUrl(id, quality, cookieStr, kv);
    const ud = urlInfo?.data?.[0];
    if (!ud || !ud.url) return err('无法获取下载链接，可能是版权限制或音质不支持', 404);

    if (format === 'json') {
      return ok({
        music_id: id, name: sd.name,
        artist: (sd.ar || []).map((a) => a.name).join(', '),
        album: sd.al?.name || '', quality,
        quality_name: QUALITY_NAMES[quality] || quality,
        file_type: ud.type, file_size: ud.size,
        file_size_formatted: formatSize(ud.size),
        duration: sd.dt || 0, download_url: ud.url,
      }, '解析完成');
    }

    const safe = `${sd.name} [${quality}]`.replace(/[<>:"/\\|?*]/g, '');
    const filename = `${safe}.${ud.type}`;
    const upstream = await fetch(ud.url, { headers: { 'User-Agent': UA, 'Referer': REFERER } });
    if (!upstream.ok) return err('上游下载失败: ' + upstream.status, 502);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || `audio/${ud.type}`,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return err('下载异常: ' + e.message, 500);
  }
}

/* ============================ 入口 ============================ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
      });
    }

    const kv = env.NETEASE_KV;
    const override = url.searchParams.get('cookie') || request.headers.get('x-ner-cookie');
    const cookie = override || (await getCookieFromPool(kv, env));
    const cookieStr = buildCookie(cookie);
    let data;
    if (request.method === 'GET') {
      data = Object.fromEntries(url.searchParams);
    } else {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await request.json().catch(() => ({}));
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        data = Object.fromEntries(await request.formData());
      } else {
        data = await request.json().catch(() => ({}));
      }
    }

    if (path === '/health') {
      return ok({
        service: 'running', cookie_status: cookie ? 'valid' : 'invalid',
        cookie_count: Object.keys(buildCookie(cookie)).length, version: '1.0.0-cf',
      });
    }
    if (path === '/api/info') {
      return ok({
        name: '网易云音乐解析 API (Cloudflare Worker)', version: '1.0.0-cf',
        endpoints: { '/health': '健康检查', '/song': '单曲解析', '/search': '搜索', '/playlist': '歌单', '/album': '专辑', '/download': '下载/解析' },
        supported_qualities: VALID_LEVELS,
      });
    }

    // API 鉴权（API_TOKEN 留空或 KV 无 api_token 则关闭）
    const apiToken = await resolveApiToken(kv, env);
    const authErr = checkAuth(request, url, apiToken);
    if (authErr) return authErr;

    const p = path.toLowerCase();
    if (p === '/song' || p === '/song_v1') return handleSong(data, cookieStr, kv);
    if (p === '/search' || p === '/search') return handleSearch(data, cookieStr);
    if (p === '/playlist' || p === '/playlist') return handlePlaylist(data, cookieStr);
    if (p === '/album' || p === '/album') return handleAlbum(data, cookieStr);
    if (p === '/download' || p === '/download') return handleDownload(data, cookieStr, request, kv);
    if (p === '/login/qr/generate') return handleQrGenerate();
    if (p === '/login/qr/check') return handleQrCheck(url.searchParams.get('key') || (data && data.key));

    return new Response('Netease Worker. Try /api/info', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};

export { md5hex, md5Raw, keyExpansion, aesEncryptBlock, encryptParams, pyJson, buildCookie, getCookieFromPool };
