// smily agent endpoint — the public HTTP surface of the agent.
// GET  /health          -> { ok: true }
// GET  /api/status      -> last watcher run (data/status.json)
// POST /agent           -> verify-mint task: { type: "verify-mint", contract }
//   If AGENT_GAMES_SECRET is set, verifies the x-agent-games-signature
//   HMAC-SHA256 over the raw body BEFORE parsing (fail closed on mismatch).
//   Never signs, never mints, never moves funds. Read-only verification.
//   Run:  node src/server.mjs   (PORT env, default 3000)

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { verifyMint, serializeVerification } from './bsc.mjs';

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.AGENT_GAMES_SECRET || '';

function verifyHmac(req, raw) {
  if (!SECRET) return { ok: true, note: 'no secret configured (dev mode)' };
  const sig = req.headers['x-agent-games-signature'];
  if (!sig) return { ok: false, error: 'missing signature' };
  const expected = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: false, error: 'signature mismatch' };
    }
  } catch { return { ok: false, error: 'signature mismatch' }; }
  return { ok: true };
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function lastStatus() {
  const p = './data/status.json';
  if (!existsSync(p)) return { ranAt: null, newCandidates: [], corrections: [], verified: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { error: 'status unreadable' }; }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, agent: 'smily', version: '1.0.0' });
  if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, lastStatus());
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<h1>smily — on-chain verification agent</h1><p>GET /health, GET /api/status, POST /agent</p>');
  }
  if (req.method === 'POST' && url.pathname === '/agent') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      const auth = verifyHmac(req, raw);
      if (!auth.ok) return send(res, 401, { error: auth.error }); // fail closed
      let task;
      try { task = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      if (task.type !== 'verify-mint' || !/^0x[0-9a-fA-F]{40}$/.test(task.contract || '')) {
        return send(res, 400, { error: 'task must be { type: "verify-mint", contract: "0x..." }' });
      }
      try {
        const v = serializeVerification(await verifyMint(task.contract));
        return send(res, 200, { decision: v.open ? 'OPEN' : 'NOT_OPEN', evidence: v });
      } catch (e) {
        return send(res, 502, { decision: 'UNKNOWN', error: String(e) }); // fail closed, never guess
      }
    });
    return;
  }
  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`smily listening on :${PORT}`));
