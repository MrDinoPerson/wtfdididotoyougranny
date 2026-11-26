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

// ---------- MAP: 3 floors (0 = basement, 1 = ground, 2 = upstairs) ----------
const W = 1600, H = 1200, T = 20, CS = 40, CW = W / CS, CH = H / CS;
const mk = fn => {
  const w = []; const box = (x, y, ww, h) => w.push({ x, y, w: ww, h });
  const vwall = (x, y1, y2, gaps) => { let c = y1; for (const [a, b] of [...gaps, [y2, y2]]) { if (a > c) box(x - T / 2, c, T, a - c); c = b; } };
  const hwall = (y, x1, x2, gaps) => { let c = x1; for (const [a, b] of [...gaps, [x2, x2]]) { if (a > c) box(c, y - T / 2, a - c, T); c = b; } };
  box(0, 0, W, T); box(0, H - T, W, T); box(0, 0, T, H); box(W - T, 0, T, H);
  fn(vwall, hwall); return w;
};
const L = a => a.map(([x, y], id) => ({ id, x, y }));
const floors = [
  { // BASEMENT: a maze of narrow cellar rooms
    walls: mk((v, h) => {
      v(400, 0, H, [[300, 400], [900, 1000]]); v(800, 0, H, [[150, 250], [600, 700], [1000, 1100]]); v(1200, 0, H, [[400, 500], [800, 900]]);
      h(400, 0, 400, [[150, 250]]); h(900, 0, 400, [[250, 350]]); h(800, 400, 800, [[500, 600]]);
      h(300, 800, 1200, [[900, 1000]]); h(1000, 800, 1200, [[950, 1050]]); h(700, 1200, W, [[1350, 1450]]);
    }),
    lockers: L([[60,60],[350,350],[60,1140],[740,60],[500,500],[740,1140],[900,100],[1150,500],[1000,1150],[1540,60],[1540,1140],[1300,600]]),
    keySpots: [[150,200],[300,600],[150,1050],[650,300],[600,950],[1000,500],[1000,1150],[1450,300],[1400,1000]],
    patrol: [[200,200],[200,650],[200,1050],[600,300],[600,1000],[1000,150],[1000,600],[1000,1100],[1400,300],[1400,950]]
  },
  { // GROUND FLOOR
    walls: mk((v, h) => {
      v(520, 0, H, [[200, 300], [800, 900]]); v(1060, 0, H, [[450, 550], [900, 1000]]);
      h(600, 0, 520, [[250, 350]]); h(420, 520, 1060, [[700, 800]]); h(800, 520, 1060, [[560, 660]]); h(600, 1060, W, [[1250, 1350]]);
    }),
    lockers: L([[60,60],[470,540],[60,1140],[580,60],[1000,380],[580,760],[1000,1150],[1100,60],[1540,560],[1540,1140],[1100,660],[200,660],[780,500]]),
    keySpots: [[150,300],[400,150],[250,900],[450,1100],[700,250],[900,600],[900,1050],[1300,200],[1400,450],[1250,900],[1500,1000]],
    patrol: [[260,300],[260,900],[790,210],[790,610],[790,1000],[1330,300],[1330,900]]
  },
  { // UPSTAIRS: bedrooms off a long hallway
    walls: mk((v, h) => {
      v(400, 0, 500, []); v(800, 0, 500, []); v(1200, 0, 500, []); v(500, 700, H, []); v(1100, 700, H, []);
      h(500, 0, W, [[150, 260], [520, 640], [920, 1040], [1320, 1440]]); h(700, 0, W, [[200, 310], [780, 890], [1300, 1410]]);
    }),
    lockers: L([[60,60],[740,440],[850,60],[1540,60],[1100,440],[60,1140],[450,1140],[1060,1140],[1540,1140],[700,900]]),
    keySpots: [[200,250],[600,250],[1400,300],[250,1000],[800,950],[1400,950]],
    patrol: [[200,250],[600,250],[1000,300],[1400,250],[800,600],[250,950],[800,950],[1350,950]]
  }
];
const stairs = [
  { a: { f: 1, x: 960, y: 70, ax: 960, ay: 140 }, b: { f: 2, x: 960, y: 70, ax: 960, ay: 140 } },
  { a: { f: 1, x: 700, y: 1100, ax: 700, ay: 1030 }, b: { f: 0, x: 700, y: 1100, ax: 700, ay: 1030 } }
];
const EXIT = { x: 1550, y: 1000, r: 55 };
// Locked gates sit in doorways (candidates per floor), breakers power the exit on harder modes.
const DOORC = [
  [[390,300,20,100],[390,900,20,100],[790,150,20,100],[790,600,20,100],[790,1000,20,100],[1190,400,20,100],[1190,800,20,100],[150,390,100,20],[250,890,100,20],[500,790,100,20],[900,290,100,20],[950,990,100,20],[1350,690,100,20]],
  [[510,200,20,100],[510,800,20,100],[1050,450,20,100],[1050,900,20,100],[250,590,100,20],[700,410,100,20],[560,790,100,20],[1250,590,100,20]],
  [[150,490,110,20],[520,490,120,20],[920,490,120,20],[1320,490,120,20],[200,690,110,20],[780,690,110,20],[1300,690,110,20]]
];
const BRK = [{ f: 0, x: 1500, y: 1100 }, { f: 2, x: 1500, y: 600 }];
const DIFFS = [
  { name: 'Easy',      need: 3, speed: 130, sight: 320, hear: .7,  evMin: 30, evMax: 60, grace: 25, stam: 5,   doors: 0, doorT: 2,   breakers: 0, breakerT: 4, bd: 0,   batCount: 0, rev: 2, bleed: 0,   findT: 2,  lostT: 1.5, searchT: 5 },
  { name: 'Normal',    need: 3, speed: 150, sight: 420, hear: 1,   evMin: 18, evMax: 43, grace: 12, stam: 3.5, doors: 2, doorT: 2,   breakers: 0, breakerT: 4, bd: 0,   batCount: 0, rev: 3, bleed: 0,   findT: 1.3, lostT: 2.5, searchT: 7 },
  { name: 'Hard',      need: 4, speed: 160, sight: 460, hear: 1.15,evMin: 12, evMax: 30, grace: 5,  stam: 3,   doors: 3, doorT: 2.5, breakers: 1, breakerT: 4, bd: 150, batCount: 6, rev: 4, bleed: 100, findT: .9, lostT: 3.5, searchT: 9 },
  { name: 'Nightmare', need: 5, speed: 175, sight: 520, hear: 1.3, evMin: 8,  evMax: 20, grace: 0,  stam: 2.5, doors: 6, doorT: 3.5, breakers: 2, breakerT: 5, bd: 90,  batCount: 4, rev: 5, bleed: 50,  findT: .5, lostT: 5,   searchT: 12 }
];

