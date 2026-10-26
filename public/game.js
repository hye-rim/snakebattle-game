'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 스네이크 대결: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_SNAKE), 방·매칭·실제 진행은 server.js
(() => {
const L = LOGIC_SNAKE;
const { COLS, ROWS, DX, DY } = L;
const $ = (id) => document.getElementById(id);
const COLORS = ['#35c25a', '#ff7a3d'];                      // 0 내 뱀 · 1 상대 뱀
const TICK = 140;                                           // 뱀이 한 칸 가는 시간(ms). 서버와 같게
const WIN_ROUNDS = 2;
const T = { over: 900, round: 1800 };                       // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('snakebattleWins')) || 0;
const ONLINE_KEY = 'snakebattleOnline', SESSION_KEY = 'snakebattleSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('snakebattleName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('snakebattleMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  eat: () => tone(660, 0.07, 'triangle', 0.1, 330),
  turn: () => tone(380, 0.03, 'square', 0.03),
  die: () => seq([300, 220, 160], 90, 'sawtooth', 0.06),
  start: () => tone(700, 0.08, 'triangle', 0.07),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('snakebattleMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let sim = null, loop = 0, roundTimer = 0, overTimer = 0;   // 컴퓨터 대전
let me = 0;                         // 내 뱀 번호. 화면에서는 늘 내가 왼쪽 아래에서 위로 가도록 뒤집어 그린다
let view = null;                    // 그릴 모양 { b: [[x,y,x,y..], ..], f: [[x,y]], w, a:[1,1] } (머리가 앞)
let room = null, netDown = false, recorded = '';
let wonRounds = [0, 0], round = 1, roundWinner = -1, banner = '', cpuMatchOver = false;
const online = () => mode === 'online';
// 튜토리얼 중에는 처음 방향을 바꿀 때까지 판이 멈춰 있고, 져도 점수 없이 다시 시작한다 (설명을 읽다가 뱀이 죽지 않게)
const TUT = /[?&]tutorial=1/.test(location.search);
let tutStarted = false;

// ---------- 그리기 ----------
const canvas = $('table'), ctx = canvas.getContext('2d');
let cw = 0, chh = 0, dpr = 1;
function fit() {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
  cw = w; chh = h;
}
const flipped = () => me === 1;
function draw() {
  fit();
  const k = cw / COLS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, chh);
  ctx.save();
  if (flipped()) { ctx.translate(cw, chh); ctx.rotate(Math.PI); }
  ctx.scale(k, k);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { ctx.fillStyle = (x + y) % 2 ? '#e3f4cb' : '#ecf8d9'; ctx.fillRect(x, y, 1, 1); }
  if (view) {
    for (const f of view.f) { // 먹이: 사과
      ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(f[0] + 0.5, f[1] + 0.54, 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e7d32'; ctx.fillRect(f[0] + 0.46, f[1] + 0.1, 0.1, 0.24);
    }
    for (const w of [1 - me, me]) drawSnake(w);
  }
  ctx.restore();
  // 글자는 돌리지 않는다
  if (view && phase === 'play') {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (banner) text(banner, cw / 2, chh / 2, 30 * dpr);
    else if (view.w > 0) text(String(Math.max(1, Math.ceil(view.w * TICK / 1000))), cw / 2, chh / 2, 54 * dpr);
  }
}
function drawSnake(w) {
  const b = view.b[w], alive = view.a[w], col = COLORS[w === me ? 0 : 1];
  const n = b.length / 2;
  for (let i = n - 1; i >= 0; i--) {
    const x = b[i * 2], y = b[i * 2 + 1];
    ctx.fillStyle = alive ? (i === 0 ? shade(col, -20) : col) : '#9aa0a6';
    const pad = i === 0 ? 0.04 : 0.1;
    roundRect(x + pad, y + pad, 1 - pad * 2, 1 - pad * 2, 0.28);
  }
  if (n) { // 눈 (가는 쪽을 본다)
    const hx = b[0], hy = b[1];
    const d = n > 1 ? dirOf(b) : 0;
    const fx = DX[d], fy = DY[d], sx = -fy, sy = fx;
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + 0.5 + fx * 0.14 + sx * 0.2 * s, hy + 0.5 + fy * 0.14 + sy * 0.2 * s, 0.14, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = alive ? '#2b1d52' : '#555';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + 0.5 + fx * 0.2 + sx * 0.2 * s, hy + 0.5 + fy * 0.2 + sy * 0.2 * s, 0.07, 0, Math.PI * 2); ctx.fill(); }
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function text(s, x, y, size) {
  ctx.font = `${size}px Jua, sans-serif`;
  ctx.lineWidth = size * 0.2; ctx.strokeStyle = '#2b1d52'; ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y); ctx.fillStyle = '#ffd23f'; ctx.fillText(s, x, y);
}
// 몸 배열(머리부터)에서 가는 방향 (0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽)
function dirOf(b) {
  const dx = b[0] - b[2], dy = b[1] - b[3];
  return dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3;
}

const nameOf = (side) => {
  if (!online()) return side === me ? '나' : '컴퓨터';
  if (!room) return side === me ? '나' : '상대';
  return side === me ? '나' : ((room.players.find((p) => p.color === side) || {}).name || '상대');
};
function renderBars() {
  const bar = (el, side) => {
    const len = view ? view.b[side].length / 2 : L.START_LEN;
    el.className = 'bar';
    el.innerHTML = `<span class="dot" style="--c:${COLORS[side === me ? 0 : 1]}"></span><span class="nm">${esc(nameOf(side))}</span><span class="ct">길이 ${len}</span><span class="sc">${'★'.repeat(wonRounds[side])}${'☆'.repeat(Math.max(0, WIN_ROUNDS - wonRounds[side]))}</span>`;
  };
  bar($('barOp'), 1 - me); bar($('barMe'), me);
}
function renderHud() {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let t = '스네이크 대결';
  if (phase === 'play') t = online() && netDown ? '연결 다시 붙이는 중…' : `${round}라운드 · ${wonRounds[me]} : ${wonRounds[1 - me]}`;
  $('turn').textContent = t;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }
function paint() { renderBars(); renderHud(); draw(); }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 방향 입력 ----------
// 화면 방향(내 화면 기준) → 판 방향. 내가 1 번 뱀이면 화면을 돌려 그리므로 방향도 반대로
const toWorld = (d) => (flipped() ? (d + 2) % 4 : d);
function steer(screenDir) {
  if (!view || phase !== 'play' || (online() && netDown) || banner) return;
  const d = toWorld(screenDir);
  const b = view.b[me];
  if (b.length < 4 || !view.a[me]) return;
  const cur = pendingDir !== -1 ? pendingDir : dirOf(b);
  if (d === cur || d === (cur + 2) % 4) return;           // 같은 방향이거나 바로 뒤로 돌기
  pendingDir = d; tutStarted = true;
  if (online()) net.send('dir', { d });
  else L.setDir(sim, me, d);
  sfx.turn();
  tutorialSignal('steer');
}
let pendingDir = -1;                                        // 아직 한 칸 가기 전에 눌러 둔 방향 (연달아 눌러도 뒤로 도는 것 막기)
const KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code in KEYS && !overlayOpen()) { e.preventDefault(); steer(KEYS[e.code]); }
});
let sw = null;
canvas.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
canvas.addEventListener('pointermove', (e) => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  sw = { x: e.clientX, y: e.clientY };                      // 한 번 밀고 이어서 또 밀 수 있게 기준을 옮긴다
});
const endSwipe = () => { sw = null; };
canvas.addEventListener('pointerup', endSwipe); canvas.addEventListener('pointercancel', endSwipe);
$('pad').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { b.blur(); steer(Number(b.dataset.d)); } });

