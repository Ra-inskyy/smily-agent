#!/bin/bash
# Download + verify the official Agent Games gatekeeper circuit artifacts.
# Source: https://agentgames.zkverify.io/circuits/ (Groth16/BN128, Circom 2.x)
# Also extracts the verification key (13 public inputs) from the zkey.
# Usage: bash scripts/download-circuits.sh   (needs snarkjs: npm install)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
mkdir -p circuits
curl -sL -o circuits/gatekeeper.wasm https://agentgames.zkverify.io/circuits/gatekeeper.wasm
curl -sL -o circuits/gatekeeper_final.zkey https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey
echo "be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f  circuits/gatekeeper.wasm" | sha256sum -c -
echo "adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d  circuits/gatekeeper_final.zkey" | sha256sum -c -
node node_modules/snarkjs/build/cli.cjs zkey export verificationkey circuits/gatekeeper_final.zkey circuits/verification_key.json
node -e "const vk=require('./circuits/verification_key.json'); if (vk.curve!=='bn128'||vk.protocol!=='groth16'||vk.nPublic!==13) throw new Error('unexpected verification key'); console.log('verification key OK: bn128 groth16 nPublic=13')"
echo "circuits ready"