// ---------- helpers ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const inWall = (f, x, y, r = 0) => floors[f].walls.some(w => x > w.x - r && x < w.x + w.w + r && y > w.y - r && y < w.y + w.h + r);
const los = (f, ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 10); for (let i = 1; i < n; i++) { const t = i / n; if (inWall(f, ax + (bx - ax) * t, ay + (by - ay) * t)) return false; } return true; };

// ---------- pathfinding (A* on a grid, one per floor) ----------
floors.forEach((fl, f) => { fl.blocked = new Uint8Array(CW * CH); for (let i = 0; i < fl.blocked.length; i++) fl.blocked[i] = inWall(f, (i % CW) * CS + CS / 2, ((i / CW) | 0) * CS + CS / 2, 20) ? 1 : 0; });
function nf(bl, cx, cy) {
  cx = Math.max(0, Math.min(CW - 1, cx)); cy = Math.max(0, Math.min(CH - 1, cy));
  if (!bl[cy * CW + cx]) return cy * CW + cx;
  for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < CW && y < CH && !bl[y * CW + x]) return y * CW + x;
  }
  return -1;
}
function astar(f, sx, sy, ex, ey) {
  const blocked = floors[f].blocked;
  const s = nf(blocked, (sx / CS) | 0, (sy / CS) | 0), e = nf(blocked, (ex / CS) | 0, (ey / CS) | 0);
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
let difIdx = 1, D = DIFFS[1], doors = [], breakers = [], bats = [], exitOn = false, squeaks = [];
const noiseOf = p => Math.max(p.noise || 0, p.loudT > 0 ? p.loudN : 0) * D.hear;
function checkExit() { if (!exitOn && got >= D.need && breakers.every(b => b.on)) { exitOn = true; ev({ k: 'exit' }); if (g.mode !== 'chase') { g.mode = 'investigate'; g.timer = 6; aim(1, EXIT.x, EXIT.y); } } }
const g = { x: 1300, y: 1000, f: 1, a: 0, mode: 'patrol', path: [], pi: 0, timer: 0, stun: 0, lost: 0, lf: 1, lx: 0, ly: 0, repath: 0, evT: 20, findT: 0, dest: null, stairE: null, stairO: null, grace: 0 };

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = o => { const s = JSON.stringify(o); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const ev = o => broadcast({ t: 'ev', ...o });
const goTo = (x, y) => { g.path = astar(g.f, g.x, g.y, x, y); g.pi = 0; };
function goDest() {
  const d = g.dest; if (!d) return; g.stairE = null;
  if (d.f === g.f) { goTo(d.x, d.y); return; }
  const next = g.f + Math.sign(d.f - g.f);
  for (const s of stairs) for (const [e, o] of [[s.a, s.b], [s.b, s.a]]) if (e.f === g.f && o.f === next) { g.stairE = e; g.stairO = o; goTo(e.x, e.y); return; }
}
const aim = (f, x, y) => { g.dest = { f, x, y }; goDest(); };

function startGame() {
  D = DIFFS[difIdx]; phase = 'play'; res = ''; got = 0; exitOn = false;
  const pool = []; floors.forEach((fl, f) => fl.keySpots.forEach(sp => pool.push({ f, x: sp[0], y: sp[1] })));
  const take = f => { const c = pool.filter(q => q.f === f); const q = c[(Math.random() * c.length) | 0]; pool.splice(pool.indexOf(q), 1); return q; };
  const spots = [take(0), take(1), take(2)];
  while (spots.length < D.need) spots.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  keys = spots.map((q, id) => ({ id, ...q }));
  bats = []; for (let i = 0; i < D.batCount && pool.length; i++) bats.push({ id: i, ...pool.splice((Math.random() * pool.length) | 0, 1)[0] });
  const dc = []; DOORC.forEach((arr, f) => arr.forEach(q => dc.push({ f, x: q[0], y: q[1], w: q[2], h: q[3] })));
  dc.sort(() => Math.random() - .5);
  doors = dc.slice(0, D.doors).map((d, i) => ({ id: i, ...d, open: false, p: 0 }));
  // squeaky doors: other doorways (never a locked gate) that squeal when anyone, Granny included, walks through
  squeaks = dc.slice(D.doors, D.doors + 8).map((d, i) => ({ id: i, ...d, cd: 0 }));
  breakers = BRK.slice(0, D.breakers).map((q, i) => ({ id: i, ...q, on: false, p: 0 }));
  let i = 0;
  for (const p of players.values()) Object.assign(p, { f: 1, x: 90 + (i % 4) * 45, y: 90 + ((i / 4) | 0) * 45, down: false, dead: false, dt: 0, hid: false, esc: false, rev: 0, hold: false, noise: 0, loudT: 0, loudN: 0, cd: 0 }), i++;
  Object.assign(g, { x: 1300, y: 1000, f: 1, mode: 'patrol', path: [], pi: 0, timer: 0, stun: 0, lost: 0, evT: D.evMin, findT: 0, dest: null, stairE: null, grace: D.grace });
  pickPatrol();
}
function pickPatrol() {
  const f = Math.random() < .65 ? g.f : (Math.random() * 3) | 0, pl = floors[f].patrol, q = pl[(Math.random() * pl.length) | 0];
  g.mode = 'patrol'; aim(f, q[0], q[1]);
}

function caught(p) {
  p.down = true; p.hid = false; p.rev = 0; p.dt = 0; ev({ k: 'caught', id: p.id });
  g.stun = 2.5; g.mode = 'search'; g.timer = 6; g.lf = g.f; g.lx = p.x; g.ly = p.y; g.dest = null; g.path = []; g.stairE = null;
}

function step(tx, ty, sp, dt) {
  const d = Math.hypot(tx - g.x, ty - g.y); if (d < 1) return;
  const nx = g.x + (tx - g.x) / d * sp * dt, ny = g.y + (ty - g.y) / d * sp * dt;
  if (!inWall(g.f, nx, g.y, 12)) g.x = nx; if (!inWall(g.f, g.x, ny, 12)) g.y = ny;
  g.a = Math.atan2(ty - g.y, tx - g.x);
}

function updateGranny(dt) {
  g.timer -= dt; g.repath -= dt;
  if (g.grace > 0) { g.grace -= dt; return; }
  if (g.stun > 0) { g.stun -= dt; return; }
  const alive = [...players.values()].filter(p => !p.down && !p.esc);
  let seen = null, sd = 1e9;
  for (const p of alive) {
    if (p.hid || p.f !== g.f) continue; const d = dist(g, p); if (d > D.sight) continue;
    const diff = Math.abs(angDiff(Math.atan2(p.y - g.y, p.x - g.x), g.a));
    if ((diff < 1.1 || d < 110) && los(g.f, g.x, g.y, p.x, p.y) && d < sd) { seen = p; sd = d; }
  }
  if (seen) {
    if (g.mode !== 'chase') ev({ k: 'chase' });
    g.mode = 'chase'; g.lost = 0; g.lf = g.f; g.lx = seen.x; g.ly = seen.y;
  } else if (g.mode === 'chase') {
    g.lost += dt; if (g.lost > D.lostT) { g.mode = 'search'; g.timer = D.searchT; aim(g.lf, g.lx, g.ly); }
  }
  if (g.mode !== 'chase' && g.repath <= 0) {
    for (const p of alive) if (!p.hid && p.f === g.f && noiseOf(p) > 0 && dist(g, p) < noiseOf(p)) { g.mode = 'investigate'; g.timer = 4; aim(g.f, p.x, p.y); g.repath = .6; break; }
  }
  if (g.mode === 'search') {
    const h = alive.find(p => p.hid && p.f === g.f && dist(g, p) < 75);
    if (h) { g.findT += dt; if (g.findT > D.findT) { h.hid = false; g.findT = 0; g.mode = 'chase'; g.lost = 0; g.lf = g.f; g.lx = h.x; g.ly = h.y; ev({ k: 'chase' }); } } else g.findT = 0;
  }
  if (g.mode === 'chase' && g.repath <= 0) { aim(g.lf, g.lx, g.ly); g.repath = .4; }
  const sp = g.mode === 'chase' ? D.speed + got * 8 : (g.mode === 'patrol' ? D.speed * .53 : D.speed * .7);
  if (g.pi < g.path.length) {
    const w = g.path[g.pi]; if (dist(g, w) < 8) g.pi++; else step(w.x, w.y, sp, dt);
  } else if (g.stairE && g.dest && g.dest.f !== g.f) {
    if (dist(g, g.stairE) < 90) { const o = g.stairO; g.f = o.f; g.x = o.ax; g.y = o.ay; g.stairE = null; goDest(); }
    else goTo(g.stairE.x, g.stairE.y);
  } else if (g.mode === 'chase') { if (seen && sd < 90) step(seen.x, seen.y, sp, dt); }
  else if (g.timer <= 0) pickPatrol(); else g.a += dt * 1.5;
  for (const p of alive) if (!p.hid && p.f === g.f && dist(g, p) < 30) { caught(p); break; }
}

function useStairs(p) {
  if (p.cd > 0) return;
  for (const s of stairs) for (const [e, o] of [[s.a, s.b], [s.b, s.a]]) {
    if (e.f === p.f && Math.hypot(e.x - p.x, e.y - p.y) < 36) {
      const old = p.f; p.f = o.f; p.x = o.ax; p.y = o.ay; p.cd = 1.2; p.noise = 0;
      send(p.ws, { t: 'floor', f: p.f, x: p.x, y: p.y });
      if ((g.mode === 'chase' || g.mode === 'search') && g.f === old && Math.hypot(g.x - e.x, g.y - e.y) < 600) {
        g.mode = 'chase'; g.lost = 0; g.lf = p.f; g.lx = o.ax; g.ly = o.ay; aim(p.f, o.ax, o.ay);
      }
      return;
    }
  }
}

function tick() {
  const dt = .05;
  if (phase === 'play') {
    updateGranny(dt);
    const list = [...players.values()];
    for (const q of squeaks) {
      if (q.cd > 0) { q.cd -= dt; continue; }
      const inside = o => o.f === q.f && o.x > q.x - 14 && o.x < q.x + q.w + 14 && o.y > q.y - 14 && o.y < q.y + q.h + 14;
      const who = list.find(p => !p.down && !p.hid && !p.esc && inside(p)), gran = inside(g);
      if (!who && !gran) continue;
      q.cd = 6; const mx = q.x + q.w / 2, my = q.y + q.h / 2;
      ev({ k: 'squeak', id: q.id, f: q.f, x: mx, y: my });
      if (who && g.mode !== 'chase' && g.f === q.f && Math.hypot(g.x - mx, g.y - my) < 900 * D.hear) { g.mode = 'investigate'; g.timer = 4; aim(q.f, mx, my); }
    }
    for (const p of list) if (p.cd > 0) p.cd -= dt;
    for (const p of list) if (p.loudT > 0) p.loudT -= dt;
    for (const d of list) if (d.down && !d.dead) {
      if (D.bleed) { d.dt += dt; if (d.dt >= D.bleed) { d.dead = true; d.rev = 0; ev({ k: 'dead', id: d.id }); continue; } }
      const helpers = list.filter(h => !h.down && !h.hid && !h.esc && h.hold && h.f === d.f && dist(h, d) < 60);
      d.rev = helpers.length ? d.rev + dt / D.rev : Math.max(0, d.rev - dt);
      if (d.rev >= 1) { d.down = false; d.rev = 0; ev({ k: 'revive', id: d.id }); }
    }
    const able = list.filter(p => !p.down && !p.hid && !p.esc && p.hold);
    for (const d of doors) if (!d.open) {
      const near = able.filter(p => p.f === d.f && Math.hypot(p.x - (d.x + d.w / 2), p.y - (d.y + d.h / 2)) < 70);
      if (near.length) { d.p += dt / D.doorT; near.forEach(p => { p.loudT = .3; p.loudN = 260; }); } else d.p = Math.max(0, d.p - dt * .5);
      if (d.p >= 1) { d.open = true; ev({ k: 'door', f: d.f, x: d.x, y: d.y }); }
    }
    for (const b of breakers) if (!b.on) {
      const near = able.filter(p => p.f === b.f && dist(p, b) < 60);
      if (near.length) { b.p += dt / D.breakerT; near.forEach(p => { p.loudT = .3; p.loudN = 320; }); } else b.p = Math.max(0, b.p - dt * .5);
      if (b.p >= 1) { b.on = true; ev({ k: 'breaker', f: b.f, x: b.x, y: b.y, left: breakers.filter(q => !q.on).length }); if (g.mode !== 'chase') { g.mode = 'investigate'; g.timer = 6; aim(b.f, b.x, b.y); } checkExit(); }
    }
    if (exitOn) for (const p of list) if (p.f === 1 && !p.down && !p.hid && !p.esc && dist(p, EXIT) < EXIT.r) { p.esc = true; ev({ k: 'escape', id: p.id }); }
    g.evT -= dt;
    if (g.evT <= 0) {
      g.evT = D.evMin + Math.random() * (D.evMax - D.evMin); const r = Math.random();
      if (r < .3) ev({ k: 'whisper' });
      else if (r < .6) {
        const f = (Math.random() * 3) | 0, pl = floors[f].patrol, q = pl[(Math.random() * pl.length) | 0];
        ev({ k: 'bang', f, x: q[0], y: q[1] });
        if (g.mode === 'patrol') { g.mode = 'investigate'; g.timer = 4; aim(f, q[0], q[1]); }
      } else if (r < .85) ev({ k: 'lights' }); else ev({ k: 'creak' });
    }
    if (list.length && list.every(p => p.esc || p.down)) {
      const n = list.filter(p => p.esc).length;
      res = n === 0 ? 'Granny got you all. Nobody escaped...' : n === list.length ? 'EVERYONE ESCAPED!' : `${n} of ${list.length} escaped. The others never left.`;
      phase = 'end'; endT = 8;
    }
  } else if (phase === 'end') { endT -= dt; if (endT <= 0) phase = 'lobby'; }
  broadcast({
    t: 's', ph: phase, res, got, need: D.need, k: keys, dif: difIdx, bd: D.bd, stam: D.stam, ex: exitOn, bt: bats,
    dr: doors.filter(d => !d.open).map(d => ({ i: d.id, f: d.f, x: d.x, y: d.y, w: d.w, h: d.h, p: +d.p.toFixed(2) })),
    br: breakers.map(b => ({ f: b.f, x: b.x, y: b.y, on: b.on, p: +b.p.toFixed(2) })),
    sq: squeaks.map(q => ({ id: q.id, f: q.f, x: q.x, y: q.y, w: q.w, h: q.h })),
    g: { x: Math.round(g.x), y: Math.round(g.y), f: g.f, a: +g.a.toFixed(2), m: g.mode },
    pl: [...players.values()].map(p => ({ id: p.id, n: p.name, f: p.f, x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2), v: !!p.v, bl: p.down && D.bleed && !p.dead ? Math.ceil(D.bleed - p.dt) : 0, dead: !!p.dead, down: p.down, hid: p.hid, esc: p.esc, rev: +p.rev.toFixed(2) }))
  });
}

// ---------- networking ----------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let p = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !p && players.size < 8) {
      p = { id: nextId++, ws, name: String(m.name || 'Player').slice(0, 14), f: 1, x: 100, y: 100, a: 0, down: phase === 'play', hid: false, esc: false, rev: 0, hold: false, noise: 0, cd: 0, dt: 0, dead: false, loudT: 0, loudN: 0 };
      players.set(p.id, p);
      send(ws, { t: 'hi', id: p.id, map: { W, H, floors: floors.map(f => ({ walls: f.walls, lockers: f.lockers })), exit: EXIT, stairs } });
    }
    if (!p) return;
    if (m.t === 'pos') {
      p.a = +m.a || 0;
      if (phase === 'play' && !p.hid && !p.down && !p.esc && m.f === p.f) {
        p.x = Math.max(0, Math.min(W, +m.x || 0)); p.y = Math.max(0, Math.min(H, +m.y || 0));
        p.noise = m.sp ? 380 : m.mv ? 110 : 0; if (m.tk) p.noise = Math.max(p.noise, 220); useStairs(p);
      } else p.noise = 0;
    }
    else if (m.t === 'dif' && phase !== 'play') { difIdx = Math.max(0, Math.min(3, m.v | 0)); D = DIFFS[difIdx]; }
    else if (m.t === 'vready') p.v = true;
    else if (m.t === 'sig') { const q = players.get(+m.to); if (q && q !== p && JSON.stringify(m.d || '').length < 20000) send(q.ws, { t: 'sig', from: p.id, d: m.d }); }
    else if (m.t === 'start' && phase !== 'play') startGame();
    else if (m.t === 'h') p.hold = !!m.v;
    else if (m.t === 'e' && phase === 'play' && !p.down && !p.esc) {
      if (p.hid) { p.hid = false; p.y += 40; return; }
      const k = keys.find(k => k.f === p.f && dist(k, p) < 55);
      if (k) {
        keys = keys.filter(x => x !== k); got++; ev({ k: 'key', got });
        checkExit();
        return;
      }
      const bt = bats.find(b => b.f === p.f && dist(b, p) < 55);
      if (bt) { bats = bats.filter(x => x !== bt); send(p.ws, { t: 'ev', k: 'battery' }); return; }
      const l = floors[p.f].lockers.find(l => dist(l, p) < 55);
      if (l) { p.hid = true; p.x = l.x; p.y = l.y; p.noise = 0; }
    }
  });
  ws.on('close', () => { if (p) players.delete(p.id); });
});

if (require.main === module) {
  setInterval(tick, 50);
  server.listen(PORT, () => console.log('Granny awaits on port ' + PORT));
} else module.exports = { floors, stairs, astar, EXIT };
