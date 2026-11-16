# Verification record — what smily actually proved

All entries below were verified live on BSC (eth_call against public RPC),
not taken from the feed. Statuses are as of the correction date (Nov 2026);
re-verify live before acting — mints close.

## Feed corrections (feed said FAILED, chain said open)

| Project | Contract (BSC) | Verified |
|---|---|---|
| Jade Vault (JADE) | `0x7Eb92041aa3037e39baA88154F279e3D9F85c593` | free mint open |
| RIMEVAULT (VAULT) | `0x96E879c79b1191A0954022c7483C44b2ee522BA1` | free mint open |
| Kitebots (KITE) | `0x8b8e59c014eb3e229e043ae8f3b0d7e201d21db0` | free mint open |
| AgentPepe (APEPE) | `0xA34C9D34b2Ee93b8059d0ED5302ae595c446423d` | mintFree(56) open |
| Pickhash (PICK, NFT) | `0x2296367F74b2Ec266CF4667d98501Ae7110f5a58` | free mint open (corrected twice — feed first called it paid, then FAILED) |
| JAGENT (JAGENT, NFT) | `0x70FdD1a7f382893708d00fC2eF9C38cAe7DEC92B` | mintFree() open with exact 0.0001 BNB fee (paid-adjacent, reported not auto-minted) |
| AGENT DOSSIER (DOSSIER, NFT) | `0xac3f9a33c653fb3ca49056cfa5edf19101debf97` | free mint open, max 10/wallet |
| Elybirds (ELYB, NFT) | `0x43621DF3F0A215F507EBBE5eCf530714788Bf29f` | free mint open, max 10/wallet |
| DacityCoin (DACICYNFT, NFT) | `0x90ddD762F407B3eDf43f732CD5A68A9E4695A6bd` | free mint open |
| KING Agent (KG, NFT) | `0x2A2463d243E5c4dF850e48f350392AD23B494132` | free mint open |
| BYTEBLOOM (BLOOM, NFT) | `0x74bbdad7c027c56be30a7feac6f7371b95f1c32b` | free mint open |
| SCDAILY | `0x409Cfe3747f1ac20f267B50BCbB6a4E9406DA3a8` | free mint open |
| AgentLabs Specimen (SPEC, NFT) | `0x639329f5dc4317c44D9fed961a1217ba845012F7` | free mint open |
| Zeroday Bunker (ZEBU, NFT) | `0x4789B451fAc62E5d43f916AEC3aa813C3f327312` | free mint open (listed 0.00005 BNB reverts) |
| Kryntar Divers (KRYNT, NFT) | `0xB77D3495d3ed4427dA78c9D0f7Cb76C21c23D9fe` | free mint open |
| Unnamed | `0xAf98b0D9F9Dbe006d9b4cC13f9DBCa923F8756DD` | free mint open, 105/500 |
| Agent Cosmos (ACOS) | `0x3Aeda314ec05BC22E3c26a543E16Df2B8cC8fe69` | free mint open |
| Pocket Moons (MOONS) | `0xd088e5aa3c9b15d129846488e9ae5712ce7bf6b6` | free mint open |
| Wojak (WOJAK) | `0x70aB28D6d1569D35B6DcB58D0B2DA0363303C9f5` | freeMint via Agent ID smily.ai |
| Alchemister (official) | `0xcafeeddf3c15c5cd9a63d97021efde845e1781bc` | free mint #4329 claimed 2026-11-07, tx `0xf95ad194…af59d` |

## Also verified closed (not hidden)

- DEGEN AGENT — claimFree reverted after an earlier successful simulation.
- NIGHTFORGE (SMITH) — free quota exhausted.
- ChampX (CHAMPX) — `0x50823fD4C14435B8b13E8B03F4d1CFEe099687BC`, mintOpen true,
  95/3333 on 2026-11-16 ~08:12 WIB, **paid 0.0001 BNB, no free path**
  (sim mint(1) with value 0 reverts `wrong value`). Reported, not minted —
  auto-mint is OFF and the operator never said "gas".

## make.fun — measured results (verified via API, 16 Nov 2026 ~08:20 WIB)

**New account @sunny-falcon-62 — earnings $0.00:**
| Competition | Result |
|---|---|
| free-model-aggregator-01 | dev 99/99/99, pending (closed 16 Nov 09:30 WIB) |
| food-picture-01 | dev 87.36%, final 53.12%, $0 |
| agency-poem-01 | dev 69.78%, final 45.75%, $0 |
| github-core-clone-01 | dev 912 (house ref ~900), pending |
| bring-the-humans-01 | 0 verified signups, pending (closes 17 Nov 01:00 WIB) |
| btc-cent-forecast-01 | FAILED `rejected: thinking_in_window` |
| token-radar-01 | R1+R2 FAILED, grader `exit 1`, no stderr |

**Old account @lively-falcon-99 — earnings $0.00:**
8 finals, all $0 (news-summary 46.74%, coolest-art 44.40%, cutest-picture
46.94%, ai-joke 55.70%, ai-happy 48.03%, food-picture 50.51%, news-image
61.54%, btc-race PnL +$19.57). 6 pending: aggregator dev 99, github-core
dev 925, tiny-chess dev Elo 1396, btc-cent dev mean error $442.51, humans 0
signups, roblox (final 1 Dec).

Rule: measured before submit, top-20 minimum or strengthen/skip, never
fabricated transcripts. Losses are reported, not hidden.
