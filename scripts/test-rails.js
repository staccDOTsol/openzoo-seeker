#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pay = require('../www/app/pay.js');
const wrap = require('../www/app/wrap.js');
const solana = require('../www/app/solana.js');

const W2 = wrap.WTOKENX2;
const DRAINED = wrap.DRAINED_MINT;
const Y = '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv';
const L = '3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35';
const USDC = pay.HOLDING_MINTS.USDC;
const TOKEN = pay.HOLDING_MINTS.TOKEN;
const LEOS = pay.HOLDING_MINTS.LEOS;
const OWNER = 'WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb';
const BLOCKHASH = '11111111111111111111111111111111';

function row(asset, amount, symbol, network) {
  return {
    scheme: 'exact',
    network: network || 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset,
    maxAmountRequired: String(amount),
    extra: { symbol, decimals: 6, feePayer: OWNER }
  };
}

const live402 = [
  row(Y, 7018, 'yUSDCx'),
  {
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    maxAmountRequired: '7003',
    extra: { symbol: 'USDC', decimals: 6 }
  },
  row(W2, 20109289, 'wTOKENx'),
  row(L, 46662470014, 'wLEOSx'),
  row(DRAINED, 1, 'wTOKENx')
];

const fixtureKinds = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'supported.json'),
  'utf8'
)).kinds;

let passed = 0;
function check(name, fn) {
  const out = fn();
  if (out && typeof out.then === 'function') {
    return out.then(() => {
      passed += 1;
      console.log('ok  ' + name);
    });
  }
  passed += 1;
  console.log('ok  ' + name);
  return Promise.resolve();
}

const TWIN_RE = /yUSDCx|wTOKENx2?|wLEOSx|fSPCX/;
const BIND_RE = /\/v1\/hrr\/bind|\/v1\/bind|context_id|context id|bind hash/i;
const DRAIN_RE = /Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9/;

