import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { parseFeed, loadWatermark } from '../src/watcher.mjs';
import { SEL } from '../src/bsc.mjs';
import { decide, toField, taskIdToField, deriveSalt, loadVerificationKey, REASON_CODES } from '../src/gatekeeper.mjs';

test('parseFeed parses CA rows and skips headers/junk', () => {
  const text = [
    'CA | PROJECT | SYMBOL | TYPE | CHAIN | STATUS | DETECTED_AT',
    '0x50823fD4C14435B8b13E8B03F4d1CFEe099687BC | ChampX | CHAMPX | NFT | BSC | FAILED | 2026-11-16',
    'not an address | Foo | FOO | NFT | BSC | WATCH | 2026-11-16',
    '',
  ].join('\n');
  const rows = parseFeed(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contract, '0x50823fd4c14435b8b13e8b03f4d1cfee099687bc');
  assert.equal(rows[0].project, 'ChampX');
  assert.equal(rows[0].status, 'FAILED');
});

test('selectors are real keccak256 function selectors', () => {
  // Verified against pycryptodome keccak256, 16 Nov 2026.
  assert.equal(SEL.mintOpen, '0x24bbd049');
  assert.equal(SEL.totalMinted, '0xa2309ff8');
  assert.equal(SEL.paused, '0x5c975abb');
  assert.equal(SEL.totalSupply, '0x18160ddd');
  assert.equal(SEL.balanceOf, '0x70a08231');
  assert.equal(SEL.freeSupply, '0x9858cf19');
});

test('loadWatermark returns empty lists when missing', () => {
  assert.deepEqual(loadWatermark('/tmp/smily-no-such-file.json'), { candidate: [], watch: [] });
});

// ---- Proof Gatekeeper: decision matrix (all 7 trap varieties) ----

const VK_HASH = '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';
const OTHER_VK = '0xa4c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708ff1';
const RECIPIENT = '0xDe42a1b2c3d4e5f6a7b8c9d0e1f2a3b49f01';
const OTHER_RECIPIENT = '0xBeef000000000000000000000000000000000001';

function baseInput(overrides = {}) {
  return {
    registered_vk: VK_HASH, proof_vk: VK_HASH,
    minimum: '1000', public_balance: '1460',
    expiry_block: 19842201, current_block: 19832000,
    recipient: RECIPIENT, condition_recipient: RECIPIENT,
    amount: '500', max_transfer: '1000',
    proof_tx: '0xa4c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708ff1',
    ...overrides,
  };
}
const noSeen = { has: () => false };

test('gatekeeper decide: all 7 reason codes + boundaries', () => {
  const cases = [
    ['valid', {}, 'APPROVE', 'VALID_CONDITION'],
    ['vk substitution', { proof_vk: OTHER_VK }, 'REJECT', 'VK_SUBSTITUTION'],
    ['threshold', { public_balance: '999' }, 'REJECT', 'THRESHOLD_MISMATCH'],
    ['expired', { current_block: 19842201 }, 'REJECT', 'EXPIRED_CONDITION'],
    ['recipient', { condition_recipient: OTHER_RECIPIENT }, 'REJECT', 'RECIPIENT_MISMATCH'],
    ['overflow', { amount: '1001' }, 'REJECT', 'AMOUNT_OVERFLOW'],
    ['boundary balance==minimum', { public_balance: '1000' }, 'APPROVE', 'VALID_CONDITION'],
    ['boundary amount==max', { amount: '1000' }, 'APPROVE', 'VALID_CONDITION'],
    ['boundary current==expiry-1', { current_block: 19842200 }, 'APPROVE', 'VALID_CONDITION'],
    ['missing field', { amount: undefined }, 'REJECT', 'INVALID_TASK'],
    ['non-numeric', { amount: 'abc' }, 'REJECT', 'INVALID_TASK'],
  ];
  for (const [name, over, decision, code] of cases) {
    assert.deepEqual(decide(baseInput(over), noSeen), { decision, reason_code: code }, name);
  }
  // Proof reuse: a proof_tx already in the seen-set.
  const seen = { has: (tx) => tx === baseInput().proof_tx };
  assert.deepEqual(decide(baseInput(), seen), { decision: 'REJECT', reason_code: 'PROOF_REUSED' });
  // Every documented reason code is in the exported taxonomy.
  for (const code of ['VALID_CONDITION', 'VK_SUBSTITUTION', 'PROOF_REUSED', 'THRESHOLD_MISMATCH', 'EXPIRED_CONDITION', 'RECIPIENT_MISMATCH', 'AMOUNT_OVERFLOW']) {
    assert.ok(REASON_CODES.includes(code), code);
  }
});

