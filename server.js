// Granny's House - authoritative game server (HTTP static + WebSocket)
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  let f = req.url.split('?')[0]; if (f === '/') f = '/index.html';
  const p = path.join(__dirname, 'public', path.normalize(f));
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
});

// ---------- MAP ----------
const W = 1600, H = 1200, T = 20, CS = 40, CW = W / CS, CH = H / CS;
const walls = [];
const box = (x, y, w, h) => walls.push({ x, y, w, h });
box(0, 0, W, T); box(0, H - T, W, T); box(0, 0, T, H); box(W - T, 0, T, H);
function vwall(x, y1, y2, gaps) { let c = y1; for (const [a, b] of [...gaps, [y2, y2]]) { if (a > c) box(x - T / 2, c, T, a - c); c = b; } }
function hwall(y, x1, x2, gaps) { let c = x1; for (const [a, b] of [...gaps, [x2, x2]]) { if (a > c) box(c, y - T / 2, a - c, T); c = b; } }
vwall(520, 0, H, [[200, 300], [800, 900]]);
vwall(1060, 0, H, [[450, 550], [900, 1000]]);
hwall(600, 0, 520, [[250, 350]]);
hwall(420, 520, 1060, [[700, 800]]);
hwall(800, 520, 1060, [[560, 660]]);
hwall(600, 1060, W, [[1250, 1350]]);
const lockers = [[60,60],[470,540],[60,1140],[580,60],[1000,380],[580,760],[1000,1150],[1100,60],[1540,560],[1540,1140],[1100,660],[200,660],[780,500]].map(([x, y], id) => ({ id, x, y }));
const keySpots = [[150,300],[400,150],[250,900],[450,1100],[700,250],[900,600],[750,1000],[1300,200],[1400,450],[1250,900],[1500,1000]];
const patrol = [[260,300],[260,900],[790,210],[790,610],[790,1000],[1330,300],[1330,900]];
const EXIT = { x: 1550, y: 1000, r: 55 }, NEED = 3;

// ---------- helpers ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const inWall = (x, y, r = 0) => walls.some(w => x > w.x - r && x < w.x + w.w + r && y > w.y - r && y < w.y + w.h + r);
const los = (ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 10); for (let i = 1; i < n; i++) { const t = i / n; if (inWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false; } return true; };

// ---------- pathfinding (A* on a grid) ----------
const blocked = new Uint8Array(CW * CH);
for (let i = 0; i < blocked.length; i++) blocked[i] = inWall((i % CW) * CS + CS / 2, ((i / CW) | 0) * CS + CS / 2, 20) ? 1 : 0;
function nf(cx, cy) {
  cx = Math.max(0, Math.min(CW - 1, cx)); cy = Math.max(0, Math.min(CH - 1, cy));
  if (!blocked[cy * CW + cx]) return cy * CW + cx;
  for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < CW && y < CH && !blocked[y * CW + x]) return y * CW + x;
  }
  return -1;
}
function astar(sx, sy, ex, ey) {
  const s = nf((sx / CS) | 0, (sy / CS) | 0), e = nf((ex / CS) | 0, (ey / CS) | 0);
  if (s < 0 || e < 0 || s === e) return [];
  const gs = new Float32Array(CW * CH).fill(1e9), from = new Int16Array(CW * CH).fill(-1), closed = new Uint8Array(CW * CH);
  const open = [s]; gs[s] = 0;
  const h = i => Math.hypot((i % CW) - (e % CW), ((i / CW) | 0) - ((e / CW) | 0));
  while (open.length) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (gs[open[k]] + h(open[k]) < gs[open[bi]] + h(open[bi])) bi = k;
    const c = open.splice(bi, 1)[0]; if (c === e) break; closed[c] = 1;
    const cx = c % CW, cy = (c / CW) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
      const ni = ny * CW + nx; if (blocked[ni] || closed[ni]) continue;
      if (dx && dy && (blocked[cy * CW + nx] || blocked[ny * CW + cx])) continue;
      const ng = gs[c] + Math.hypot(dx, dy);
      if (ng < gs[ni]) { gs[ni] = ng; from[ni] = c; if (!open.includes(ni)) open.push(ni); }
    }
  }
  if (from[e] < 0) return [];
  const p = []; for (let c = e; c !== s; c = from[c]) p.push({ x: (c % CW) * CS + CS / 2, y: ((c / CW) | 0) * CS + CS / 2 });
  return p.reverse();
}

