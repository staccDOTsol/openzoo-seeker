#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sub = require('../www/app/subscription.js');
const occ = require('../www/app/occ.js');

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

  await check('no subscription key → no Agent session (client refuses before fetch)', async () => {
    sub.setMemoryStore(memStore());
    let called = 0;
    try {
      await occ.createSession({
        fetch: async () => { called += 1; return jsonRes(200, { id: 's1' }); }
      });
      assert.fail('should refuse');
    } catch (e) {
      assert.strictEqual(e.code, 'occ-no-key');
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
      await occ.createSession({
        subscription: sub.loadSubscription(),
        fetch: async () => { called += 1; return jsonRes(200, { id: 's1' }); }
      });
      assert.fail('should refuse dummy key');
    } catch (e) {
      assert.strictEqual(e.code, 'occ-no-key');
    }
    assert.strictEqual(called, 0);
    sub.setMemoryStore(null);
  });

  await check('hosted OCC routes live on openzoo.fun /api/occ', () => {
    assert.strictEqual(occ.OCC_ORIGIN, 'https://openzoo.fun');
    assert.strictEqual(occ.ROUTES.sessions, '/api/occ/sessions');
    assert.strictEqual(occ.ROUTES.session('abc'), '/api/occ/sessions/abc');
    assert.strictEqual(occ.ROUTES.messages('abc'), '/api/occ/sessions/abc/messages');
    assert.strictEqual(occ.ROUTES.goal('abc'), '/api/occ/sessions/abc/goal');
    assert.strictEqual(occ.ROUTES.files('abc', 'src/app.js'), '/api/occ/sessions/abc/files?path=src/app.js');
    assert.strictEqual(occ.ROUTES.stream('abc'), '/api/occ/sessions/abc/stream');
    assert.strictEqual(occ.ROUTES.stop('abc'), '/api/occ/sessions/abc/stop');
    assert.strictEqual(occ.occUrl(occ.ROUTES.sessions), 'https://openzoo.fun/api/occ/sessions');
    assert.ok(occ.isGoalText('/goal ship the site'));
    assert.strictEqual(occ.goalText('/goal ship the site'), 'ship the site');
    assert.ok(!occ.isGoalText('please /goal later'));
  });

  await check('createSession / message / goal / upload send subscription Bearer only', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_live_key_abc', tier: 'basic' });
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url: url, method: (init && init.method) || 'GET', headers: init && init.headers, body: init && init.body });
      if (/\/sessions$/.test(url) && init.method === 'POST') return jsonRes(200, { id: 'sess_1', cwd: '/workspace' });
      if (/\/files/.test(url)) return jsonRes(200, { path: 'notes.txt', cwd: '/workspace', wrote: ['notes.txt'] });
      if (/\/goal/.test(url)) return jsonRes(200, { text: 'goal set' });
      if (/\/messages/.test(url)) return jsonRes(200, { text: 'hello from occ' });
      return jsonRes(404, { error: 'not found' });
    };
    const ctx = { subscription: sub.loadSubscription(), fetch: fetchFn };
    const sess = await occ.createSession(ctx);
    assert.strictEqual(sess.id, 'sess_1');
    assert.strictEqual(sess.cwd, '/workspace');
    await occ.uploadFile('sess_1', { name: 'notes.txt', content: 'hi' }, ctx);
    const goal = await occ.sendGoal('sess_1', '/goal finish the PR', ctx);
    const msg = await occ.sendMessage('sess_1', 'what files are here?', ctx);
    assert.strictEqual(goal.text, 'goal set');
    assert.strictEqual(msg.text, 'hello from occ');
    assert.ok(calls.length >= 4);
    calls.forEach((c) => {
      assert.strictEqual(c.headers.authorization, 'Bearer oz_live_key_abc');
      assert.ok(!c.headers.ANTHROPIC_API_KEY);
      assert.ok(!c.headers['x-api-key']);
      assert.ok(c.url.indexOf('https://openzoo.fun/api/occ/') === 0);
    });
    assert.ok(calls.some((c) => c.url.indexOf('/files?path=notes.txt') >= 0 && c.method === 'PUT'));
    assert.ok(calls.some((c) => c.url.indexOf('/goal') >= 0 && c.method === 'POST'));
    assert.ok(calls.some((c) => c.url.indexOf('/messages') >= 0 && c.method === 'POST'));
    sub.setMemoryStore(null);
  });

  await check('401 from the OCC host is unauthorized, not a 402 pay loop', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_dead_key_xxxxxxx' });
    try {
      await occ.createSession({
        subscription: sub.loadSubscription(),
        fetch: async () => jsonRes(401, { error: 'unauthorized' })
      });
      assert.fail('should 401');
    } catch (e) {
      assert.strictEqual(e.code, 'occ-unauthorized');
      assert.strictEqual(e.status, 401);
    }
    sub.setMemoryStore(null);
  });

  await check('OCC message path can settle inference 402 via paidFetch', async () => {
    sub.setMemoryStore(memStore());
    sub.saveSubscription({ key: 'oz_live_key_pay' });
    let paid = 0;
    const res = await occ.sendMessage('sess_pay', 'hi', {
      subscription: sub.loadSubscription(),
      paidFetch: async (url, init) => {
        paid += 1;
        assert.strictEqual(init.headers.authorization, 'Bearer oz_live_key_pay');
        assert.ok(url.indexOf('/messages') >= 0);
        return jsonRes(200, { text: 'paid turn' });
      },
      payCtx: { payer: 'Test111' }
    });
    assert.strictEqual(res.text, 'paid turn');
    assert.strictEqual(paid, 1);
    sub.setMemoryStore(null);
  });

  await check('tree never sets ANTHROPIC_API_KEY; x402/MWA pay path stays', () => {
    const files = [
      'www/app/occ.js',
      'www/app/subscription.js',
      'www/app/app.js',
      'www/app/pay.js',
      'www/app/index.html',
      'README.md'
    ];
    files.forEach((rel) => {
      const src = read(rel);
      assert.ok(!/ANTHROPIC_API_KEY\s*=/.test(src), rel + ' assigns ANTHROPIC_API_KEY');
      if (rel.indexOf('occ') >= 0 || rel.indexOf('subscription') >= 0 || rel === 'README.md') {
        assert.ok(/Never ANTHROPIC_API_KEY|never ANTHROPIC_API_KEY|Never `ANTHROPIC_API_KEY`/i.test(src)
          || rel === 'www/app/app.js', rel + ' should mention the ban');
      }
    });
    const pay = read('www/app/pay.js');
    assert.match(pay, /MWA\.signTransaction|signTransaction/);
    assert.match(pay, /\/v1\/pay\/build/);
    assert.match(pay, /X-PAYMENT/);
    const shell = read('www/index.html');
    assert.match(shell, /cordova-plugin-mwa|MWA\.authorize|wallet-sign-transaction/);
    assert.match(read('www/app/occ.js'), /https:\/\/openzoo\.fun/);
    assert.match(read('www/app/subscription.js'), /zoo\.openzoo\.fun/);
  });

  await check('iframe CSP and config allow the OCC door + billing origin', () => {
    const need = [
      'https://openzoo.fun',
      'https://zoo.openzoo.fun',
      'https://x402-tokens.fly.dev'
    ];
    const iframeCsp = read('www/app/index.html');
    const m = iframeCsp.match(/connect-src[^"]+/);
    assert.ok(m, 'iframe CSP connect-src');
    need.forEach((host) => {
      assert.ok(m[0].indexOf(host) !== -1, 'iframe connect-src missing ' + host);
    });
    const cfg = read('config.xml');
    need.forEach((host) => {
      assert.ok(cfg.indexOf(host) !== -1, 'config.xml missing ' + host);
    });
  });

  await check('Agent chrome is wired: mode dial, /goal, upload, subscription paste', () => {
    const html = read('www/app/index.html');
    const app = read('www/app/app.js');
    assert.match(html, /id="modeSel"/);
    assert.match(html, /subscription\.js/);
    assert.match(html, /occ\.js/);
    assert.match(html, /goalTip|\/goal/);
    assert.match(app, /OpenZooOcc/);
    assert.match(app, /OpenZooSub/);
    assert.match(app, /occ-no-key|hasSubscriptionKey/);
    assert.match(app, /uploadFiles|uploadFile/);
    assert.match(app, /sendGoal|isGoalText/);
    assert.match(app, /modeSel|runMode|agent/);
    assert.doesNotMatch(app, /ANTHROPIC_API_KEY\s*=/);
    assert.match(read('README.md'), /\/api\/occ\/sessions/);
  });

  console.log('ok  ' + passed + ' occ/subscription checks');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
