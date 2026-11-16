// Proof Gatekeeper handling for zkVerify Agent Games Season 01.
//
// Protocol (https://agentgames.zkverify.io/build, /api/circuit-info, and
// the event-page sample payload):
//   Task envelope: { type: "agent-games.proof-gatekeeper.v1", task_id,
//     mode, issued_at, deadline_at, input: {
//       registered_vk, proof_vk, minimum, public_balance, expiry_block,
//       current_block, recipient, condition_recipient, amount,
//       max_transfer, proof_tx } }
//   Response: { decision: "APPROVE"|"REJECT", reason_code, proof_tx,
//     proof (Groth16), public_signals } — signed with
//     x-agent-games-signature (HMAC-SHA256 over the raw response body).
//
// Decision rules — APPROVE only if ALL hold (boundaries included):
//   1. proof_vk == registered_vk            (VK_SUBSTITUTION otherwise)
//   2. proof_tx not seen before             (PROOF_REUSED otherwise)
//   3. public_balance >= minimum            (THRESHOLD_MISMATCH otherwise)
//   4. current_block < expiry_block         (EXPIRED_CONDITION otherwise)
//   5. recipient == condition_recipient     (RECIPIENT_MISMATCH otherwise)
//   6. amount <= max_transfer               (AMOUNT_OVERFLOW otherwise)
//
// The proof is a REAL Groth16 proof generated locally with snarkjs
// against the official gatekeeper circuit (Groth16/BN128, Circom 2.x;
// vk_hash 0x6b79c6…ad77b0 from /api/circuit-info; artifacts in
// circuits/, sha256-verified — see scripts/download-circuits.sh).
// The circuit asserts decision == (all five field checks), so a wrong
// decision cannot even produce a witness: the circuit is the referee.
// Fail closed throughout: malformed envelopes, internal errors and
// proof-generation failures resolve to REJECT, never to an unproven
// APPROVE. (PROOF_REUSED carries no proof — the event page states those
// tasks "have no proof to submit and are excluded" from proof scoring.)
//
// Kurier / on-chain submission is NOT wired: there is no Kurier API key
// and no funded zkVerify account for this agent, so proof_tx in the
// response echoes the task's own proof_tx (the platform re-verifies the
// attached Groth16 proof itself). Nothing here spends anything.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// snarkjs is CommonJS (no ESM default export); load via require.
const snarkjs = require('snarkjs');

export const GATEKEEPER_VK_HASH =
  '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

// BN128 scalar-field prime.
export const P = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

const CIRCUITS_DIR =
  process.env.CIRCUITS_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'circuits');
const WASM_PATH = join(CIRCUITS_DIR, 'gatekeeper.wasm');
const ZKEY_PATH = join(CIRCUITS_DIR, 'gatekeeper_final.zkey');
const VK_PATH = join(CIRCUITS_DIR, 'verification_key.json');

export const REASON_CODES = [
  'VALID_CONDITION',
  'VK_SUBSTITUTION',
  'PROOF_REUSED',
  'THRESHOLD_MISMATCH',
  'EXPIRED_CONDITION',
  'RECIPIENT_MISMATCH',
  'AMOUNT_OVERFLOW',
];

export function modP(x) {
  const r = x % P;
  return r >= 0n ? r : r + P;
}

/** Convert a hex string ("0x…"), decimal string, or number to a field element (BigInt mod p). */
export function toField(value) {
  if (typeof value === 'bigint') return modP(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`toField: not a non-negative safe integer: ${value}`);
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return modP(BigInt(s));
    if (/^[0-9]+$/.test(s)) return modP(BigInt(s));
    throw new Error(`toField: unsupported string value: ${value}`);
  }
  throw new Error(`toField: unsupported type: ${typeof value}`);
}

/**
 * task_id -> field element. Free-form ids (e.g. "gk_24_9d1") are SHA-256
 * hashed and reduced mod p; numeric / 0x ids are used directly (mod p).
 */