async function run() {
  await check('live /supported is reachable and lists wTOKENx2', async () => {
    wrap.resetDirectoryCache();
    const kinds = await wrap.fetchSupported();
    const sol = wrap.solanaKinds(kinds);
    const token = sol.find((k) => k.extra.asset === W2);
    assert.ok(token, 'live directory must list FXYk…');
    assert.strictEqual(token.extra.symbol, 'wTOKENx2');
    assert.ok(!sol.some((k) => k.extra.asset === DRAINED), 'drained mint must be hidden');
    assert.strictEqual(token.extra.acquire.authorityBump, 254);
    assert.strictEqual(token.extra.acquire.program, wrap.WRAP_PROGRAM);
  });

  await check('drained mint is never a rail', () => {
    const sol = pay.solanaAccepts(live402);
    assert.ok(sol.every((a) => a.asset !== DRAINED));
    assert.strictEqual(wrap.acquireForMint(fixtureKinds, DRAINED), null);
  });

  await check('FXYk displays as TOKEN, never wTOKENx', () => {
    assert.strictEqual(pay.displaySymbol(live402[2]), 'TOKEN');
    assert.strictEqual(wrap.userLabelFor('wTOKENx', W2), 'TOKEN');
    assert.strictEqual(wrap.userLabelFor('wTOKENx2', W2), 'TOKEN');
    assert.doesNotMatch(pay.displaySymbol(live402[2]), /wTOKEN/);
  });

  await check('yUSDCx / wLEOSx display as USDC / LEOS', () => {
    assert.strictEqual(pay.displaySymbol(live402[0]), 'USDC');
    assert.strictEqual(pay.displaySymbol(live402[3]), 'LEOS');
  });

  await check('stripTwinHomework hides plumbing', () => {
    const s = wrap.stripTwinHomework('pay with wTOKENx2 then yUSDCx Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9');
    assert.doesNotMatch(s, TWIN_RE);
    assert.doesNotMatch(s, DRAIN_RE);
  });

  await check('TOKEN holding picks the live twin row, not yUSDCx', () => {
    const plan = pay.pickPayablePlan(live402, { [TOKEN]: '999999999' }, fixtureKinds);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.accept.asset, W2);
    assert.ok(plan.wrap);
    assert.strictEqual(plan.wrap.pool.authorityBump, 254);
    assert.strictEqual(plan.label, 'TOKEN');
  });

  await check('already holding enough wTOKENx2 pays without wrap', () => {
    const plan = pay.pickPayablePlan(live402, { [W2]: '20109289' }, fixtureKinds);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.accept.asset, W2);
    assert.strictEqual(plan.wrap, null);
  });

  await check('plain USDC plans a USDC wrap, not a guess at accepts[0] luck', () => {
    const plan = pay.pickPayablePlan(live402, { [USDC]: '1000000000' }, fixtureKinds);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.accept.asset, Y);
    assert.ok(plan.wrap);
    assert.strictEqual(plan.wrap.from, 'USDC');
  });

  await check('empty wallet steers without twin names', () => {
    const plan = pay.pickPayablePlan(live402, {}, fixtureKinds);
    assert.strictEqual(plan.ok, false);
    assert.match(plan.reason, /Send TOKEN, USDC, or LEOS/);
    assert.strictEqual(plan.prompt, 'short-tokens');
    assert.doesNotMatch(plan.reason, TWIN_RE);
    assert.doesNotMatch(plan.reason, DRAIN_RE);
  });

  await check('pickLargestUseful wraps $10 TOKEN even when raw < twin maxAmountRequired', () => {
    const tenDollarsIsh = '10000000';
    assert.ok(BigInt(tenDollarsIsh) < BigInt(live402[2].maxAmountRequired));
    const plan = pay.pickLargestUseful(live402, { [TOKEN]: tenDollarsIsh }, fixtureKinds);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.accept.asset, W2);
    assert.ok(plan.wrap);
    assert.strictEqual(plan.wrap.from, 'TOKEN');
    assert.strictEqual(plan.prompt, 'wrap');
    assert.match(plan.promptCopy, /You have TOKEN\. Wrap enough to send this\?/);
  });

  await check('pickLargestUseful gates on held > 0, never 1:1 twin-need vs underlying', () => {
    const plan = pay.pickLargestUseful(live402, { [TOKEN]: '1' }, fixtureKinds);
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.accept.asset, W2);
    assert.ok(plan.wrap);
    assert.notStrictEqual(plan.wrap.sharesNeeded, '1');
    assert.ok(BigInt(plan.wrap.sharesNeeded) > 1n);
  });

  await check('prompt copy is wrap / short SOL / short tokens', () => {
    assert.strictEqual(pay.COPY.wrap('TOKEN'), 'You have TOKEN. Wrap enough to send this?');
    assert.strictEqual(pay.COPY.wrap('USDC'), 'You have USDC. Wrap enough to send this?');
    assert.strictEqual(pay.COPY.wrap('LEOS'), 'You have LEOS. Wrap enough to send this?');
    assert.strictEqual(pay.COPY.shortSol, 'Needs a little SOL for the network fee');
    assert.strictEqual(pay.COPY.shortTokens, 'Send TOKEN, USDC, or LEOS to this wallet.');
    assert.strictEqual(pay.COPY.copied, 'Copied');
  });

  await check('pending 402 persists and clears', () => {
    pay.clearPending402();
    assert.strictEqual(pay.loadPending402(), null);
    pay.savePending402({ url: 'https://x402-tokens.fly.dev/v1/chat/completions', method: 'POST' });
    const got = pay.loadPending402();
    assert.ok(got);
    assert.strictEqual(got.url, 'https://x402-tokens.fly.dev/v1/chat/completions');
    pay.clearPending402();
    assert.strictEqual(pay.loadPending402(), null);
  });

  await check('eip155-only 402 is rejected', () => {
    const plan = pay.pickPayablePlan([live402[1]], { [USDC]: '9' }, fixtureKinds);
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.code, 'no-solana');
  });

  await check('wTOKENx2 wrap is nine accounts, bump 254', () => {
    const pool = wrap.resolvePool(fixtureKinds, W2);
    assert.ok(pool);
    assert.strictEqual(pool.authorityBump, 254);
    assert.strictEqual(pool.underlying, TOKEN);
    assert.strictEqual(pool.program, wrap.WRAP_PROGRAM);
    const ix = wrap.buildWrapInstruction(pool, OWNER, 1000n);
    assert.strictEqual(ix.accountCount, 9);
    assert.strictEqual(ix.keys.length, 9);
    assert.strictEqual(ix.bump, 254);
    assert.strictEqual(ix.data[0], 1);
    assert.strictEqual(ix.data[ix.data.length - 1], 254);
    assert.strictEqual(ix.keys[0].pubkey, pool.escrow);
    assert.strictEqual(ix.keys[1].pubkey, W2);
    assert.strictEqual(ix.keys[5].isWritable, true);
    assert.strictEqual(ix.keys[6].pubkey, OWNER);
    assert.strictEqual(ix.keys[6].isSigner, true);
    assert.strictEqual(ix.keys[8].pubkey, pool.underlyingProgram);
  });

  await check('wrap compile produces a legacy unsigned tx', () => {
    const pool = wrap.resolvePool(fixtureKinds, W2);
    const built = wrap.compileWrapTransaction(pool, OWNER, 50n, BLOCKHASH, OWNER);
    assert.ok(built.transaction);
    assert.strictEqual(built.wrap.accountCount, 9);
    const raw = Buffer.from(built.transaction, 'base64');
    assert.ok(raw.length > 100);
  });

  await check('ATA and mint-authority PDA match on-chain wrap-nav accounts', () => {
    const ata = solana.getAssociatedTokenAddress(W2, OWNER, solana.TOKEN_2022_PROGRAM);
    assert.strictEqual(ata, '9oYTiFzWtXMnjjXzm4NtKRUaWnLmyaDL2hpHxWkMHkGA');
    const seed = Buffer.from('mint_authority');
    const derived = solana.findProgramAddress([seed, solana.pubkeyBytes(W2)], wrap.WRAP_PROGRAM);
    assert.strictEqual(derived.address, '2SFdjJoRyWfXvXghAjahDgmaZPrAr5WqqCr8KquAtZVM');
    assert.strictEqual(derived.bump, 254);
  });

  await check('encodePayment fills the envelope', () => {
    const b64 = pay.encodePayment({
      x402Version: 1,
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      payload: { transaction: '<replace>' }
    }, 'SIGNEDTX');
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    assert.strictEqual(decoded.payload.transaction, 'SIGNEDTX');
  });

  await check('bundled UI never shows bind / twin / drained homework', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'www/app/index.html'), 'utf8');
    assert.doesNotMatch(html, BIND_RE);
    assert.doesNotMatch(html, /wTOKENx/);
    assert.doesNotMatch(html, DRAIN_RE);
    assert.doesNotMatch(html, /:8402/);
    assert.doesNotMatch(html, /yUSDCx|wLEOSx/);
    const js = fs.readFileSync(path.join(__dirname, '..', 'www/app/app.js'), 'utf8');
    assert.doesNotMatch(js, DRAIN_RE);
    assert.doesNotMatch(js, /:8402/);
    assert.doesNotMatch(js, /wTOKENx|yUSDCx|wLEOSx/);
    assert.match(js, /Wrap enough to send this\?/);
    assert.match(js, /Needs a little SOL for the network fee/);
  });

  await check('shell stays on bundled UI, copyable address, no raw Load failed', () => {
    const shell = fs.readFileSync(path.join(__dirname, '..', 'www/index.html'), 'utf8');
    assert.match(shell, /var GAME_URL\s*=\s*'app\/index\.html'/);
    assert.doesNotMatch(shell, /:8402/);
    assert.match(shell, /user-select:\s*all/);
    assert.match(shell, /toast\('copied'\)/);
    assert.match(shell, /copyToClipboard/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'www/app/pay.js'), 'utf8'), /openzoo\.seeker\.pending402/);
    const errPage = fs.readFileSync(path.join(__dirname, '..', 'www/error.html'), 'utf8');
    assert.doesNotMatch(errPage, /Load failed/i);
    assert.match(errPage, /Reconnecting/);
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'config.xml'), 'utf8');
    assert.match(cfg, /ErrorUrl/);
    assert.match(cfg, /error\.html/);
  });

  await check('depositForShares adds genesis liquidity when empty', () => {
    assert.strictEqual(wrap.depositForShares(10n, 0n, 0n), 1010n);
  });

  console.log('\n' + passed + ' checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