// ---------- game state ----------
const players = new Map(); let nextId = 1;
let phase = 'lobby', res = '', endT = 0, keys = [], got = 0;
const g = { x: 1300, y: 1000, a: 0, mode: 'patrol', path: [], pi: 0, timer: 0, stun: 0, lost: 0, lx: 0, ly: 0, repath: 0, evT: 20, findT: 0, pt: 0 };

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = o => { const s = JSON.stringify(o); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const ev = o => broadcast({ t: 'ev', ...o });
const goTo = (x, y) => { g.path = astar(g.x, g.y, x, y); g.pi = 0; };

function startGame() {
  phase = 'play'; res = ''; got = 0;
  const spots = [...keySpots].sort(() => Math.random() - .5).slice(0, NEED);
  keys = spots.map(([x, y], id) => ({ id, x, y }));
  let i = 0;
  for (const p of players.values()) Object.assign(p, { x: 90 + (i % 4) * 45, y: 90 + ((i / 4) | 0) * 45, down: false, hid: false, esc: false, rev: 0, hold: false, noise: 0 }), i++;
  Object.assign(g, { x: 1300, y: 1000, mode: 'patrol', path: [], pi: 0, timer: 0, stun: 0, lost: 0, evT: 15, findT: 0 });
  pickPatrol();
}
function pickPatrol() { const p = patrol[(Math.random() * patrol.length) | 0]; goTo(p[0], p[1]); g.mode = 'patrol'; }

function caught(p) {
  p.down = true; p.hid = false; p.rev = 0; ev({ k: 'caught', id: p.id });
  g.stun = 2.5; g.mode = 'search'; g.timer = 6; g.lx = p.x; g.ly = p.y;
}

function step(tx, ty, sp, dt) {
  const d = Math.hypot(tx - g.x, ty - g.y); if (d < 1) return;
  const nx = g.x + (tx - g.x) / d * sp * dt, ny = g.y + (ty - g.y) / d * sp * dt;
  if (!inWall(nx, g.y, 12)) g.x = nx; if (!inWall(g.x, ny, 12)) g.y = ny;
  g.a = Math.atan2(ty - g.y, tx - g.x);
}

function updateGranny(dt) {
  g.timer -= dt; g.repath -= dt;
  if (g.stun > 0) { g.stun -= dt; return; }
  const alive = [...players.values()].filter(p => !p.down && !p.esc);
  let seen = null, sd = 1e9;
  for (const p of alive) {
    if (p.hid) continue; const d = dist(g, p); if (d > 420) continue;
    const diff = Math.abs(angDiff(Math.atan2(p.y - g.y, p.x - g.x), g.a));
    if ((diff < 1.1 || d < 110) && los(g.x, g.y, p.x, p.y) && d < sd) { seen = p; sd = d; }
  }
  if (seen) {
    if (g.mode !== 'chase') ev({ k: 'chase' });
    g.mode = 'chase'; g.lost = 0; g.lx = seen.x; g.ly = seen.y;
  } else if (g.mode === 'chase') {
    g.lost += dt; if (g.lost > 2.5) { g.mode = 'search'; g.timer = 7; goTo(g.lx, g.ly); }
  }
  if (g.mode !== 'chase' && g.repath <= 0) {
    for (const p of alive) if (!p.hid && p.noise > 0 && dist(g, p) < p.noise) { g.mode = 'investigate'; g.timer = 4; goTo(p.x, p.y); g.repath = .6; break; }
  }
  if (g.mode === 'search') {
    const h = alive.find(p => p.hid && dist(g, p) < 75);
    if (h) { g.findT += dt; if (g.findT > 1.3) { h.hid = false; g.findT = 0; g.mode = 'chase'; g.lost = 0; g.lx = h.x; g.ly = h.y; ev({ k: 'chase' }); } } else g.findT = 0;
  }
  if (g.mode === 'chase' && g.repath <= 0) { goTo(g.lx, g.ly); g.repath = .4; }
  const sp = g.mode === 'chase' ? 150 + got * 8 : (g.mode === 'patrol' ? 80 : 105);
  if (g.pi < g.path.length) {
    const w = g.path[g.pi]; if (dist(g, w) < 8) g.pi++; else step(w.x, w.y, sp, dt);
  } else if (g.mode === 'chase') { if (seen && sd < 90) step(seen.x, seen.y, sp, dt); }
  else if (g.timer <= 0) pickPatrol(); else g.a += dt * 1.5;
  for (const p of alive) if (!p.hid && dist(g, p) < 30) { caught(p); break; }
}

function tick() {
  const dt = .05;
  if (phase === 'play') {
    updateGranny(dt);
    const list = [...players.values()];
    for (const d of list) if (d.down) {
      const helpers = list.filter(h => !h.down && !h.hid && !h.esc && h.hold && dist(h, d) < 60);
      d.rev = helpers.length ? d.rev + dt / 3 : Math.max(0, d.rev - dt);
      if (d.rev >= 1) { d.down = false; d.rev = 0; ev({ k: 'revive', id: d.id }); }
    }
    if (got >= NEED) for (const p of list) if (!p.down && !p.hid && !p.esc && dist(p, EXIT) < EXIT.r) { p.esc = true; ev({ k: 'escape', id: p.id }); }
    g.evT -= dt;
    if (g.evT <= 0) {
      g.evT = 18 + Math.random() * 25; const r = Math.random();
      if (r < .3) ev({ k: 'whisper' });
      else if (r < .6) { const q = patrol[(Math.random() * patrol.length) | 0]; ev({ k: 'bang', x: q[0], y: q[1] }); if (g.mode === 'patrol') { g.mode = 'investigate'; g.timer = 4; goTo(q[0], q[1]); } }
      else if (r < .85) ev({ k: 'lights' }); else ev({ k: 'creak' });
    }
    if (list.length && list.every(p => p.esc || p.down)) {
      const n = list.filter(p => p.esc).length;
      res = n === 0 ? 'Granny got you all. Nobody escaped...' : n === list.length ? 'EVERYONE ESCAPED!' : `${n} of ${list.length} escaped. The others never left.`;
      phase = 'end'; endT = 8;
    }
  } else if (phase === 'end') { endT -= dt; if (endT <= 0) phase = 'lobby'; }
  broadcast({
    t: 's', ph: phase, res, got, need: NEED, k: keys,
    g: { x: Math.round(g.x), y: Math.round(g.y), a: +g.a.toFixed(2), m: g.mode },
    pl: [...players.values()].map(p => ({ id: p.id, n: p.name, x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2), down: p.down, hid: p.hid, esc: p.esc, rev: +p.rev.toFixed(2) }))
  });
}

