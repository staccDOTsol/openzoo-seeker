#!/usr/bin/env node
'use strict';

const assert = require('assert');
const pay = require('../www/app/pay.js');

const Y = pay.MINTS.YUSDCX;
const W = pay.MINTS.WTOKENX;
const L = pay.MINTS.WLEOSX;
const USDC = pay.MINTS.USDC;
const TOKEN = pay.MINTS.TOKEN;

function row(asset, amount, symbol, network) {
  return {
    scheme: 'exact',
    network: network || 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset,
    maxAmountRequired: String(amount),
    extra: { symbol, decimals: 6, feePayer: 'WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb' }
  };
}

const liveShape = [
  row(Y, 7027, 'yUSDCx'),
  {
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    maxAmountRequired: '7012',
    extra: { symbol: 'USDC', decimals: 6 }
  },
  row(W, 32316451, 'wTOKENx'),
  row(L, 46522762707, 'wLEOSx')
];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

check('never picks first solana row when only wTOKENx covers', () => {
  const r = pay.pickPayableRail(liveShape, { [W]: '32316451' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, W);
  assert.notStrictEqual(r.accept.asset, Y);
});

check('picks yUSDCx only when that twin actually covers', () => {
  const r = pay.pickPayableRail(liveShape, { [Y]: '7027' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, Y);
});

check('if both twins cover, prefer non-yUSDCx', () => {
  const r = pay.pickPayableRail(liveShape, { [Y]: '999999', [W]: '99999999' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, W);
});

check('wLEOSx covering beats empty yUSDCx / wTOKENx (no first-row default)', () => {
  const r = pay.pickPayableRail(liveShape, { [L]: '46522762707' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, L);
});

check('plain USDC does not silently build yUSDCx', () => {
  const r = pay.pickPayableRail(liveShape, { [USDC]: '1000000000' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'unwrapped-only');
  assert.match(r.reason, /not plain USDC/);
  assert.match(r.reason, /will not build/);
});

check('plain TOKEN does not pick a solana row', () => {
  const r = pay.pickPayableRail(liveShape, { [TOKEN]: '1000000000' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'unwrapped-only');
  assert.match(r.reason, /wTOKENx/);
});

check('empty wallet steers instead of defaulting', () => {
  const r = pay.pickPayableRail(liveShape, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no-balance');
});

check('missing balances object is a hard fail (no guess)', () => {
  const r = pay.pickPayableRail(liveShape, null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no-balances');
});

check('never returns an eip155 row even if that is the only coverable amount conceptually', () => {
  const r = pay.pickPayableRail(liveShape, {});
  assert.ok(!r.accept);
  const sol = pay.solanaAccepts(liveShape);
  assert.ok(sol.every((a) => a.network.startsWith('solana:')));
  assert.strictEqual(sol.length, 3);
});

check('eip155-only 402 is rejected', () => {
  const r = pay.pickPayableRail([liveShape[1]], { [USDC]: '999' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no-solana');
});

check('insufficient yUSDCx with leftover dust is not payable', () => {
  const r = pay.pickPayableRail(liveShape, { [Y]: '1' });
  assert.strictEqual(r.ok, false);
});

check('encodePayment fills the envelope payload', () => {
  const b64 = pay.encodePayment({
    x402Version: 1,
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    payload: { transaction: '<replace>' }
  }, 'SIGNEDTX');
  const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  assert.strictEqual(decoded.payload.transaction, 'SIGNEDTX');
  assert.strictEqual(decoded.x402Version, 1);
});

console.log('\n' + passed + ' checks passed');