// ---------- 컴퓨터 대전 ----------
function sync() {                                           // 컴퓨터 대전의 판 → 그릴 모양
  const pack = (s) => s.body.flatMap((c) => [c.x, c.y]);
  view = { b: sim.snakes.map(pack), f: sim.food.map((c) => [c.x, c.y]), w: sim.wait, a: sim.snakes.map((s) => (s.alive ? 1 : 0)) };
}
function startCpu(level) {
  leaveOnline();
  clearInterval(loop); clearTimeout(roundTimer); clearTimeout(overTimer);
  mode = level; me = 0; phase = 'play'; wonRounds = [0, 0]; round = 1; cpuMatchOver = false; banner = '';
  hideOverlay();
  newCpuRound();
  say('화살표(WASD)·화면 밀기·아래 버튼으로 방향을 바꿔요!\n먹이를 먹고 길어지고, 벽·몸에 부딪히면 져요. 먼저 2판을 이기면 승리!');
  loop = setInterval(cpuTick, TICK);
}
function newCpuRound() {
  sim = L.newGame(); pendingDir = -1; banner = ''; sync(); paint(); sfx.start();
}
function cpuTick() {
  if (phase !== 'play' || !sim || online() || banner || (TUT && !tutStarted)) return;
  if (sim.wait === 0) L.setDir(sim, 1, L.aiPick(sim, 1, mode === 'hard' ? 'hard' : 'easy'));
  L.step(sim);
  pendingDir = -1;
  for (const e of sim.events) {
    if (e.type === 'eat') { sfx.eat(); if (e.who === me) tutorialSignal('eat'); }
    else if (e.type === 'die') sfx.die();
  }
  sim.events.length = 0;
  sync();
  if (sim.winner >= 0) cpuRoundEnd(sim.winner);
  paint();
}
function cpuRoundEnd(w) {
  if (TUT && w !== 0) { banner = '다시 해 봐요!'; roundTimer = setTimeout(newCpuRound, T.round); return; }
  if (w < 2) wonRounds[w]++;
  roundWinner = w;
  banner = w === 2 ? '무승부!' : w === 0 ? '내가 이겼어요!' : '컴퓨터가 이겼어요';
  const done = wonRounds[0] >= WIN_ROUNDS || wonRounds[1] >= WIN_ROUNDS || round >= 5;
  if (done) { cpuMatchOver = true; clearInterval(loop); overTimer = setTimeout(showOver, T.over + T.round / 2); return; }
  roundTimer = setTimeout(() => { round++; newCpuRound(); }, T.round);
}
function showOver() {
  phase = 'over'; banner = '';
  const youWon = wonRounds[0] > wonRounds[1], draw = wonRounds[0] === wonRounds[1];
  if (youWon) { wins++; store.set('snakebattleWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  showOverlay(`
    <h2>${draw ? '무승부! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <div class="big">${wonRounds[0]} : ${wonRounds[1]}</div>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
  paint();
}
function showTitle() {
  leaveOnline();
  clearInterval(loop); clearTimeout(roundTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; me = 0; sim = L.newGame(); sim.wait = 99; wonRounds = [0, 0]; round = 1; banner = ''; sync(); say('');
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>스네이크 대결</h1>
    <p>먹이를 먹고 길어져서 <b>상대를 막아</b> 이겨요!</p>
    <div class="card2" style="font-size:13px">내 뱀(<b>초록</b>)을 화살표·화면 밀기·버튼으로 돌려요<br>벽·내 몸·<b>상대 몸</b>에 머리를 부딪히면 져요<br>머리끼리 부딪히면 비겨요 · <b>3판 2선승</b></div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
  paint();
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; paint();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else if (t !== 'dir') { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function toView(m) {
  const arr = (a) => a.slice();
  return { b: m.b.map(arr), f: m.f.map(arr), w: m.w, a: m.a.slice() };
}
function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 's') { if (phase === 'play') { view = toView(m); pendingDir = -1; roundWinner = m.rw; paint(); } }
  else if (m.t === 'ev') {
    if (phase !== 'play') return;
    if (m.e === 'eat') { sfx.eat(); if (m.who === me) tutorialSignal('eat'); }
    else if (m.e === 'die') sfx.die();
  } else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false;
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  const newRound = newGame || room.round !== r.round || (room.rw >= 0 && r.rw < 0);
  room = r; me = r.you;
  netDown = false;
  saveSession({ code: r.code, token: r.token });
  wonRounds = r.wins.slice(); round = r.round;
  view = toView(r); roundWinner = r.rw; pendingDir = -1;
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); paint(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (r.rw >= 0 && r.state === 'playing') {
    banner = r.rw === 2 ? '무승부!' : r.rw === me ? '내가 이겼어요!' : '상대가 이겼어요';
    setTimeout(() => { banner = ''; if (room && room.rw === r.rw) draw(); }, 1700);
  } else banner = '';
  if (newGame && r.state === 'playing') { sfx.found(); say('화살표(WASD)·화면 밀기·아래 버튼으로 방향을 바꿔요!\n먼저 2판을 이기면 승리!'); }
  else if (newRound && r.state === 'playing' && r.rw < 0) sfx.start();
  if (r.state !== 'over') hideOverlay();
  paint();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) { rec.d = (rec.d || 0) + 1; sfx.found(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over + 900);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const draw = r.winner === 2, won = r.winner === r.you;
  const why = {
    rounds: draw ? '비긴 판이 이어져 승부가 안 났어요' : won ? '먼저 2판을 이겼어요!' : '상대가 먼저 2판을 이겼어요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${why}</p>` : ''}
    <div class="big">${r.wins[r.you]} : ${r.wins[1 - r.you]}</div>
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearInterval(loop); clearTimeout(roundTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; me = 0; sim = L.newGame(); sim.wait = 99; wonRounds = [0, 0]; banner = ''; sync(); say('');
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">3판 2선승 · 시작 위치는 한 판 더마다 바뀌어요</p>`);
  paint();
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('snakebattleName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 경기는 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '스네이크 대결 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
addEventListener('resize', draw);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  sim = L.newGame(); sync();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__sn = { get sim() { return sim; }, get view() { return view; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get wonRounds() { return wonRounds; }, get me() { return me; }, T, cpuTick, startCpu, steer, draw };
/* @test-hooks:end */
})();
