#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auto = require('../www/app/auto.js');

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

async function run() {
  await check('unpinned / empty / Auto all send openzoo/auto', () => {
    assert.strictEqual(auto.AUTO_MODEL, 'openzoo/auto');
    assert.strictEqual(auto.sendModel(null), 'openzoo/auto');
    assert.strictEqual(auto.sendModel(undefined), 'openzoo/auto');
    assert.strictEqual(auto.sendModel(''), 'openzoo/auto');
    assert.strictEqual(auto.sendModel('openzoo/auto'), 'openzoo/auto');
    assert.strictEqual(auto.sendModel('  openzoo/auto  '), 'openzoo/auto');
    assert.ok(auto.isAuto(null));
    assert.ok(auto.isAuto('openzoo/auto'));
    assert.ok(!auto.isPinned('openzoo/auto'));
  });

  await check('picker can pin a real catalog model', () => {
    assert.strictEqual(auto.sendModel('google/gemini-3.7-flash'), 'google/gemini-3.7-flash');
    assert.strictEqual(auto.sendModel('x-ai/grok-4.6'), 'x-ai/grok-4.6');
    assert.ok(auto.isPinned('deepseek/deepseek-v4-pro-0813'));
    assert.ok(!auto.isAuto('deepseek/deepseek-v4-pro-0813'));
  });

  await check('catalog always leads with Auto and does not duplicate it', () => {
    const withAuto = auto.catalogWithAuto([
      { id: 'openzoo/auto' },
      { id: 'google/gemini-3.7-flash' },
      { id: '~hidden' }
    ]);
    assert.strictEqual(withAuto[0].id, 'openzoo/auto');
    assert.strictEqual(withAuto.filter((m) => m.id === 'openzoo/auto').length, 1);
    assert.ok(withAuto.some((m) => m.id === 'google/gemini-3.7-flash'));
    assert.strictEqual(auto.pickerLabel('openzoo/auto'), '🎯 Auto');
    assert.ok(!/auto-run|\/mode auto/i.test(auto.pickerLabel('openzoo/auto')));
  });

  await check('routed model is a compact id, never a JSON dump', () => {
    assert.strictEqual(
      auto.compactRoutedModel({ model: 'deepseek/deepseek-v4-flash' }),
      'deepseek/deepseek-v4-flash'
    );
    assert.strictEqual(
      auto.compactRoutedModel({ model: 'openzoo/auto' }),
      ''
    );
    assert.strictEqual(
      auto.compactRoutedModel({ x402: { model: 'x-ai/grok-4.6', billedUsd: 0.01 } }),
      'x-ai/grok-4.6'
    );
    assert.strictEqual(
      auto.compactRoutedModel({ model: { id: 'google/gemini-3.7-flash' } }),
      ''
    );
    assert.strictEqual(
      auto.compactRoutedModel({ model: JSON.stringify({ model: 'x-ai/grok-4.6' }) }),
      ''
    );
    assert.strictEqual(
      auto.compactRoutedModel({ model: '[{"tool":"dump"}]' }),
      ''
    );
    assert.strictEqual(auto.compactRoutedModel(null), '');
    assert.strictEqual(auto.compactRoutedModel('google/gemini-3.7-flash'), '');
    assert.strictEqual(
      auto.displayRouted({ model: 'openzoo/auto' }, 'openzoo/auto'),
      ''
    );
    assert.strictEqual(
      auto.displayRouted({}, 'google/gemini-3.7-flash'),
      'google/gemini-3.7-flash'
    );
    assert.strictEqual(
      auto.displayRouted({ model: 'x-ai/grok-4.3' }, 'openzoo/auto'),
      'x-ai/grok-4.3'
    );
  });

  await check('Auto uses the reasoning token floor; pin keeps the existing heuristic', () => {
    assert.strictEqual(auto.reasoningMaxTokens('openzoo/auto'), 16384);
    assert.strictEqual(auto.reasoningMaxTokens(null), 16384);
    assert.strictEqual(auto.reasoningMaxTokens('google/gemini-3.7-flash'), 4096);
    assert.strictEqual(auto.reasoningMaxTokens('deepseek/deepseek-v4-pro'), 16384);
  });

  await check('Seeker grokui defaults to Auto and shows the routed id', () => {
    const app = read('www/app/app.js');
    const html = read('www/app/index.html');
    assert.match(html, /auto\.js/);
    assert.match(html, /data-component="model-picker"/);
    assert.match(app, /OpenZooAuto/);
    assert.match(app, /sendModel/);
    assert.match(app, /catalogWithAuto/);
    assert.match(app, /displayRouted/);
    assert.match(app, /AUTO_MODEL|openzoo\/auto/);
    assert.match(app, /saved && saved\.model/);
    assert.doesNotMatch(app, /want = \(saved && saved\.model\) \|\| 'google\/gemini-3\.7-flash'/);
    assert.match(app, /model:\s*model/);
    assert.doesNotMatch(app, /SCORE this prompt|cheapest model that can|classifyTask|routeAuto\(/);
    assert.doesNotMatch(app, /runMode\s*=\s*'auto'|\/mode auto/);
    assert.doesNotMatch(app, /tool_calls|tool-use dump|function_call/);
  });

  await check('desktop gui in this shell also defaults to Auto', () => {
    const desktop = read('www/app/gui.desktop.html');
    assert.match(desktop, /auto\.js|OpenZooAuto|openzoo\/auto/);
    assert.match(desktop, /data-component="model-picker"/);
    assert.doesNotMatch(desktop, /deepseek-v4-pro/);
    assert.doesNotMatch(desktop, /JSON\.stringify\(d\)\.slice/);
  });

  await check('pay paths stay: x402/MWA on, no Stripe, no store IAP', () => {
    const app = read('www/app/app.js');
    const html = read('www/app/index.html');
    const pay = read('www/app/pay.js');
    const shell = read('www/index.html');
    const autoJs = read('www/app/auto.js');
    assert.match(app, /OpenZooPay\.paidFetch/);
    assert.match(app, /wallet-sign-transaction/);
    assert.match(pay, /X-PAYMENT/);
    assert.match(pay, /signTransaction/);
    assert.match(shell, /MWA\.signTransaction/);
    assert.doesNotMatch(app, /Play Billing|billingClient|StoreKit|SKPayment|stripe|pk_live/i);
    assert.doesNotMatch(html, /Play Billing|StoreKit|stripe/i);
    assert.doesNotMatch(autoJs, /Play Billing|StoreKit|stripe|X-PAYMENT/);
    assert.doesNotMatch(autoJs, /function classify|routeAuto\(|SCORE this prompt/);
  });

  await check('Auto is the gateway classifier — no local /route shortlist', () => {
    const app = read('www/app/app.js');
    const html = read('www/app/index.html');
    const autoJs = read('www/app/auto.js');
    const desktop = read('www/app/gui.desktop.html');
    assert.strictEqual(typeof auto.shortlist, 'undefined');
    assert.doesNotMatch(autoJs, /function shortlist/);
    assert.doesNotMatch(autoJs, /127\.0\.0\.1:8402/);
    assert.doesNotMatch(autoJs, /\/v1\/route/);
    assert.doesNotMatch(app, /127\.0\.0\.1:8402/);
    assert.doesNotMatch(app, /\/v1\/route/);
    assert.doesNotMatch(app, /Auto\.shortlist|models = picked/);
    assert.match(app, /spend\.race >= 2 && !\(Auto && Auto\.isAuto\(pinnedModel\(\)\)\)/);
    assert.match(app, /model:\s*model/);
    assert.match(html, /Auto lets the door pick/);
    assert.doesNotMatch(html, /sidecar pick/);
    assert.match(desktop, /Auto lets the door pick/);
    assert.doesNotMatch(desktop, /sidecar pick/);
    assert.doesNotMatch(autoJs, /sidecar \(desktop\/npx|sidecar routing/);
  });

  console.log('\n' + passed + ' auto-model checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
