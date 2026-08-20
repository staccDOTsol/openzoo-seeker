#!/usr/bin/env node
'use strict';

const assert = require('assert');
const pay = require('../www/app/pay.js');

const Y = pay.MINTS.YUSDCX;
const W_DOC = pay.MINTS.WTOKENX;       // Bo7x… documented twin
const W_LIVE = pay.MINTS.WTOKENX_LIVE; // FXYk… quoted live 2026-08-20
const L = pay.MINTS.WLEOSX;
const USDC = pay.MINTS.USDC;
const TOKEN = pay.MINTS.TOKEN;
const LEOS = pay.MINTS.LEOS;

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
  row(W_LIVE, 32316451, 'wTOKENx'),
  row(L, 46522762707, 'wLEOSx')
];

const TWIN_RE = /yUSDCx|wTOKENx|wLEOSx/;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

check('BUILD_WRAPS is false until a real POST proves wrap+transfer', () => {
  assert.strictEqual(pay.BUILD_WRAPS, false);
});

check('display labels never leak twin names', () => {
  assert.strictEqual(pay.displaySymbol(liveShape[0]), 'USDC');
  assert.strictEqual(pay.displaySymbol(liveShape[2]), 'TOKEN');
  assert.strictEqual(pay.displaySymbol(liveShape[3]), 'LEOS');
});

check('solana filter drops eip155', () => {
  const sol = pay.solanaAccepts(liveShape);
  assert.ok(sol.every((a) => a.network.startsWith('solana:')));
  assert.strictEqual(sol.length, 3);
});

check('USDC button maps to the yUSDCx accept via extra.symbol, not accepts[0] luck', () => {
  const accept = pay.findAcceptForRail(liveShape, 'USDC');
  assert.ok(accept);
  assert.strictEqual(accept.asset, Y);
  assert.strictEqual(pay.displaySymbol(accept), 'USDC');
});

check('TOKEN button maps to the live wTOKENx row (FXYk), not the documented Bo7x mint', () => {
  const accept = pay.findAcceptForRail(liveShape, 'TOKEN');
  assert.ok(accept);
  assert.strictEqual(accept.asset, W_LIVE);
  assert.strictEqual(pay.displaySymbol(accept), 'TOKEN');
});

check('TOKEN button also matches the documented Bo7x twin if that is what 402 quotes', () => {
  const shape = [row(Y, 1, 'yUSDCx'), row(W_DOC, 50, 'wTOKENx')];
  const accept = pay.findAcceptForRail(shape, 'TOKEN');
  assert.strictEqual(accept.asset, W_DOC);
});

check('LEOS button maps only when a solana LEOS row exists', () => {
  assert.strictEqual(pay.findAcceptForRail(liveShape, 'LEOS').asset, L);
  assert.strictEqual(pay.findAcceptForRail(liveShape.slice(0, 3), 'LEOS'), null);
});

check('TOKEN button + TOKEN twin covering picks that row, not the first Solana row', () => {
  const r = pay.pickPayableRail(liveShape, { [W_LIVE]: '32316451' }, 'TOKEN');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, W_LIVE);
  assert.notStrictEqual(r.accept.asset, Y);
});

check('USDC button + USDC twin covering picks USDC', () => {
  const r = pay.pickPayableRail(liveShape, { [Y]: '7027' }, 'USDC');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, Y);
  assert.strictEqual(pay.displaySymbol(r.accept), 'USDC');
});

check('USDC button does not silently fall through to TOKEN when USDC twin is empty', () => {
  const r = pay.pickPayableRail(liveShape, { [W_LIVE]: '99999999' }, 'USDC');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Fund this wallet with USDC \/ TOKEN \/ LEOS/);
  assert.doesNotMatch(r.reason, TWIN_RE);
});

check('plain USDC does not silently build the USDC rail (builder does not wrap)', () => {
  const r = pay.pickPayableRail(liveShape, { [USDC]: '1000000000' }, 'USDC');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'unwrapped-only');
  assert.strictEqual(r.reason, 'Fund this wallet with USDC / TOKEN / LEOS');
  assert.doesNotMatch(r.reason, TWIN_RE);
});

check('plain TOKEN does not pick a solana row', () => {
  const r = pay.pickPayableRail(liveShape, { [TOKEN]: '1000000000' }, 'TOKEN');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'unwrapped-only');
  assert.doesNotMatch(r.reason, TWIN_RE);
});

check('plain LEOS underlying does not pay the LEOS rail', () => {
  const r = pay.pickPayableRail(liveShape, { [LEOS]: '1000000000' }, 'LEOS');
  assert.strictEqual(r.ok, false);
  assert.doesNotMatch(r.reason, TWIN_RE);
});

check('empty wallet steers with fund copy, no twin names', () => {
  const r = pay.pickPayableRail(liveShape, {}, 'USDC');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no-balance');
  assert.match(r.reason, /Fund this wallet with USDC \/ TOKEN/);
  assert.doesNotMatch(r.reason, TWIN_RE);
});

check('no button selected is a hard fail (no first-row default)', () => {
  const r = pay.pickPayableRail(liveShape, { [Y]: '999999' }, null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'need-rail');
});

check('missing balances object is a hard fail (no guess)', () => {
  const r = pay.pickPayableRail(liveShape, null, 'USDC');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no-balances');
});

check('eip155-only 402 is rejected even if the button is USDC', () => {
  const r = pay.pickPayableRail([liveShape[1]], { [USDC]: '999' }, 'USDC');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no-solana');
});

check('LEOS not offered when no solana LEOS row', () => {
  const r = pay.pickPayableRail(liveShape.slice(0, 3), { [L]: '999' }, 'LEOS');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'not-offered');
  assert.match(r.reason, /LEOS is not offered/);
});

check('LEOS button + LEOS twin covering picks that row', () => {
  const r = pay.pickPayableRail(liveShape, { [L]: '46522762707' }, 'LEOS');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.accept.asset, L);
  assert.strictEqual(pay.displaySymbol(r.accept), 'LEOS');
});

check('insufficient USDC twin with leftover dust is not payable', () => {
  const r = pay.pickPayableRail(liveShape, { [Y]: '1' }, 'USDC');
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
