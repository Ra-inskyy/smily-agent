// smily watcher — mirrors the free-mint feed every run, verifies each
// candidate on-chain, and reports. REPORT-ONLY: it never mints, never
// signs, never moves funds. Auto-mint has been OFF since 2026-11-07;
// a mint only happens when a human says "gas".
//
// Feed format (raw): CA | PROJECT | SYMBOL | TYPE | CHAIN | STATUS | DETECTED_AT
//   STATUS: WATCH = mint not open yet, CANDIDATE = not executed,
//           MINTED = already minted, FAILED = failed/skipped (unreliable —
//           the feed flips mints to FAILED while they are still open;
//           on-chain state is the truth, see docs/VERIFICATION.md)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { verifyMint, serializeVerification } from './bsc.mjs';

export const FEED_URLS = {
  candidate: 'https://beastfarmer.xyz/monitorbnb/raw?status=candidate',
  watch: 'https://beastfarmer.xyz/monitorbnb/raw?status=watch',
  minted: 'https://beastfarmer.xyz/monitorbnb/raw?status=minted',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function parseFeed(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 7 || !/^0x[0-9a-fA-F]{40}$/.test(parts[0])) continue;
    const [contract, project, symbol, type, chain, status, detectedAt] = parts;
    rows.push({ contract: contract.toLowerCase(), project, symbol, type, chain, status, detectedAt });
  }
  return rows;
}

export async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  return parseFeed(await res.text());
}

export function loadWatermark(path) {
  if (!existsSync(path)) return { candidate: [], watch: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { candidate: [], watch: [] }; }
}

/**
 * One watcher run. `verify` is injectable for tests; defaults to the live
 * on-chain verifier. Returns the report object and writes data/status.json.
 */
export async function runWatcher({ outDir = './data', verify = verifyMint } = {}) {
  const watermarkPath = `${outDir}/watermark.json`;
  const prev = loadWatermark(watermarkPath);
  const report = { ranAt: new Date().toISOString(), newCandidates: [], statusChanges: [], corrections: [], verified: [] };

  for (const [list, url] of Object.entries(FEED_URLS)) {
    let rows;
    try { rows = await fetchFeed(url); } catch (e) { report[`feedError_${list}`] = String(e); continue; }
    const prevAddrs = new Set((prev[list] || []).map((a) => a.toLowerCase()));
    for (const row of rows) {
      if (list === 'candidate' && !prevAddrs.has(row.contract)) {
        // New candidate: verify on-chain before saying anything about it.
        let v = null;
        try { v = serializeVerification(await verify(row.contract)); } catch (e) { v = { contract: row.contract, error: String(e) }; }
        report.verified.push(v);
        report.newCandidates.push({ ...row, onChain: v });
        if (row.status === 'FAILED' && v && v.open === true) {
          report.corrections.push({ ...row, onChain: v, note: 'Feed says FAILED but mint is open on-chain — corrected.' });
        }
      }
    }
    prev[list] = rows.map((r) => r.contract);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(watermarkPath, JSON.stringify(prev, null, 2));
  writeFileSync(`${outDir}/status.json`, JSON.stringify(report, null, 2));
  return report;
}

// CLI: node src/watcher.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runWatcher({ outDir: process.argv[2] || './data' });
  console.log(JSON.stringify({
    ranAt: report.ranAt,
    newCandidates: report.newCandidates.length,
    corrections: report.corrections.length,
    verified: report.verified.length,
    feedErrors: Object.keys(report).filter((k) => k.startsWith('feedError_')),
  }, null, 2));
  for (const c of report.corrections) console.log('KOREKSI:', c.project, c.contract, 'feed FAILED, on-chain open =', c.onChain.open);
  for (const n of report.newCandidates) console.log('BARU:', n.project, n.symbol, n.contract, 'open =', n.onChain?.open ?? n.onChain?.error);
}
