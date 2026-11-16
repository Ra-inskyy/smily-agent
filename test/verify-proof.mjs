// Helper for the e2e tests: verify a Groth16 proof against the official
// gatekeeper verification key, then exit.
//
// Why a separate process: snarkjs spawns a worker-thread pool that is
// never terminated, which keeps the `node --test` process alive forever
// after the first verify call. A short-lived child that calls
// process.exit() after printing the verdict avoids that hang.
//
// Usage: node test/verify-proof.mjs <proof.json> <signals.json>
// Prints VERIFIED or FAILED on stdout; exit code 0 = verified, 1 = not.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

const [proofPath, signalsPath] = process.argv.slice(2);
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const publicSignals = JSON.parse(readFileSync(signalsPath, 'utf8'));
const vk = JSON.parse(readFileSync(new URL('../circuits/verification_key.json', import.meta.url), 'utf8'));

const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
console.log(ok ? 'VERIFIED' : 'FAILED');
process.exit(ok ? 0 : 1);
