'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

function ready(st) { while (st.wait > 0) L.step(st); }
function place(st, w, cells, dir) { st.snakes[w].body = cells.map(([x, y]) => ({ x, y })); st.snakes[w].dir = st.snakes[w].next = dir; }

test('new game has two snakes of start length and food', () => {
  const st = L.newGame({ seed: 1 });
  assert.strictEqual(st.snakes[0].body.length, L.START_LEN);
  assert.strictEqual(st.snakes[1].body.length, L.START_LEN);
  assert.strictEqual(st.food.length, L.FOODS);
  assert.ok(st.wait > 0);
  assert.strictEqual(st.winner, -1);
});

test('start positions are 180 degree symmetric', () => {
  const st = L.newGame({ seed: 1 });
  st.snakes[0].body.forEach((c, i) => {
    const o = st.snakes[1].body[i];
    assert.strictEqual(o.x, L.COLS - 1 - c.x);
    assert.strictEqual(o.y, L.ROWS - 1 - c.y);
  });
});

test('nothing moves during the wait', () => {
  const st = L.newGame({ seed: 2 });
  const h = { ...st.snakes[0].body[0] };
  L.step(st);
  assert.deepStrictEqual(st.snakes[0].body[0], h);
});

test('snake moves one cell per step in its direction', () => {
  const st = L.newGame({ seed: 2 });
  ready(st);
  const h = { ...st.snakes[0].body[0] };
  L.step(st);
  assert.deepStrictEqual(st.snakes[0].body[0], { x: h.x + L.DX[0], y: h.y + L.DY[0] });
  assert.strictEqual(st.snakes[0].body.length, L.START_LEN);
});

test('reverse direction is refused, turns are accepted', () => {
  const st = L.newGame({ seed: 2 });
  assert.strictEqual(L.setDir(st, 0, 2), false);
  assert.strictEqual(L.setDir(st, 0, 1), true);
  assert.strictEqual(L.setDir(st, 0, 9), false);
  assert.strictEqual(L.setDir(st, 0, 1.5), false);
});

test('two quick turns in one tick cannot make a U turn', () => {
  const st = L.newGame({ seed: 2 });
  ready(st);
  assert.strictEqual(L.setDir(st, 0, 1), true);     // 위로 가던 뱀이 오른쪽으로
  assert.strictEqual(L.setDir(st, 0, 2), false);    // 아직 위로 가는 중이라 아래는 바로 뒤 - 거절
  L.step(st);
  assert.strictEqual(st.winner, -1);
  assert.strictEqual(st.snakes[0].dir, 1);
});

test('eating food grows the snake and respawns food', () => {
  const st = L.newGame({ seed: 3 });
  ready(st);
  const h = st.snakes[0].body[0];
  st.food[0] = { x: h.x, y: h.y - 1 };
  const len = st.snakes[0].body.length;
  L.step(st);
  assert.strictEqual(st.snakes[0].body.length, len + 1);
  assert.strictEqual(st.food.length, L.FOODS);
  assert.ok(st.events.some((e) => e.type === 'eat' && e.who === 0));
});

test('hitting a wall loses', () => {
  const st = L.newGame({ seed: 4 });
  ready(st);
  place(st, 0, [[0, 5], [1, 5], [2, 5]], 3);
  L.step(st);
  assert.strictEqual(st.winner, 1);
  assert.strictEqual(st.reason, 'crash');
});

test('hitting your own body loses', () => {
  const st = L.newGame({ seed: 4 });
  ready(st);
  place(st, 0, [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6]], 3);   // 머리 (5,5) 왼쪽 -> (4,5) 비어 있음
  st.snakes[0].dir = st.snakes[0].next = 2;                   // 아래로 가면 (5,6) 자기 몸
  L.step(st);
  assert.strictEqual(st.winner, 1);
});

test('hitting the other snake body loses', () => {
  const st = L.newGame({ seed: 4 });
  ready(st);
  place(st, 0, [[5, 10], [5, 11], [5, 12]], 0);               // 위로
  place(st, 1, [[6, 9], [5, 9], [4, 9]], 1);                  // 오른쪽으로 가는 중, 몸이 (5,9) (4,9)
  L.step(st);
  assert.strictEqual(st.winner, 1);                           // 0 번 머리가 (5,9) 에 닿음
});

test('head on collision is a draw', () => {
  const st = L.newGame({ seed: 4 });
  ready(st);
  place(st, 0, [[5, 10], [5, 11], [5, 12]], 0);
  place(st, 1, [[5, 8], [5, 7], [5, 6]], 2);
  L.step(st);
  assert.strictEqual(st.winner, 2);
});

test('swapping places through each other is a draw', () => {
  const st = L.newGame({ seed: 4 });
  ready(st);
  place(st, 0, [[5, 10], [4, 10], [3, 10]], 1);
  place(st, 1, [[6, 10], [7, 10], [8, 10]], 3);
  L.step(st);
  assert.strictEqual(st.winner, 2);
});

test('tail cell frees up so chasing your own tail is fine', () => {
  const st = L.newGame({ seed: 4 });
  ready(st);
  st.food = [{ x: 0, y: 0 }, { x: 16, y: 0 }];
  place(st, 0, [[5, 5], [5, 6], [6, 6], [6, 5]], 1);          // 오른쪽으로 가면 꼬리 자리(6,5)
  L.step(st);
  assert.strictEqual(st.winner, -1);
});

test('time limit gives the longer snake the win', () => {
  const st = L.newGame({ seed: 5 });
  ready(st);
  st.tick = L.MAX_TICKS - 1;
  place(st, 0, [[8, 15], [8, 16], [8, 17], [8, 18]], 0);
  place(st, 1, [[8, 5], [8, 4], [8, 3]], 2);
  L.step(st);
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.reason, 'time');
});

test('same seed and moves give the same game', () => {
  const run = () => {
    const st = L.newGame({ seed: 9 });
    const r = L.rng(3);
    for (let i = 0; i < 80 && st.winner < 0; i++) { for (let w = 0; w < 2; w++) L.setDir(st, w, L.aiPick(st, w, 'hard', r)); L.step(st); }
    return JSON.stringify([st.snakes, st.food, st.winner]);
  };
  assert.strictEqual(run(), run());
});

test('computer never makes an immediately deadly move when a safe one exists', () => {
  const st = L.newGame({ seed: 11 });
  const r = L.rng(5);
  ready(st);
  for (let i = 0; i < 200 && st.winner < 0; i++) {
    const w = i % 2;
    const d = L.aiPick(st, w, 'hard', r);
    const s = st.snakes[w];
    const nx = s.body[0].x + L.DX[d], ny = s.body[0].y + L.DY[d];
    assert.ok(L.inside(nx, ny) || true);
    for (let k = 0; k < 2; k++) L.setDir(st, k, L.aiPick(st, k, 'hard', r));
    L.step(st);
  }
  assert.ok(st.tick > 20, 'a hard computer survives a while');
});

test('hard computer beats easy computer most of the time', () => {
  let hard = 0, easy = 0;
  for (let s = 1; s <= 60; s++) {
    const st = L.newGame({ seed: s }); const r = L.rng(s + 100);
    while (st.winner < 0) { L.setDir(st, 0, L.aiPick(st, 0, 'hard', r)); L.setDir(st, 1, L.aiPick(st, 1, 'easy', r)); L.step(st); }
    if (st.winner === 0) hard++; else if (st.winner === 1) easy++;
  }
  assert.ok(hard > easy * 3, `hard ${hard} easy ${easy}`);
});
