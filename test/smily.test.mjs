import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, loadWatermark } from '../src/watcher.mjs';
import { SEL } from '../src/bsc.mjs';

test('parseFeed parses CA rows and skips headers/junk', () => {
  const text = [
    'CA | PROJECT | SYMBOL | TYPE | CHAIN | STATUS | DETECTED_AT',
    '0x50823fD4C14435B8b13E8B03F4d1CFEe099687BC | ChampX | CHAMPX | NFT | BSC | FAILED | 2026-11-16',
    'not an address | Foo | FOO | NFT | BSC | WATCH | 2026-11-16',
    '',
  ].join('\n');
  const rows = parseFeed(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contract, '0x50823fd4c14435b8b13e8b03f4d1cfee099687bc');
  assert.equal(rows[0].project, 'ChampX');
  assert.equal(rows[0].status, 'FAILED');
});

test('selectors are real keccak256 function selectors', () => {
  // Verified against pycryptodome keccak256, 16 Nov 2026.
  assert.equal(SEL.mintOpen, '0x24bbd049');
  assert.equal(SEL.totalMinted, '0xa2309ff8');
  assert.equal(SEL.paused, '0x5c975abb');
  assert.equal(SEL.totalSupply, '0x18160ddd');
  assert.equal(SEL.balanceOf, '0x70a08231');
  assert.equal(SEL.freeSupply, '0x9858cf19');
});

test('loadWatermark returns empty lists when missing', () => {
  assert.deepEqual(loadWatermark('/tmp/smily-no-such-file.json'), { candidate: [], watch: [] });
});