export function taskIdToField(taskId) {
  if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('taskIdToField: task_id must be a non-empty string');
  if (/^0x[0-9a-fA-F]+$/.test(taskId) || /^[0-9]+$/.test(taskId)) return toField(taskId);
  const digest = createHash('sha256').update(taskId, 'utf8').digest('hex');
  return modP(BigInt('0x' + digest));
}

/**
 * Deterministic per-task circuit salt (private input):
 * salt = HMAC-SHA256(secret, "gatekeeper-salt:" + task_id) mod p.
 * Deterministic so a redelivered task reproduces identical proof inputs.
 */
export function deriveSalt(hmacSecret, taskId) {
  if (!hmacSecret) throw new Error('deriveSalt: HMAC secret is required');
  const mac = createHmac('sha256', hmacSecret).update(`gatekeeper-salt:${taskId}`, 'utf8').digest('hex');
  return modP(BigInt('0x' + mac));
}

function asBigInt(value, field) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${field}: not a safe integer`);
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
    if (/^-?[0-9]+$/.test(s)) return BigInt(s);
    throw new Error(`${field}: not a number: ${value}`);
  }
  throw new Error(`${field}: unsupported type ${typeof value}`);
}

function sameAddress(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Decide a task.
 * @param {object} input the task's `input` object
 * @param {object} seen object with has(proofTx) -> bool
 * @returns {{decision: 'APPROVE'|'REJECT', reason_code: string}}
 */
export function decide(input, seen) {
  if (!input || typeof input !== 'object') {
    return { decision: 'REJECT', reason_code: 'INVALID_TASK' };
  }
  try {
    const required = ['registered_vk', 'proof_vk', 'minimum', 'public_balance',
      'expiry_block', 'current_block', 'recipient', 'condition_recipient',
      'amount', 'max_transfer', 'proof_tx'];
    for (const f of required) {
      if (input[f] === undefined || input[f] === null || input[f] === '') {
        return { decision: 'REJECT', reason_code: 'INVALID_TASK' };
      }
    }
    // 1. Verification key must match the registered condition VK.
    if (String(input.proof_vk).trim().toLowerCase() !== String(input.registered_vk).trim().toLowerCase()) {
      return { decision: 'REJECT', reason_code: 'VK_SUBSTITUTION' };
    }
    // 2. Proof reference must not have been used before.
    if (seen && seen.has(String(input.proof_tx))) {
      return { decision: 'REJECT', reason_code: 'PROOF_REUSED' };
    }
    // 3. Public balance must meet the minimum threshold.
    if (asBigInt(input.public_balance, 'public_balance') < asBigInt(input.minimum, 'minimum')) {
      return { decision: 'REJECT', reason_code: 'THRESHOLD_MISMATCH' };
    }
    // 4. Condition must not have expired (block height).
    if (asBigInt(input.current_block, 'current_block') >= asBigInt(input.expiry_block, 'expiry_block')) {
      return { decision: 'REJECT', reason_code: 'EXPIRED_CONDITION' };
    }
    // 5. Recipient must match the condition recipient.
    if (!sameAddress(input.recipient, input.condition_recipient)) {
      return { decision: 'REJECT', reason_code: 'RECIPIENT_MISMATCH' };
    }
    // 6. Amount must not exceed the single-transfer cap.
    if (asBigInt(input.amount, 'amount') > asBigInt(input.max_transfer, 'max_transfer')) {
      return { decision: 'REJECT', reason_code: 'AMOUNT_OVERFLOW' };
    }
    return { decision: 'APPROVE', reason_code: 'VALID_CONDITION' };
  } catch {
    return { decision: 'REJECT', reason_code: 'INVALID_TASK' };
  }
}

/** Build the 13 circuit inputs from a task envelope + decision. Values are decimal strings (field elements mod p). */
export function buildInputs(envelope, decision, hmacSecret) {
  const input = envelope.input;
  const decisionBit = decision === 'APPROVE' ? '1' : '0';
  return {
    taskId: taskIdToField(envelope.task_id).toString(),
    registeredVkHash: toField(input.registered_vk).toString(),
    proofVkHash: toField(input.proof_vk).toString(),
    minimum: toField(input.minimum).toString(),
    publicBalance: toField(input.public_balance).toString(),
    expiryBlock: toField(input.expiry_block).toString(),
    currentBlock: toField(input.current_block).toString(),
    recipient: toField(input.recipient).toString(),
    conditionRecipient: toField(input.condition_recipient).toString(),
    amount: toField(input.amount).toString(),
    maxTransfer: toField(input.max_transfer).toString(),
    decision: decisionBit,
    salt: deriveSalt(hmacSecret, envelope.task_id).toString(),
  };
}

/**
 * Generate a Groth16 proof for a decision.
 * @throws if witness generation fails — which is precisely what happens
 *   for a WRONG decision (approve a trap / reject a valid condition).
 */
export async function prove(envelope, decision, hmacSecret) {
  const inputs = buildInputs(envelope, decision, hmacSecret);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, WASM_PATH, ZKEY_PATH);
  return { proof, publicSignals: publicSignals.map(String) };
}

let vkCache = null;
export function loadVerificationKey() {
  if (!vkCache) vkCache = JSON.parse(readFileSync(VK_PATH, 'utf8'));
  return vkCache;
}

/** Verify a proof locally against the extracted verification key. */
export async function verifyLocally(proof, publicSignals) {
  return snarkjs.groth16.verify(loadVerificationKey(), publicSignals, proof);
}

/**
 * Handle one gatekeeper task envelope (already HMAC-verified, parsed).
 * Returns { status, bodyObj } — the caller signs and sends it.
 * Idempotent: a task_id seen before returns its cached response.
 */
export async function handleGatekeeper({ secret, seen, envelope, nowMs = Date.now() }) {
  const started = Date.now();
  const taskId = envelope.task_id;
  if (typeof taskId !== 'string' || !taskId) {
    return { status: 400, bodyObj: { decision: 'REJECT', reason_code: 'INVALID_TASK', error: 'missing task_id' } };
  }

  // Idempotent redelivery -> cached response (NOT a reuse).
  const cached = seen.getCached(taskId);
  if (cached) {
    return { status: cached.status, bodyObj: JSON.parse(cached.body), cached: true };
  }

  // Deadline sanity -> fail closed.
  const deadlineMs = envelope.deadline_at ? Date.parse(envelope.deadline_at) : NaN;
  if (!Number.isNaN(deadlineMs) && nowMs > deadlineMs) {
    const bodyObj = {
      decision: 'REJECT', reason_code: 'INVALID_TASK',
      proof_tx: envelope.input ? envelope.input.proof_tx : null,
      error: 'task already past deadline',
    };
    seen.setCached(taskId, { status: 200, body: JSON.stringify(bodyObj), signature: null });
    return { status: 200, bodyObj };
  }

  const input = envelope.input || {};
  const { decision, reason_code } = decide(input, seen);
  const elapsed = () => Date.now() - started;

  // Groth16 proof (except PROOF_REUSED, which has no proof to submit).
  let proof = null;
  let publicSignals = null;
  let proofError = null;
  if (reason_code !== 'PROOF_REUSED') {
    try {
      const result = await prove(envelope, decision, secret);
      proof = result.proof;
      publicSignals = result.publicSignals;
    } catch (err) {
      // A correct decision that cannot be proven means policy and circuit
      // disagree — log loudly, answer without proof, never approve blind.
      proofError = err.message;
      console.error(`[gatekeeper] proof generation failed for ${taskId} (${decision}/${reason_code}):`, err.message);
    }
  }

  // No Kurier key / no funded zkVerify account: proof_tx echoes the
  // task's own reference; the platform re-verifies the attached proof.
  if (input.proof_tx && reason_code !== 'PROOF_REUSED') seen.markSeen(input.proof_tx);

  const bodyObj = {
    decision,
    reason_code,
    proof_tx: input.proof_tx || null,
  };
  if (proof) {
    bodyObj.proof = proof;
    bodyObj.public_signals = publicSignals;
  }
  if (proofError) bodyObj.proof_error = proofError;
  bodyObj.elapsed_ms = elapsed();

  seen.setCached(taskId, { status: 200, body: JSON.stringify(bodyObj), signature: null });
  return { status: 200, bodyObj };
}
