#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sub = require('../www/app/subscription.js');
const ide = require('../www/app/ide.js');

const ROOT = path.join(__dirname, '..');

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function memStore() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

function jsonRes(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (n) => (headers && headers[String(n).toLowerCase()]) || (n === 'content-type' ? 'application/json' : null)
    },
    json: async () => body,
    body: null
  };
}

const SESSION = {
  id: 'ide_1',
  url: 'https://zoo.openzoo.fun/ide/ide_1',
  password: 's3cret'
};

async function run() {
  await check('subscription paste accepts a key or billing session URL', () => {
    assert.strictEqual(sub.parseSubscriptionPaste('').error, 'empty');
    assert.strictEqual(sub.parseSubscriptionPaste('short').error, 'not a key');
    assert.strictEqual(sub.parseSubscriptionPaste('oz_live_subscription_key_here').key, 'oz_live_subscription_key_here');
    const url = sub.parseSubscriptionPaste('https://zoo.openzoo.fun/billing/done?session=cs_test_abc');
    assert.strictEqual(url.session, 'cs_test_abc');
  });

  await check('saved key is never in the public HUD view', () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_secret_do_not_show', tier: 'basic' });
    const view = sub.subscriptionPublicView();
    assert.strictEqual(view.active, true);
    assert.ok(!JSON.stringify(view).includes('oz_secret_do_not_show'));
    assert.ok(sub.hasSubscriptionKey());
    assert.strictEqual(sub.bearerAuthorization(), 'Bearer oz_secret_do_not_show');
    sub.clearSubscription();
    assert.strictEqual(sub.hasSubscriptionKey(), false);
    sub.setMemoryStore(null);
  });

  await check('no subscription key → no Agent IDE session (client refuses before fetch)', async () => {
    sub.setMemoryStore(memStore());
    let called = 0;
    try {
      await ide.createSession({
        fetch: async () => { called += 1; return jsonRes(200, SESSION); }
      });
      assert.fail('should refuse');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-no-key');
      assert.strictEqual(e.status, 401);
    }
    assert.strictEqual(called, 0, 'must not open a host session without a Bearer');
    sub.setMemoryStore(null);
  });

  await check('dummy gateway Bearer openzoo-seeker is not a subscription key', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'openzoo-seeker' });
    let called = 0;
    try {
      await ide.createSession({
        subscription: sub.loadSubscription(),
        fetch: async () => { called += 1; return jsonRes(200, SESSION); }
      });
      assert.fail('should refuse dummy key');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-no-key');
    }
    assert.strictEqual(called, 0);
    sub.setMemoryStore(null);
  });

  await check('Agent IDE door is zoo.openzoo.fun /api/ide/session', () => {
    assert.strictEqual(ide.IDE_ORIGIN, 'https://zoo.openzoo.fun');
    assert.strictEqual(ide.ROUTES.session, '/api/ide/session');
    assert.strictEqual(ide.SESSION_PATH, '/api/ide/session');
    assert.strictEqual(ide.ideUrl(ide.ROUTES.session), 'https://zoo.openzoo.fun/api/ide/session');
    assert.strictEqual(ide.ROUTES.sessions, undefined);
    assert.strictEqual(ide.ROUTES.messages, undefined);
    const src = read('www/app/ide.js');
    assert.match(src, /['"`]\/api\/ide\/session['"`]/);
    assert.doesNotMatch(src, /['"`]\/ide\/session['"`]/);
    assert.doesNotMatch(src, /['"`]\/occ\//);
    assert.match(src, /Never ANTHROPIC_API_KEY|never ANTHROPIC_API_KEY/);
  });

  await check('POST/GET /api/ide/session send subscription Bearer only', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_live_key_abc', tier: 'basic' });
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url: url, method: (init && init.method) || 'GET', headers: init && init.headers, body: init && init.body });
      if (/\/api\/ide\/session$/.test(url)) return jsonRes(200, SESSION);
      return jsonRes(404, { error: 'not found' });
    };
    const ctx = { subscription: sub.loadSubscription(), fetch: fetchFn };
    const created = await ide.createSession(Object.assign({ threadId: 'thr_1', name: 'openzoo' }, ctx));
    const got = await ide.getSession(ctx);
    assert.strictEqual(created.id, 'ide_1');
    assert.strictEqual(created.url, SESSION.url);
    assert.strictEqual(created.password, 's3cret');
    assert.strictEqual(got.url, SESSION.url);
    assert.ok(calls.length >= 2);
    const post = calls.find((c) => c.method === 'POST');
    const get = calls.find((c) => c.method === 'GET');
    assert.ok(post && get);
    assert.deepStrictEqual(JSON.parse(post.body), { threadId: 'thr_1', name: 'openzoo' });
    calls.forEach((c) => {
      assert.strictEqual(c.headers.authorization, 'Bearer oz_live_key_abc');
      assert.ok(!c.headers.ANTHROPIC_API_KEY);
      assert.ok(!c.headers['x-api-key']);
      assert.ok(!c.headers['x-payment']);
      assert.ok(!c.headers['X-PAYMENT']);
      assert.strictEqual(c.url, 'https://zoo.openzoo.fun/api/ide/session');
    });
    sub.setMemoryStore(null);
  });

  await check('ensureSession GETs first and POSTs when missing', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_live_key_ens' });
    const methods = [];
    const sess = await ide.ensureSession({
      subscription: sub.loadSubscription(),
      threadId: 't1',
      fetch: async (url, init) => {
        methods.push((init && init.method) || 'GET');
        if (methods.length === 1) return jsonRes(404, { error: 'none' });
        return jsonRes(200, SESSION);
      }
    });
    assert.deepStrictEqual(methods, ['GET', 'POST']);
    assert.strictEqual(sess.id, 'ide_1');
    sub.setMemoryStore(null);
  });

  await check('session without url is refused — never an open URL', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_live_key_nourl' });
    try {
      await ide.createSession({
        subscription: sub.loadSubscription(),
        fetch: async () => jsonRes(200, { id: 'ide_x' })
      });
      assert.fail('should refuse missing url');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-no-url');
    }
    try {
      ide.frameSrc({ id: 'x' });
      assert.fail('frameSrc should refuse');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-no-url');
    }
    try {
      ide.parseSession({ id: 'x', url: 'http://open-ide.example/ide' });
      assert.fail('http should refuse');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-open-url');
    }
    const src = ide.frameSrc(SESSION);
    assert.ok(src.indexOf('https://zoo.openzoo.fun/ide/ide_1') === 0);
    assert.ok(src.indexOf('password=s3cret') >= 0);
    sub.setMemoryStore(null);
  });

  await check('401 from the IDE host is unauthorized, not a 402 pay loop', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_dead_key_xxxxxxx' });
    try {
      await ide.createSession({
        subscription: sub.loadSubscription(),
        fetch: async () => jsonRes(401, { error: 'unauthorized' })
      });
      assert.fail('should 401');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-unauthorized');
      assert.strictEqual(e.status, 401);
    }
    sub.setMemoryStore(null);
  });

  await check('/api/ide/session never uses paidFetch (Bearer host gate, not a wallet token)', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_live_key_host' });
    try {
      await ide.createSession({
        subscription: sub.loadSubscription(),
        paidFetch: async () => jsonRes(200, SESSION),
        fetch: async () => jsonRes(200, SESSION)
      });
      assert.fail('should refuse paidFetch');
    } catch (e) {
      assert.strictEqual(e.code, 'ide-no-wallet');
    }
    let fetched = 0;
    const sess = await ide.getSession({
      subscription: sub.loadSubscription(),
      fetch: async (url, init) => {
        fetched += 1;
        assert.strictEqual(init.headers.authorization, 'Bearer oz_live_key_host');
        assert.ok(!init.headers['x-payment']);
        return jsonRes(200, SESSION);
      }
    });
    assert.strictEqual(sess.id, 'ide_1');
    assert.strictEqual(fetched, 1);
    sub.setMemoryStore(null);
  });

  await check('tree never sets ANTHROPIC_API_KEY; x402/MWA stays Chat pay path', () => {
    const files = [
      'www/app/ide.js',
      'www/app/subscription.js',
      'www/app/app.js',
      'www/app/pay.js',
      'www/app/index.html',
      'README.md'
    ];
    files.forEach((rel) => {
      const src = read(rel);
      assert.ok(!/ANTHROPIC_API_KEY\s*=/.test(src), rel + ' assigns ANTHROPIC_API_KEY');
      if (rel.indexOf('ide') >= 0 || rel.indexOf('subscription') >= 0 || rel === 'README.md') {
        assert.ok(/Never ANTHROPIC_API_KEY|never ANTHROPIC_API_KEY|Never `ANTHROPIC_API_KEY`/i.test(src),
          rel + ' should mention the ban');
      }
    });
    const pay = read('www/app/pay.js');
    assert.match(pay, /MWA\.signTransaction|signTransaction/);
    assert.match(pay, /\/v1\/pay\/build/);
    assert.match(pay, /X-PAYMENT/);
    const shell = read('www/index.html');
    assert.match(shell, /cordova-plugin-mwa|MWA\.authorize|wallet-sign-transaction/);
    assert.match(read('www/app/ide.js'), /https:\/\/zoo\.openzoo\.fun/);
    assert.match(read('www/app/ide.js'), /\/api\/ide\/session/);
    assert.doesNotMatch(read('www/app/ide.js'), /['"`]\/ide\/session['"`]/);
    assert.doesNotMatch(read('www/app/ide.js'), /['"`]\/occ\//);
    assert.match(read('www/app/subscription.js'), /zoo\.openzoo\.fun/);
    assert.match(read('www/app/app.js'), /x402-tokens\.fly\.dev/);
    assert.match(read('www/app/pay.js'), /x402-tokens\.fly\.dev/);
  });

  await check('iframe CSP and config allow the IDE door + Chat gateway', () => {
    const need = [
      'https://zoo.openzoo.fun',
      'https://x402-tokens.fly.dev'
    ];
    const iframeCsp = read('www/app/index.html');
    const connect = iframeCsp.match(/connect-src[^"]+/);
    assert.ok(connect, 'iframe CSP connect-src');
    need.forEach((host) => {
      assert.ok(connect[0].indexOf(host) !== -1, 'iframe connect-src missing ' + host);
    });
    const frame = iframeCsp.match(/frame-src[^"]+/);
    assert.ok(frame, 'iframe CSP frame-src for Agent webview');
    assert.ok(/https:/.test(frame[0]), 'frame-src must allow the minted https IDE URL');
    const cfg = read('config.xml');
    need.forEach((host) => {
      assert.ok(cfg.indexOf(host) !== -1, 'config.xml missing ' + host);
    });
    assert.match(cfg, /\/api\/ide\/session/);
  });

  await check('Agent chrome is wired: mode dial, /api/ide/session webview, subscription paste', () => {
    const html = read('www/app/index.html');
    const app = read('www/app/app.js');
    assert.match(html, /id="modeSel"/);
    assert.match(html, /subscription\.js/);
    assert.match(html, /ide\.js/);
    assert.doesNotMatch(html, /occ\.js/);
    assert.match(html, /id="agentFrame"/);
    assert.doesNotMatch(html, /id="ideFrame"/);
    assert.match(html, /data-component="agent-ide"/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /#agentFrame\s*\{[^}]*inset:\s*0/);
    assert.match(html, /body\.agent-ide\s+#bar/);
    assert.match(html, /display:\s*none\s*!important/);
    assert.doesNotMatch(html, /#agentFrame[^}]*max-width:\s*\d/);
    assert.doesNotMatch(html, /letterbox|aspect-ratio:\s*16\s*\/\s*9/i);
    assert.match(app, /\$\('agentFrame'\)/);
    assert.match(app, /OpenZooIde/);
    assert.match(app, /OpenZooSub/);
    assert.match(app, /ide-no-key|hasSubscriptionKey/);
    assert.match(app, /openAgentIde|ensureSession|frameSrc/);
    assert.match(app, /threadId:\s*thread\.id/);
    assert.match(app, /modeSel|runMode|agent/);
    assert.doesNotMatch(app, /ANTHROPIC_API_KEY\s*=/);
    assert.doesNotMatch(app, /OpenZooOcc|occ\.js|\/occ\/sessions/);
    assert.match(read('README.md'), /\/api\/ide\/session/);
    assert.match(read('README.md'), /x402-tokens\.fly\.dev/);
    assert.match(read('README.md'), /subscription Bearer/);
    assert.doesNotMatch(read('README.md'), /`\/occ\/sessions`/);
    assert.ok(!fs.existsSync(path.join(ROOT, 'www/app/occ.js')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'scripts/test-occ.js')));
  });

  console.log('ok  ' + passed + ' ide/subscription checks');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
