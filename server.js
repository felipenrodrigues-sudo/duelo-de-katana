// Katana Duel - servidor online (relay de salas por WebSocket) + servidor estatico do jogo.
// Uso:  npm install ws   &&   node server.js   (porta 8080, ou PORT=3000 node server.js)
// Depois abra http://SEU-IP:8080 em dois computadores: o jogo ja conecta sozinho a este servidor.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;
const GAME = process.env.GAME || require('fs').existsSync(path.join(__dirname,'katana-duel.html'))?path.join(__dirname,'katana-duel.html'):path.join(__dirname,'..','katana-duel.html');
// ---- contas (usuario + senha) + salvamento ----
// Tudo fica em saves.json (ou SAVES=/caminho/saves.json): { users:{nome:{name,salt,hash,data,ts}}, sessions:{token:nome} }
// Senhas com scrypt + salt. No Render gratis o disco e temporario: use um Disk e SAVES=/data/saves.json para nao perder contas.
const crypto = require('crypto');
const SAVES = process.env.SAVES || path.join(__dirname, 'saves.json');
let db = { users: {}, sessions: {} };
try { const j = JSON.parse(fs.readFileSync(SAVES, 'utf8')); if (j && j.users) db = j; } catch (e) {}
let saveTimer = null;
const flushSaves = () => { saveTimer = null; const tmp = SAVES + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, SAVES); } catch (e) { console.error('erro ao gravar', e.message); } };
const dirty = () => { if (!saveTimer) saveTimer = setTimeout(flushSaves, 500); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const userOf = (req) => { const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const k = t && db.sessions[t]; return k && db.users[k] ? { key: k, u: db.users[k] } : null; };
const hits = new Map(); // limite simples por IP
const limited = (req, max) => { const ip = req.socket.remoteAddress || '?', now = Date.now(), h = (hits.get(ip) || []).filter((t) => now - t < 60000); h.push(now); hits.set(ip, h); if (hits.size > 5000) hits.clear(); return h.length > max; };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
const readBody = (req, cb) => { let body = ''; req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); }); req.on('end', () => { let j = null; try { j = JSON.parse(body); } catch (e) {} cb(j); }); };
const clean = (d) => {
  if (!d || typeof d !== 'object') return null;
  const prime = Array.isArray(d.prime) ? d.prime.slice(0, 4).map((v) => (v ? 1 : 0)) : [0, 0, 0, 0];
  while (prime.length < 4) prime.push(0);
  const ch = Array.isArray(d.ch) ? d.ch.slice(0, 5).map((v) => (v ? 1 : 0)) : [1, d.oni ? 1 : 0, 0, 0, 0];
  while (ch.length < 5) ch.push(0); ch[0] = 1;
  let bt = parseInt(d.bt) || 0; if (bt < 3600 || bt > 6e6) bt = 0; // menos de 1 min e impossivel
  return { ch, prime, rank: Math.max(0, Math.min(1e6, parseInt(d.rank) || 0)), bt };
};
const newSession = (key) => { const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = key; const ks = Object.keys(db.sessions); if (ks.length > 20000) for (const k of ks.slice(0, 5000)) delete db.sessions[k]; return t; };
const NAMEOK = /^[A-Za-z0-9_.-]{3,16}$/;
const srv = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (url === '/health') { res.end('ok'); return; }
  if (url === '/api/register' && req.method === 'POST') {
    if (limited(req, 10)) { json(res, 429, { error: 'muitas tentativas, aguarde' }); return; }
    readBody(req, (j) => {
      const name = j && typeof j.user === 'string' ? j.user.trim() : '', pw = j && typeof j.pass === 'string' ? j.pass : '';
      if (!NAMEOK.test(name)) { json(res, 400, { error: 'usuario invalido (3-16: letras, numeros, _ . -)' }); return; }
      if (pw.length < 4 || pw.length > 32) { json(res, 400, { error: 'senha: 4 a 32 caracteres' }); return; }
      const key = name.toLowerCase();
      if (db.users[key]) { json(res, 409, { error: 'usuario ja existe' }); return; }
      const salt = crypto.randomBytes(16).toString('hex');
      db.users[key] = { name, salt, hash: hashPw(pw, salt), data: clean({}), ts: 0 };
      dirty(); json(res, 200, { token: newSession(key), name, data: db.users[key].data });
    });
    return;
  }
  if (url === '/api/login' && req.method === 'POST') {
    if (limited(req, 15)) { json(res, 429, { error: 'muitas tentativas, aguarde' }); return; }
    readBody(req, (j) => {
      const name = j && typeof j.user === 'string' ? j.user.trim() : '', pw = j && typeof j.pass === 'string' ? j.pass : '';
      const u = db.users[name.toLowerCase()];
      if (!u || pw.length > 32 || !crypto.timingSafeEqual(Buffer.from(hashPw(pw, u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) { json(res, 401, { error: 'usuario ou senha incorretos' }); return; }
      dirty(); json(res, 200, { token: newSession(name.toLowerCase()), name: u.name, data: u.data });
    });
    return;
  }
  if (url === '/api/leaderboard') {
    const me = userOf(req);
    const list = Object.entries(db.users).filter(([, v]) => v.data && v.data.rank > 0)
      .map(([k, v]) => ({ n: v.name, r: v.data.rank | 0, me: !!(me && me.key === k) }))
      .sort((a, b) => b.r - a.r).slice(0, 100);
    json(res, 200, { list }); return;
  }
  if (url === '/api/bossboard') {
    const me = userOf(req);
    const list = Object.entries(db.users).filter(([, v]) => v.data && v.data.bt > 0)
      .map(([k, v]) => ({ n: v.name, t: v.data.bt | 0, me: !!(me && me.key === k) }))
      .sort((a, b) => a.t - b.t).slice(0, 100);
    json(res, 200, { list }); return;
  }
  if (url === '/api/save') {
    const me = userOf(req);
    if (!me) { json(res, 401, { error: 'sessao invalida' }); return; }
    if (req.method === 'GET') { json(res, 200, { data: me.u.data || null }); return; }
    if (req.method === 'PUT') {
      readBody(req, (j) => {
        const d = clean(j);
        if (!d) { json(res, 400, { error: 'dados invalidos' }); return; }
        // anti-trapaca basico: o rank so sobe ate +25 por salvamento e no maximo 1 vez a cada 45 s
        const old = me.u.data, now = Date.now();
        if (old) {
          if (d.rank > old.rank && (d.rank - old.rank > 25 || now - (me.u.ts || 0) < 45000)) d.rank = old.rank;
          d.ch = d.ch.map((v, i) => (v || (old.ch && old.ch[i]) ? 1 : 0));
          d.prime = d.prime.map((v, i) => (v || (old.prime && old.prime[i]) ? 1 : 0));
          if (old.bt && (!d.bt || old.bt < d.bt)) d.bt = old.bt; // mantem o melhor tempo
        }
        if (d.rank !== (old && old.rank)) me.u.ts = now;
        me.u.data = d; dirty();
        json(res, 200, { ok: 1, data: d });
      });
      return;
    }
  }
  fs.readFile(GAME, (e, d) => {
    if (e) { res.writeHead(404); res.end('katana-duel.html nao encontrado (defina GAME=caminho)'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
  });
});
const wss = new WebSocketServer({ server: srv, maxPayload: 64 * 1024 });
const rooms = new Map(); // nome -> Set<ws>
const bcastCount = (name) => {
  const set = rooms.get(name); if (!set) return;
  const m = JSON.stringify({ t: 'p', n: set.size });
  for (const c of set) if (c.readyState === 1) c.send(m);
};
const leave = (ws) => {
  if (!ws.room) return;
  const set = rooms.get(ws.room);
  if (set) { set.delete(ws); if (!set.size) rooms.delete(ws.room); else bcastCount(ws.room); }
  ws.room = null;
};
wss.on('connection', (ws) => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'j' && typeof m.r === 'string' && /^[a-z0-9_.-]{1,60}$/.test(m.r)) {
      leave(ws); ws.room = m.r;
      if (!rooms.has(m.r)) rooms.set(m.r, new Set());
      const set = rooms.get(m.r);
      if (set.size >= ((m.r === 'kdq' || m.r === 'kdr') ? 200 : 8)) { ws.close(); return; }
      set.add(ws); bcastCount(m.r);
    } else if (m.t === 'm' && ws.room) {
      const out = JSON.stringify({ t: 'm', k: m.k, d: m.d });
      for (const c of rooms.get(ws.room) || []) if (c !== ws && c.readyState === 1) c.send(out);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);
srv.listen(PORT, () => console.log('Katana Duel server em http://localhost:' + PORT));