test('gatekeeper field helpers: mod-p reduction, taskId hash, deterministic salt', () => {
  assert.equal(toField('1000').toString(), '1000');
  assert.equal(toField('0x10').toString(), '16');
  // A 32-byte hash does not fit the field: reduced mod p, not truncated.
  const big = toField(VK_HASH);
  assert.ok(big < BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617'));
  assert.equal(taskIdToField('gk_24_9d1').toString(), taskIdToField('gk_24_9d1').toString());
  assert.notEqual(taskIdToField('gk_24_9d1').toString(), taskIdToField('gk_24_9d2').toString());
  assert.equal(deriveSalt('test-secret', 'gk_1').toString(), deriveSalt('test-secret', 'gk_1').toString());
  assert.notEqual(deriveSalt('test-secret', 'gk_1').toString(), deriveSalt('test-secret', 'gk_2').toString());
});

// ---- End-to-end: real server, signed envelopes, real Groth16 proofs ----

const TEST_SECRET = 'test-only-secret-never-a-platform-secret';
const E2E_PORT = 18787;
const E2E_BASE = `http://127.0.0.1:${E2E_PORT}`;

function sign(body) {
  return createHmac('sha256', TEST_SECRET).update(body).digest('hex');
}
function responseSignatureValid(bodyText, sig) {
  if (!sig) return false;
  const expected = createHmac('sha256', TEST_SECRET).update(Buffer.from(bodyText, 'utf8')).digest();
  let provided;
  try { provided = Buffer.from(sig, 'hex'); } catch { return false; }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
async function post(path, env, { signed = true } = {}) {
  const body = JSON.stringify(env);
  const headers = { 'content-type': 'application/json', connection: 'close' };
  if (signed) headers['x-agent-games-signature'] = sign(body);
  const res = await fetch(`${E2E_BASE}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, text, json, sig: res.headers.get('x-agent-games-signature') };
}
async function waitForHealth(child, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${E2E_BASE}/health`, { signal: AbortSignal.timeout(3000), headers: { connection: 'close' } });
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('server did not come up; last log: ' + child._log);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Verify a proof in a short-lived child process (see test/verify-proof.mjs):
// snarkjs spawns a worker pool that never terminates, which would keep
// this test process alive forever if verify ran in-process.
async function proofVerifies(proof, publicSignals) {
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const proofPath = join(tmpdir(), `smily-proof-${tag}.json`);
  const signalsPath = join(tmpdir(), `smily-signals-${tag}.json`);
  writeFileSync(proofPath, JSON.stringify(proof));
  writeFileSync(signalsPath, JSON.stringify(publicSignals));
  const code = await new Promise((resolve) => {
    const child = spawn('node', ['test/verify-proof.mjs', proofPath, signalsPath], {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (c) => resolve(out.trim() === 'VERIFIED' && c === 0));
  });
  return code;
}

// The child server needs the egress proxy to reach BSC RPC (verify-mint).
const CHILD_ENV = {
  ...process.env,
  PORT: String(E2E_PORT),
  AGENT_GAMES_SECRET: TEST_SECRET,
  HTTP_PROXY: 'http://hatch-egress-proxy:3128',
  HTTPS_PROXY: 'http://hatch-egress-proxy:3128',
  http_proxy: 'http://hatch-egress-proxy:3128',
  https_proxy: 'http://hatch-egress-proxy:3128',
  NODE_USE_ENV_PROXY: '1',
  SSL_CERT_FILE: '/run/hatch/egress-tls/ca-bundle.pem',
  NODE_EXTRA_CA_CERTS: '/run/hatch/egress-tls/ca-bundle.pem',
};

test('e2e: preflight on / and /agent returns signed { ok: true, protocolVersion: "v1" }', { timeout: 120000 }, async (t) => {
  const child = spawn('node', ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...CHILD_ENV, SEEN_STORE_PATH: join(tmpdir(), `smily-seen-${process.pid}.json`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  await waitForHealth(child);

  for (const path of ['/', '/agent']) {
    const r = await post(path, { type: 'agent-games.preflight.v1' });
    assert.equal(r.status, 200, `${path} status`);
    assert.deepEqual(r.json, { ok: true, protocolVersion: 'v1' }, `${path} body`);
    assert.ok(responseSignatureValid(r.text, r.sig), `${path} response signature verifies`);
  }

  // Unsigned preflight is rejected (fail closed).
  const unsigned = await post('/agent', { type: 'agent-games.preflight.v1' }, { signed: false });
  assert.equal(unsigned.status, 401);

  // Wrong signature is rejected.
  const body = JSON.stringify({ type: 'agent-games.preflight.v1' });
  const bad = await fetch(`${E2E_BASE}/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close', 'x-agent-games-signature': sign(body + 'tampered') },
    body,
  });
  assert.equal(bad.status, 401);
});

test('e2e: gatekeeper valid APPROVE + VK_SUBSTITUTION REJECT carry real proofs that verify locally', { timeout: 180000 }, async (t) => {
  const child = spawn('node', ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...CHILD_ENV, SEEN_STORE_PATH: join(tmpdir(), `smily-seen-${process.pid}-2.json`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  await waitForHealth(child);
  const vk = loadVerificationKey();
  assert.equal(vk.nPublic, 13);

  const valid = await post('/agent', {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: 'gk_e2e_valid_001',
    mode: 'competition',
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 55000).toISOString(),
    input: baseInput({ proof_tx: '0x11c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708ff1' }),
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.json.decision, 'APPROVE');
  assert.equal(valid.json.reason_code, 'VALID_CONDITION');
  assert.ok(valid.json.proof, 'APPROVE carries a proof');
  assert.equal(valid.json.public_signals.length, 13);
  assert.ok(responseSignatureValid(valid.text, valid.sig), 'response signature verifies');
  assert.ok(await proofVerifies(valid.json.proof, valid.json.public_signals), 'APPROVE proof verifies against the official VK');

  const trap = await post('/agent', {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: 'gk_e2e_vk_002',
    mode: 'competition',
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 55000).toISOString(),
    input: baseInput({ proof_vk: OTHER_VK, proof_tx: '0x22c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708ff1' }),
  });
  assert.equal(trap.status, 200);
  assert.equal(trap.json.decision, 'REJECT');
  assert.equal(trap.json.reason_code, 'VK_SUBSTITUTION');
  assert.ok(trap.json.proof, 'REJECT carries a proof');
  assert.ok(await proofVerifies(trap.json.proof, trap.json.public_signals), 'REJECT proof verifies against the official VK');

  // Redelivery of the same task_id returns the cached response, not PROOF_REUSED.
  const redelivery = await post('/agent', {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: 'gk_e2e_valid_001',
    mode: 'competition',
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 55000).toISOString(),
    input: baseInput({ proof_tx: '0x11c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708ff1' }),
  });
  assert.equal(redelivery.json.decision, 'APPROVE');
  assert.equal(redelivery.json.reason_code, 'VALID_CONDITION');

  // A fresh task reusing the same proof_tx is PROOF_REUSED and carries no proof.
  const reused = await post('/agent', {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: 'gk_e2e_reuse_003',
    mode: 'competition',
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 55000).toISOString(),
    input: baseInput({ proof_tx: '0x11c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708ff1' }),
  });
  assert.equal(reused.json.decision, 'REJECT');
  assert.equal(reused.json.reason_code, 'PROOF_REUSED');
  assert.equal(reused.json.proof, undefined);
});

test('e2e: verify-mint still works (signed) via /agent', { timeout: 120000 }, async (t) => {
  const child = spawn('node', ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...CHILD_ENV, SEEN_STORE_PATH: join(tmpdir(), `smily-seen-${process.pid}-3.json`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  await waitForHealth(child);
  const r = await post('/agent', { type: 'verify-mint', contract: '0x50823fD4C14435B8b13E8B03F4d1CFEe099687BC' });
  if (r.status === 502) { t.skip('BSC RPC unreachable from this run'); return; }
  assert.equal(r.status, 200);
  assert.ok(['OPEN', 'NOT_OPEN'].includes(r.json.decision), `decision is ${r.json.decision}`);
  assert.ok(responseSignatureValid(r.text, r.sig), 'response signature verifies');
});
