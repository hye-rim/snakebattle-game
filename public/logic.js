'use strict';

// 스네이크 대결: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - COLS x ROWS 칸 판에서 두 마리 뱀이 같은 순간에 한 칸씩 움직인다. 먹이를 먹으면 한 칸 길어진다
// - 벽·자기 몸·상대 몸에 머리를 부딪히면 진다. 머리끼리 부딪히거나 서로 자리를 바꾸면 둘 다 진 것이라 무승부
// - 0 번 뱀은 왼쪽 아래에서 위로, 1 번 뱀은 오른쪽 위에서 아래로 시작한다 (판을 180도 돌리면 똑같아 공평하다)
// - 한 판이 MAX_TICKS 를 넘으면 더 긴 쪽이 이기고 같으면 무승부
const LOGIC_SNAKE = (() => {
const COLS = 17, ROWS = 21;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];          // 0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽
const START_LEN = 3, FOODS = 2, WAIT_TICKS = 20, MAX_TICKS = 700;

function rng(seed) {                                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
const at = (x, y) => y * COLS + x;

function makeSnake(who) {
  const body = [];
  const dir = who === 0 ? 0 : 2;
  const hx = who === 0 ? 4 : COLS - 5, hy = who === 0 ? ROWS - 6 : 5;
  for (let i = 0; i < START_LEN; i++) body.push({ x: hx, y: hy - DY[dir] * i });
  return { body, dir, next: dir, alive: true, grown: 0 };
}

function newGame(opts = {}) {
  const st = {
    snakes: [makeSnake(0), makeSnake(1)],
    food: [], tick: 0, wait: WAIT_TICKS, winner: -1, reason: '',
    rand: opts.rand || rng(opts.seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : opts.seed),
    events: [],
  };
  while (st.food.length < FOODS) spawnFood(st);
  return st;
}

function occupied(st, x, y) {
  for (const s of st.snakes) for (const c of s.body) if (c.x === x && c.y === y) return true;
  return st.food.some((f) => f.x === x && f.y === y);
}
function spawnFood(st) {
  const free = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!occupied(st, x, y)) free.push({ x, y });
  if (!free.length) return false;
  st.food.push(free[Math.floor(st.rand() * free.length)]);
  return true;
}

// 방향 바꾸기: 지금 가는 길의 반대(바로 뒤)로는 못 돈다. 받아들이면 true
function setDir(st, who, d) {
  const s = st.snakes[who];
  if (!s || !s.alive || st.winner >= 0 || !Number.isInteger(d) || d < 0 || d > 3) return false;
  if (d === (s.dir + 2) % 4) return false;
  if (s.next === d) return false;
  s.next = d;
  return true;
}

function step(st) {
  if (st.winner >= 0) return;
  if (st.wait > 0) { st.wait--; return; }
  st.tick++;
  const [a, b] = st.snakes;
  for (const s of st.snakes) s.dir = s.next;
  const eat = [false, false];
  for (let w = 0; w < 2; w++) {
    const s = st.snakes[w];
    const head = { x: s.body[0].x + DX[s.dir], y: s.body[0].y + DY[s.dir] };
    const fi = st.food.findIndex((f) => f.x === head.x && f.y === head.y);
    if (fi >= 0) { eat[w] = true; st.food.splice(fi, 1); st.events.push({ type: 'eat', who: w }); }
    s.body.unshift(head);
    if (!eat[w]) s.body.pop();
  }
  const dead = [false, false];
  for (let w = 0; w < 2; w++) {
    const s = st.snakes[w], o = st.snakes[1 - w], h = s.body[0];
    if (!inside(h.x, h.y)) dead[w] = true;
    else if (s.body.some((c, i) => i > 0 && c.x === h.x && c.y === h.y)) dead[w] = true;
    else if (o.body.some((c) => c.x === h.x && c.y === h.y)) dead[w] = true;   // 상대 몸(머리 포함)에 닿음
  }
  for (let w = 0; w < 2; w++) if (dead[w]) { st.snakes[w].alive = false; st.events.push({ type: 'die', who: w }); }
  if (dead[0] || dead[1]) {
    st.winner = dead[0] && dead[1] ? 2 : dead[0] ? 1 : 0;
    st.reason = 'crash';
    return;
  }
  while (st.food.length < FOODS) if (!spawnFood(st)) break;
  if (st.tick >= MAX_TICKS) {
    const la = a.body.length, lb = b.body.length;
    st.winner = la > lb ? 0 : lb > la ? 1 : 2;
    st.reason = 'time';
  }
}

// ---------- 컴퓨터 ----------
const cellKey = (x, y) => y * COLS + x;
// 몸이 막은 칸들 (다음 걸음에 꼬리가 비는 칸은 열려 있다고 본다. 먹으면 안 비지만 흔한 경우를 단순하게)
function blockedSet(st) {
  const set = new Set();
  for (const s of st.snakes) s.body.forEach((c, i) => { if (i < s.body.length - 1) set.add(cellKey(c.x, c.y)); });
  return set;
}
function floodArea(blocked, sx, sy, limit) {
  const seen = new Set([cellKey(sx, sy)]);
  const q = [[sx, sy]];
  let n = 0;
  while (q.length && n < limit) {
    const [x, y] = q.shift(); n++;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inside(nx, ny)) continue;
      const k = cellKey(nx, ny);
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return n;
}
// 가장 가까운 먹이까지 걸음 수 (몸을 피해서), 못 가면 큰 수
function distToFood(st, blocked, sx, sy) {
  if (!st.food.length) return 99;
  const targets = new Set(st.food.map((f) => cellKey(f.x, f.y)));
  const seen = new Set([cellKey(sx, sy)]);
  let layer = [[sx, sy]], dist = 0;
  while (layer.length && dist < 40) {
    const nextLayer = [];
    for (const [x, y] of layer) {
      if (targets.has(cellKey(x, y))) return dist;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inside(nx, ny)) continue;
        const k = cellKey(nx, ny);
        if (seen.has(k) || blocked.has(k)) continue;
        seen.add(k); nextLayer.push([nx, ny]);
      }
    }
    layer = nextLayer; dist++;
  }
  return 99;
}
// level 'easy': 먹이 쪽으로만 가고, 가끔 앞을 못 보고 엉뚱한 쪽으로 간다 / 'hard': 갈 수 있는 넓이를 재서 갇히지 않고, 상대 머리와 마주치는 길을 피한다
function aiPick(st, who, level, rand = Math.random) {
  const s = st.snakes[who], o = st.snakes[1 - who];
  const blocked = blockedSet(st);
  const cands = [];
  for (let d = 0; d < 4; d++) {
    if (d === (s.dir + 2) % 4) continue;
    const nx = s.body[0].x + DX[d], ny = s.body[0].y + DY[d];
    const safe = inside(nx, ny) && !blocked.has(cellKey(nx, ny));
    cands.push({ d, nx, ny, safe });
  }
  const safe = cands.filter((c) => c.safe);
  if (!safe.length) return s.dir;
  if (level === 'easy') {
    if (rand() < 0.12) return (safe[Math.floor(rand() * safe.length)]).d;   // 가끔 아무 길
    if (rand() < 0.05) return cands[Math.floor(rand() * cands.length)].d;   // 아주 가끔 벽도 못 봄
    let best = safe[0], bs = Infinity;
    for (const c of safe) { const sc = distToFood(st, blocked, c.nx, c.ny) + rand() * 1.5; if (sc < bs) { bs = sc; best = c; } }
    return best.d;
  }
  if (rand() < 0.04) return safe[Math.floor(rand() * safe.length)].d;      // 어려움도 가끔은 틈을 보인다 (사람이 이길 수 있게)
  const oh = o.body[0];
  const oppNext = new Set();
  if (o.alive) for (let d = 0; d < 4; d++) if (d !== (o.dir + 2) % 4) oppNext.add(cellKey(oh.x + DX[d], oh.y + DY[d]));
  const need = s.body.length + 4;
  let best = safe[0], bs = -Infinity;
  for (const c of safe) {
    const area = floodArea(blocked, c.nx, c.ny, 400);
    const fd = distToFood(st, blocked, c.nx, c.ny);
    let sc = Math.min(area, need * 3) * 3 - fd * 2;
    if (area < need) sc -= 200;                                     // 갇힐 길
    if (oppNext.has(cellKey(c.nx, c.ny))) sc -= 60;                 // 머리끼리 마주칠 칸
    sc += rand() * 0.3;
    if (sc > bs) { bs = sc; best = c; }
  }
  return best.d;
}

return { COLS, ROWS, DX, DY, START_LEN, FOODS, WAIT_TICKS, MAX_TICKS, rng, newGame, setDir, step, aiPick, inside, at };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_SNAKE;
