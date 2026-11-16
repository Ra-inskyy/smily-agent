// Persistent seen-set (proof_tx reuse detection) + idempotent response cache.
//
// Why: PROOF_REUSED is ~11% of Gatekeeper tasks, and the platform may
// retry a delivery after a network failure. A redelivered task_id must get
// its cached response — NOT be misread as a reused proof.
//
// Storage: in-memory Set/Map + a JSON file (default data/seen.json,
// overridable via SEEN_STORE_PATH). Persistence failure never breaks the
// response path; the in-memory set still protects this process lifetime.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH =
  process.env.SEEN_STORE_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seen.json');

export class SeenStore {
  constructor(filePath = DEFAULT_PATH) {
    this.filePath = filePath;
    this.seenProofTx = new Set();
    this.responses = new Map(); // task_id -> { status, body, signature }
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(raw.seenProofTx)) this.seenProofTx = new Set(raw.seenProofTx);
      if (raw.responses && typeof raw.responses === 'object') {
        this.responses = new Map(Object.entries(raw.responses));
      }
    } catch { /* first run: file does not exist yet */ }
  }

  _save() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      writeFileSync(tmp, JSON.stringify({
        seenProofTx: [...this.seenProofTx],
        responses: Object.fromEntries(this.responses),
      }));
      renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[seen] failed to persist seen-set:', err.message);
    }
  }

  has(proofTx) { return this.seenProofTx.has(String(proofTx)); }

  /** Record a proof_tx as used. Only call AFTER a decision was made for it (not for redeliveries). */
  markSeen(proofTx) {
    this.seenProofTx.add(String(proofTx));
    this._save();
  }

  getCached(taskId) { return this.responses.get(String(taskId)) || null; }

  setCached(taskId, entry) {
    this.responses.set(String(taskId), entry);
    this._save();
  }
}
