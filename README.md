# smily — an on-chain verification agent

**Agent ID:** smily.ai · **Wallet (BSC, read-only):** `0x07f3291813D6B60367411ee6a4a8B3D6DBCB47F2`
**Operator:** Anggara · **Agent Games:** Creator Track (submitted 15 Nov 2026) + Wildcard (this repo)

smily does one job: **verification**. A feed claim isn't true until the chain
says so. A transcript isn't real unless the work happened. A score isn't a
win until it pays.

## What it does

1. **1-minute free-mint watcher** (`src/watcher.mjs`) — mirrors the free-mint
   feed every minute, and for every new candidate calls the contract live on
   BSC (`mintOpen()`, `paused()`, `totalMinted()`, `totalSupply()`,
   `balanceOf()`) via public RPC. The feed keeps flipping mints to FAILED
   while they are still open — smily corrects those on-chain, in the same
   turn (see [docs/VERIFICATION.md](docs/VERIFICATION.md)).
2. **Agent endpoint** (`src/server.mjs`) — `GET /health`, `GET /api/status`,
   `POST /agent` with a `verify-mint` task. HMAC-SHA256 signature verified
   against the raw body *before* parsing; fail-closed on any mismatch or
   uncertainty. Read-only: it never signs, never mints, never moves funds.
3. **Measured make.fun agent** — real coding-bounty entries, measured before
   submit, top-20 bar or strengthen/skip, never fabricated transcripts.

## Safety rules (standing, set by the operator)

- **Auto-mint OFF since 7 Nov 2026** — report-only. A mint only happens on
  an explicit human "gas".
- Simulate before broadcast, confirm before sign, minimal approvals,
  fail-closed. If a simulation reverts, investigate *why* it failed —
  never execute blind.

## Run it

```bash
node src/watcher.mjs ./data   # one watcher run (feed + on-chain verify)
node src/server.mjs            # agent endpoint on :3000 (PORT env)
```

Node >= 18, zero dependencies. BSC RPC: public `bsc-dataseed` endpoints
with fallback; a browser User-Agent (the VM's egress proxy filters others).

## Live results (verified 16 Nov 2026 ~08:20 WIB)

- **make.fun, new account @sunny-falcon-62:** 7 competitions — 5 submitted,
  2 failed. Best: free-model-aggregator dev **99/99/99**, food-picture dev
  87.36% (final 53.12%, $0), github-core dev **912** (house ref ~900),
  agency-poem final 45.75% ($0). Failed: btc-cent
  (`rejected: thinking_in_window` — session started before the competition
  opened), token-radar R1+R2 (grader `exit 1`, no stderr). Earnings: **$0**.
- **make.fun, old account @lively-falcon-99:** 14 competitions, 8 finals,
  all $0. Best: github-core dev 925, tiny-chess dev Elo 1396, news-image
  final 61.54%.
- **Feed corrections:** Jade Vault, RIMEVAULT, Kitebots, AgentPepe, Pickhash,
  JAGENT, AGENT DOSSIER and more — all marked FAILED by the feed while
  their free mints were still open on-chain. Full list in
  [docs/VERIFICATION.md](docs/VERIFICATION.md).

## zkVerify (optional plus)

Verification is the whole point of smily, and zkVerify is the natural way to
make a verification checkable: the checkable claim is *"this contract's
`mintOpen()` returned true at block N"* — a zkTLS-style attestation over a
real RPC response, verifiable without revealing the full payload. No proof
is attached yet: this VM has no public IP and its egress proxy blocks every
free no-account tunnel (trycloudflare 403, localtunnel 403, bore.pub
unreachable — re-tested 16 Nov 2026), so no public endpoint could be served
from here and no live Gatekeeper/Steal-the-VFY rounds could be played.
Agents without zkVerify remain eligible for Wildcard, and this submission is
honest about that limit instead of faking a proof.

## Demo

`demo/index.html` — public static demo page (GitHub Pages). The live agent
loop runs on the operator's machine on a 1-minute cron; the repo contains
the full server code so anyone can run the endpoint themselves.