// ---------- networking ----------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let p = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !p && players.size < 8) {
      p = { id: nextId++, ws, name: String(m.name || 'Player').slice(0, 14), x: 100, y: 100, a: 0, down: phase === 'play', hid: false, esc: false, rev: 0, hold: false, noise: 0, locker: -1 };
      players.set(p.id, p);
      send(ws, { t: 'hi', id: p.id, map: { W, H, walls, lockers, exit: EXIT } });
    }
    if (!p) return;
    if (m.t === 'pos' && phase === 'play' && !p.hid && !p.down && !p.esc) {
      p.x = Math.max(0, Math.min(W, +m.x || 0)); p.y = Math.max(0, Math.min(H, +m.y || 0)); p.a = +m.a || 0;
      p.noise = m.sp ? 380 : m.mv ? 110 : 0;
    } else if (m.t === 'pos') { p.a = +m.a || 0; p.noise = 0; }
    else if (m.t === 'start' && phase !== 'play') startGame();
    else if (m.t === 'h') p.hold = !!m.v;
    else if (m.t === 'e' && phase === 'play' && !p.down && !p.esc) {
      if (p.hid) { p.hid = false; p.y += 40; return; }
      const k = keys.find(k => dist(k, p) < 55);
      if (k) { keys = keys.filter(x => x !== k); got++; ev({ k: 'key', got }); if (got >= NEED) { ev({ k: 'exit' }); g.mode = 'investigate'; g.timer = 6; goTo(EXIT.x, EXIT.y); } return; }
      const l = lockers.find(l => dist(l, p) < 55);
      if (l) { p.hid = true; p.x = l.x; p.y = l.y; p.noise = 0; }
    }
  });
  ws.on('close', () => { if (p) players.delete(p.id); });
});

setInterval(tick, 50);
server.listen(PORT, () => console.log('Granny awaits on port ' + PORT));
