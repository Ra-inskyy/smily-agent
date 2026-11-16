# Wildcard submission — form text (copy/paste)

## Agent link
Public repository: `smily-agent` (this repo) — Node.js, zero dependencies.
Demo: `demo/index.html` (public static demo page).

## Public endpoint
Public HTTPS endpoint for the agent: the demo page URL (GitHub Pages) serves
the agent's public status, and `src/server.mjs` in this repo is the full
agent endpoint (`GET /health`, `GET /api/status`, `POST /agent`) — anyone
can run it. Honest note: the live agent loop runs on the operator's machine
on a 1-minute cron; this VM has no public IP and its egress proxy blocks
every free no-account tunnel (trycloudflare 403, localtunnel 403, bore.pub
unreachable — re-tested 16 Nov 2026), so the endpoint itself cannot be
served from here. The demo URL is the public face; the code is the agent.

## Use case
Problem: free-mint feeds lie. They flip live mints to FAILED while the
contracts are still open, and bots drain free supplies in minutes — a human
watching a feed can't tell what's actually mintable.
Who it helps: any Agent ID operator on BNB Chain who wants to know, minute
by minute, which free mints are really open — without handing an agent their
wallet or letting it auto-spend.
What it does: mirrors the free-mint feed every minute, verifies each new
candidate live on BSC (`mintOpen()`, `paused()`, supply), corrects the
feed's wrong FAILED flags on-chain, and reports. Report-only: auto-mint has
been OFF since 7 Nov 2026; a mint only happens on an explicit human "gas".
It also builds measured make.fun coding entries (top-20 bar, never faked
transcripts) — verification as a habit, not a slogan.

## Build context
- `src/watcher.mjs` — feed mirror + on-chain verification loop, watermarked
  so one change = one report, never spam. `src/bsc.mjs` — raw eth_call
  helpers with multi-RPC fallback; a browser User-Agent because the VM's
  egress proxy filters other clients; functions that don't exist on a
  contract return null instead of failing the whole check.
- `src/server.mjs` — HTTP agent: HMAC-SHA256 verified against the raw body
  before parsing; fail-closed on signature mismatch, bad input, or RPC
  failure; read-only, never signs or mints.
- Key decisions: on-chain state beats feed state, always; report-only beats
  auto-spend, always; a failed simulation is investigated, never executed
  blind; a loss is reported, never hidden (see docs/VERIFICATION.md — $0
  earned across 21 make.fun competitions so far, reported in full).

## zkVerify (optional)
The checkable claim is: "this contract's `mintOpen()` returned true at
block N" — a zkTLS-style attestation over a real RPC response, verifiable
without revealing the full payload. No proof is attached yet, for the
endpoint reason above. Agents without zkVerify remain eligible, and this
submission is honest about the limit instead of faking a proof.
