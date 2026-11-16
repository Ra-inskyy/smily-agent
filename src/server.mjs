// smily agent endpoint — the public HTTP surface of the agent.
// GET  /health          -> { ok: true, agent, version }
// GET  /api/status      -> last watcher run (data/status.json)
// GET  /agent           -> health payload (platform health check)
// POST / and POST /agent -> Agent Games task envelopes (HMAC-signed):
//   { type: "agent-games.preflight.v1" }          -> { ok: true, protocolVersion: "v1" }
//   { type: "agent-games.proof-gatekeeper.v1" }   -> APPROVE/REJECT + Groth16 proof (src/gatekeeper.mjs)
//   { type: "verify-mint", contract }             -> on-chain free-mint verification
//   If AGENT_GAMES_SECRET is set, the x-agent-games-signature HMAC-SHA256
//   over the raw body is verified BEFORE parsing (fail closed on mismatch),
//   and EVERY response is signed with x-agent-games-signature over the raw
//   response body (hex HMAC-SHA256). Without a secret, preflight and
//   gatekeeper tasks answer 500 (misconfigured); verify-mint keeps its
//   legacy unsigned dev-mode behaviour.
//   Never signs, never mints, never moves funds. Read-only verification.
//   Run:  node src/server.mjs   (PORT env, default 3000)

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { verifyMint, serializeVerification } from './bsc.mjs';
import { handleGatekeeper } from './gatekeeper.mjs';
import { SeenStore } from './seen.mjs';

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.AGENT_GAMES_SECRET || '';
const seen = new SeenStore();

if (!SECRET) {
  console.error('[smily] WARNING: AGENT_GAMES_SECRET is not set — preflight/gatekeeper will answer 500; verify-mint runs unsigned (dev mode).');
}

function decodeSignature(headerValue) {
  if (typeof headerValue !== 'string') return null;
  let s = headerValue.trim();
  if (s.toLowerCase().startsWith('sha256=')) s = s.slice('sha256='.length);
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return Buffer.from(s, 'hex');
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 0) return buf;
  } catch { /* fall through */ }
  return null;
}

function verifyHmac(req, raw) {
  if (!SECRET) return { ok: true, note: 'no secret configured (dev mode)' };
  const sig = req.headers['x-agent-games-signature'];
  if (!sig) return { ok: false, error: 'missing signature' };
  const expected = createHmac('sha256', SECRET).update(raw).digest();
  const provided = decodeSignature(sig);
  if (!provided || provided.length !== expected.length) return { ok: false, error: 'signature mismatch' };
  try {
    if (!timingSafeEqual(provided, expected)) return { ok: false, error: 'signature mismatch' };
  } catch { return { ok: false, error: 'signature mismatch' }; }
  return { ok: true };
}

function signBody(body) {
  if (!SECRET) return null;
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function send(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length };
  const sig = signBody(body);
  if (sig) headers['x-agent-games-signature'] = sig;
  res.writeHead(code, headers);
  res.end(body);
}

function lastStatus() {
  const p = './data/status.json';
  if (!existsSync(p)) return { ranAt: null, newCandidates: [], corrections: [], verified: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { error: 'status unreadable' }; }
}

function healthPayload() {
  return {
    ok: true, agent: 'smily', version: '1.0.0',
    protocolVersion: 'v1',
    hmacConfigured: Boolean(SECRET),
    uptime_s: Math.floor(process.uptime()),
  };
}

async function handlePost(req, res) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > 1024 * 1024) { tooBig = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (tooBig) return send(res, 413, { error: 'body too large' });
    const raw = Buffer.concat(chunks);

    // HMAC first, before any parsing (when a secret is configured).
    const auth = verifyHmac(req, raw);
    if (!auth.ok) return send(res, 401, { error: auth.error });

    let task;
    try { task = JSON.parse(raw.toString('utf8')); } catch {
      return send(res, 400, { decision: 'REJECT', reason_code: 'INVALID_TASK', error: 'invalid JSON' });
    }

    // Preflight handshake — the platform's health probe.
    if (task.type === 'agent-games.preflight.v1') {
      if (!SECRET) return send(res, 500, { error: 'server misconfigured: AGENT_GAMES_SECRET is not set' });
      return send(res, 200, { ok: true, protocolVersion: 'v1' });
    }

    // Proof Gatekeeper task.
    if (task.type === 'agent-games.proof-gatekeeper.v1') {
      if (!SECRET) return send(res, 500, { error: 'server misconfigured: AGENT_GAMES_SECRET is not set' });
      try {
        const result = await handleGatekeeper({ secret: SECRET, seen, envelope: task });
        return send(res, result.status, result.bodyObj);
      } catch (err) {
        console.error('[gatekeeper] handler error:', err);
        return send(res, 200, { decision: 'REJECT', reason_code: 'INVALID_TASK', proof_tx: task.input ? task.input.proof_tx : null, error: 'internal error' });
      }
    }

    // Legacy verify-mint task (kept working; signed when a secret is set).
    if (task.type === 'verify-mint') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(task.contract || '')) {
        return send(res, 400, { error: 'task must be { type: "verify-mint", contract: "0x..." }' });
      }
      try {
        const v = serializeVerification(await verifyMint(task.contract));
        return send(res, 200, { decision: v.open ? 'OPEN' : 'NOT_OPEN', evidence: v });
      } catch (e) {
        return send(res, 502, { decision: 'UNKNOWN', error: String(e) }); // fail closed, never guess
      }
    }

    return send(res, 400, { decision: 'REJECT', reason_code: 'INVALID_TASK', error: `unknown type: ${task.type}` });
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true, agent: 'smily', version: '1.0.0' });
  if (req.method === 'GET' && pathname === '/api/status') return send(res, 200, lastStatus());
  if (req.method === 'GET' && pathname === '/agent') return send(res, 200, healthPayload());
  if (req.method === 'GET' && pathname === '/') {
    const body = Buffer.from('<h1>smily — on-chain verification agent</h1><p>GET /health, GET /api/status, POST /agent</p>', 'utf8');
    const headers = { 'Content-Type': 'text/html', 'Content-Length': body.length };
    const sig = signBody(body);
    if (sig) headers['x-agent-games-signature'] = sig;
    res.writeHead(200, headers);
    return res.end(body);
  }
  if (req.method === 'POST' && (pathname === '/agent' || pathname === '/')) {
    return handlePost(req, res);
  }
  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`smily listening on :${PORT}`));
