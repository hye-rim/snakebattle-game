'use strict';

// 서버 시험: 보안·안정성 회귀 + 스네이크 대결 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TICK_MS: '25', BREAK_MS: '150' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}

function track(c) {
  c.ws.on('message', (d) => { let m; try { m = JSON.parse(d); } catch { return; } if (m.t === 's') c.frame = m; if (m.t === 'ev') (c.evs = c.evs || []).push(m); });
}
// 받은 틀에서 내 머리 위치를 읽어 안전한 쪽으로 돈다 (벽·몸을 피하는 간단한 봇)
function steer(c) {
  const f = c.frame || c.room;
  const me = c.room.you, body = f.b[me];
  if (!body || body.length < 4) return;
  const hx = body[0], hy = body[1], dir = body[0] === body[2] ? (body[1] < body[3] ? 0 : 2) : (body[0] > body[2] ? 1 : 3);
  const blocked = new Set();
  f.b.forEach((b) => { for (let i = 0; i < b.length; i += 2) blocked.add(b[i + 1] * L.COLS + b[i]); });
  const order = [dir, (dir + 1) % 4, (dir + 3) % 4];
  for (const d of order) {
    const nx = hx + L.DX[d], ny = hy + L.DY[d];
    if (L.inside(nx, ny) && !blocked.has(ny * L.COLS + nx)) { if (d !== dir) send(c, 'dir', { d }); return; }
  }
}

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts round one with two snakes and food', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.deepStrictEqual(a.room.wins, [0, 0]);
  assert.strictEqual(a.room.round, 1);
  assert.strictEqual(a.room.b.length, 2);
  assert.strictEqual(a.room.f.length, L.FOODS);
  a.ws.close(); b.ws.close();
});

test('garbage direction messages are ignored and the server survives', async () => {
  await ready;
  const [a, b] = await pair();
  for (const m of [{ d: 'a' }, { d: null }, {}, { d: 9 }, { d: 1.5 }, { d: [1] }, { d: -1 }]) send(a, 'dir', m);
  a.ws.send('not json'); a.ws.send('{"t":"dir"');
  await sleep(200);
  assert.strictEqual(a.closed, null);
  assert.strictEqual(await get('/'), 200);
  a.ws.close(); b.ws.close();
});

test('state frames stream to both players and snakes move', async () => {
  await ready;
  const [a, b] = await pair();
  track(a); track(b);
  assert.ok(await until(() => a.frame && b.frame && a.frame.w === 0, 3000), 'frames arrive after the countdown');
  const h0 = a.frame.b[0].slice(0, 2).join();
  await sleep(150);
  assert.notStrictEqual(a.frame.b[0].slice(0, 2).join(), h0, 'the head moved');
  a.ws.close(); b.ws.close();
});

test('a full match through the server ends by rounds', async () => {
  await ready;
  const [a, b] = await pair();
  track(a); track(b);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && a.room.state !== 'over') { steer(a); if (Date.now() % 3) steer(b); await sleep(20); }
  assert.ok(await until(() => a.room.state === 'over', 4000), 'the match ends');
  assert.strictEqual(a.room.reason, 'rounds');
  assert.ok(a.room.wins[0] >= 2 || a.room.wins[1] >= 2 || a.room.round >= 5);
  a.ws.close(); b.ws.close();
});

test('resigning ends the match and rematch swaps snakes', async () => {
  await ready;
  const [a, b] = await pair();
  const seatA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2));
  assert.notStrictEqual(a.room.you, seatA, 'snakes swap on a rematch');
  assert.deepStrictEqual(a.room.wins, [0, 0]);
  a.ws.close(); b.ws.close();
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
