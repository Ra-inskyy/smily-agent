// smily — on-chain verification agent (BSC, read-only)
// No wallet, no signing, no funds movement. Verification only:
// a feed claim is not true until the chain says so.

export const BSC_CHAIN_ID = 56;
export const WATCH_WALLET = '0x07f3291813D6B60367411ee6a4a8B3D6DBCB47F2';

export const RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.bnbchain.org/',
  'https://bsc-dataseed2.bnbchain.org/',
  'https://rpc-bsc.48.club/',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Minimal ABI selectors for the checks the watcher actually runs.
export const SEL = {
  mintOpen: '0x24bbd049',       // mintOpen() -> bool (keccak-verified)
  totalSupply: '0x18160ddd',    // totalSupply() -> uint256
  totalMinted: '0xa2309ff8',    // totalMinted() -> uint256 (keccak-verified; may be absent)
  paused: '0x5c975abb',         // paused() -> bool
  balanceOf: '0x70a08231',       // balanceOf(address) -> uint256
  freeSupply: '0x9858cf19',     // FREE_SUPPLY() -> uint256 (keccak-verified; may be absent)
  freeFor: '0xbde5ccc9',         // freeFor(address) -> uint256 (may be absent)
  freeClaimed: '0x61c0b6a0',     // freeClaimed(address) -> bool (may be absent)
};

const pad32 = (hex) => hex.replace(/^0x/, '').padStart(64, '0');

async function rpcCall(url, method, params, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'rpc error');
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

async function ethCall(to, data) {
  let lastErr;
  for (const url of RPCS) {
    try {
      return await rpcCall(url, 'eth_call', [{ to, data }, 'latest']);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all RPCs failed');
}

async function ethBlockNumber() {
  let lastErr;
  for (const url of RPCS) {
    try { return parseInt(await rpcCall(url, 'eth_blockNumber', []), 16); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all RPCs failed');
}

const asBool = (hex) => hex !== null && hex !== undefined && BigInt(hex) !== 0n;
const asInt = (hex) => (hex === null || hex === undefined ? null : BigInt(hex));

// Try a read; return null when the function does not exist on the contract
// instead of failing the whole verification.
async function tryCall(to, data) {
  try {
    const r = await ethCall(to, data);
    if (r === '0x' || r === null) return null;
    return r;
  } catch { return null; }
}

/**
 * Verify one mint contract on-chain. Returns only what the chain said.
 * mintOpen: true/false/null (null = no mintOpen() on this contract)
 * paused, totalMinted/totalSupply, walletBalance: BigInt or null
 */
export async function verifyMint(contract) {
  const address = contract.toLowerCase();
  const [mintOpenRaw, pausedRaw, mintedRaw, supplyRaw, balRaw, freeForRaw, freeClaimedRaw] = await Promise.all([
    tryCall(address, SEL.mintOpen),
    tryCall(address, SEL.paused),
    tryCall(address, SEL.totalMinted),
    tryCall(address, SEL.totalSupply),
    tryCall(address, SEL.balanceOf + pad32(WATCH_WALLET)),
    tryCall(address, SEL.freeFor + pad32(WATCH_WALLET)),
    tryCall(address, SEL.freeClaimed + pad32(WATCH_WALLET)),
  ]);
  const block = await ethBlockNumber();
  return {
    contract: address,
    block,
    mintOpen: mintOpenRaw === null ? null : asBool(mintOpenRaw),
    paused: pausedRaw === null ? null : asBool(pausedRaw),
    totalMinted: asInt(mintedRaw),
    totalSupply: asInt(supplyRaw),
    walletBalance: asInt(balRaw),
    freeForWallet: asInt(freeForRaw),
    freeClaimedByWallet: freeClaimedRaw === null ? null : asBool(freeClaimedRaw),
    // Open = mintOpen true AND not paused. Null mintOpen means "cannot confirm".
    open: mintOpenRaw !== null && asBool(mintOpenRaw) && (pausedRaw === null || !asBool(pausedRaw)),
    verifiedAt: new Date().toISOString(),
  };
}

export function serializeVerification(v) {
  return {
    ...v,
    totalMinted: v.totalMinted === null ? null : v.totalMinted.toString(),
    totalSupply: v.totalSupply === null ? null : v.totalSupply.toString(),
    walletBalance: v.walletBalance === null ? null : v.walletBalance.toString(),
    freeForWallet: v.freeForWallet === null ? null : v.freeForWallet.toString(),
  };
}
