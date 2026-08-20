#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pay = require('../www/app/pay.js');
const copy = require('../www/app/copy.js');
const wrap = require('../www/app/wrap.js');

const ROOT = path.join(__dirname, '..');
const Y = '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv';
const OWNER = 'WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb';
const fixtureKinds = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'supported.json'),
  'utf8'
)).kinds;

function row(asset, amount, symbol) {
  return {
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset,
    maxAmountRequired: String(amount),
    extra: { symbol, decimals: 6, feePayer: OWNER }
  };
}

const live402 = [row(Y, 7018, 'yUSDCx')];
const REQUIRED_CONNECT = [
  'https://x402-tokens.fly.dev',
  'https://x402.accrue.fund',
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com'
];

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

function memoryStore() {
  const s = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
    _raw: s
  };
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function run() {
  await check('humanizeError never leaks Load failed / TypeError', () => {
    const samples = [
      new TypeError('Load failed'),
      new TypeError('Failed to fetch'),
      Object.assign(new Error('Load failed'), { name: 'TypeError' }),
      new Error('Failed to fetch'),
      new Error('net::ERR_INTERNET_DISCONNECTED'),
      'Load failed',
      'TypeError: Failed to fetch'
    ];
    samples.forEach((err) => {
      const msg = pay.humanizeError(err);
      assert.doesNotMatch(msg, /TypeError/i);
      assert.doesNotMatch(msg, /Load failed/i);
      assert.doesNotMatch(msg, /Failed to fetch/i);
      assert.doesNotMatch(msg, /net::/i);
      assert.match(msg, /wallet app|return|reconnect/i);
    });
    assert.ok(pay.isTransientNetworkError(new TypeError('Load failed')));
    assert.ok(pay.isTransientNetworkError(new Error('Failed to fetch')));
    assert.strictEqual(pay.isTransientNetworkError(new Error('insufficient funds')), false);
  });

  await check('persist 402 across an MWA-sized pause', () => {
    const store = memoryStore();
    const ctx = { store };
    pay.savePending402({
      challenge: { accepts: live402 },
      url: 'https://x402-tokens.fly.dev/v1/chat/completions',
      payer: OWNER,
      step: 'build'
    }, ctx);
    const rec = pay.loadPending402(ctx);
    assert.ok(rec);
    assert.strictEqual(rec.step, 'build');
    assert.strictEqual(rec.challenge.accepts[0].asset, Y);
    pay.clearPending402(ctx);
    assert.strictEqual(pay.loadPending402(ctx), null);
  });

  await check('pay/build retries after resume when WebView throws Load failed', async () => {
    const store = memoryStore();
    let payBuildCalls = 0;
    let signed = 0;
    const statuses = [];
    function fakeFetch(url, options) {
      if (String(url).includes('/v1/pay/build')) {
        payBuildCalls += 1;
        if (payBuildCalls === 1) {
          return Promise.reject(new TypeError('Load failed'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            transaction: 'UNSIGNED',
            envelope: {
              x402Version: 1,
              scheme: 'exact',
              network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
              payload: { transaction: '<replace>' }
            }
          })
        });
      }
      if (options && options.headers && options.headers['X-PAYMENT']) {
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({
        status: 402,
        json: async () => ({ accepts: live402 })
      });
    }
    const res = await pay.paidFetch('https://x402-tokens.fly.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }, {
      payer: OWNER,
      fetch: fakeFetch,
      store,
      fetchBalances: async () => ({ [Y]: '100000' }),
      fetchSupported: async () => fixtureKinds,
      signTransaction: async () => { signed += 1; return 'SIGNED'; },
      waitForForeground: async () => {},
      resumeDelayMs: 0,
      maxNetRetries: 5,
      onStatus: (m) => statuses.push(m)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(payBuildCalls, 2);
    assert.strictEqual(signed, 1);
    assert.strictEqual(pay.loadPending402({ store }), null);
    assert.ok(statuses.some((s) => /reconnect/i.test(s)));
  });

  await check('native copy path copies the real address', async () => {
    let captured = '';
    await copy.copyText('SoLAnAaddr1111111111111111111111111111111', {
      nativeCopy: (t) => { captured = t; return true; }
    });
    assert.strictEqual(captured, 'SoLAnAaddr1111111111111111111111111111111');
    let read = '';
    const got = await copy.readText({ nativeRead: () => 'pasted-addr' });
    read = got;
    assert.strictEqual(read, 'pasted-addr');
  });

  await check('CSP connect-src lists gateway, accrue, and Solana RPCs', () => {
    const files = [
      'www/index.html',
      'www/app/index.html',
      'config.xml'
    ];
    files.forEach((rel) => {
      const src = read(rel);
      REQUIRED_CONNECT.forEach((host) => {
        assert.ok(src.indexOf(host) !== -1, rel + ' missing ' + host);
      });
    });
    const iframeCsp = read('www/app/index.html');
    const m = iframeCsp.match(/connect-src[^"]+/);
    assert.ok(m, 'iframe CSP connect-src');
    REQUIRED_CONNECT.forEach((host) => {
      assert.ok(m[0].indexOf(host) !== -1, 'iframe connect-src missing ' + host);
    });
  });

  await check('addresses are selectable and toast says copied', () => {
    const shell = read('www/index.html');
    const app = read('www/app/index.html');
    const appJs = read('www/app/app.js');
    assert.match(shell, /user-select:\s*all/);
    assert.match(app, /user-select:\s*(text|all)/);
    assert.match(appJs, /toast\('copied'\)/);
    assert.match(shell, /toast\('copied'\)/);
    assert.match(appJs, /copyAddress/);
    assert.match(shell, /copyToClipboard|nativeCopy/);
    assert.match(read('cordova-plugin-mwa/src/android/MWAPlugin.java'), /ClipboardManager/);
    assert.match(read('cordova-plugin-mwa/www/mwa.js'), /copyToClipboard/);
  });

  await check('Seeker copy calls it your MWA wallet, not a local burner', () => {
    const html = read('www/app/index.html');
    assert.match(html, /not a local burner/i);
    assert.match(html, /Mobile Wallet Adapter/);
    assert.match(html, /your<\/b> wallet/i);
    assert.doesNotMatch(html, /local burner key on disk/i);
    assert.doesNotMatch(read('www/index.html'), /GAME_URL.*=.*8402/);
    assert.doesNotMatch(read('www/index.html'), /phantom\.app\/ul/i);
    assert.doesNotMatch(read('www/app/app.js'), /phantom\.app\/ul/i);
    assert.doesNotMatch(read('www/app/pay.js'), /:8402/);
  });

  await check('Cordova + MWA stay the pay path', () => {
    const shell = read('www/index.html');
    assert.match(shell, /MWA\.signTransaction/);
    assert.match(shell, /GAME_URL\s*=\s*'app\/index\.html'/);
    assert.doesNotMatch(shell, /GAME_URL\s*=\s*'https:\/\/chat\.openzoo\.fun'/);
    assert.doesNotMatch(shell, /GAME_URL\s*=\s*'[^']*:8402/);
    assert.match(read('www/app/app.js'), /wallet-sign-transaction/);
    assert.match(read('cordova-plugin-mwa/src/android/MWAPlugin.java'), /signTransactions/);
  });

  await check('grokui threads + abstract bind + wTOKENx2 wrap still present', () => {
    const appJs = read('www/app/app.js');
    const html = read('www/app/index.html');
    assert.match(html, /data-page="openzoo-grokui"/);
    assert.match(appJs, /attachQuietly/);
    assert.match(appJs, /\/v1\/hrr\/bind/);
    assert.match(appJs, /planChatSpill/);
    assert.match(html, /spill\.js/);
    assert.doesNotMatch(html, /context_id|bind hash/i);
    assert.strictEqual(wrap.WTOKENX2, 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B');
  });

  await check('chat completions spill the prefix instead of dumping the thread', () => {
    const appJs = read('www/app/app.js');
    const spillJs = read('www/app/spill.js');
    assert.match(spillJs, /KEEP_TAIL = 3/);
    assert.match(spillJs, /x-hrr-context must not travel with the full messages array/);
    assert.match(appJs, /assertNoFullDump/);
    assert.match(appJs, /planned\.messages/);
    assert.doesNotMatch(appJs, /savesVsDirect/);
    assert.match(appJs, /hudSavingX/);
    assert.doesNotMatch(appJs, /SPAWN|worktree/i);
    assert.match(appJs, /OpenZooPay\.paidFetch/);
    assert.match(read('www/index.html'), /MWA\.signTransaction/);
  });

  console.log('\n' + passed + ' copy/x402 checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
