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
  await check('virtual id is openzoo/auto', () => {
    assert.strictEqual(auto.AUTO_MODEL, 'openzoo/auto');
    assert.ok(auto.isAuto('openzoo/auto'));
    assert.ok(auto.isAuto('  openzoo/auto  '));
    assert.ok(!auto.isAuto('google/gemini-3.7-flash'));
    assert.ok(!auto.isAuto('openrouter/auto'));
  });

  await check('unpinned resolveSendModel is openzoo/auto', () => {
    assert.strictEqual(auto.resolveSendModel('', ''), 'openzoo/auto');
    assert.strictEqual(auto.resolveSendModel(null, null), 'openzoo/auto');
    assert.strictEqual(auto.resolveSendModel('openzoo/auto', ''), 'openzoo/auto');
    assert.strictEqual(auto.resolveSendModel('', 'openzoo/auto'), 'openzoo/auto');
  });

  await check('picker can pin a real model', () => {
    assert.ok(auto.isPinned('google/gemini-3.7-flash'));
    assert.ok(!auto.isPinned('openzoo/auto'));
    assert.ok(!auto.isPinned(''));
    assert.strictEqual(auto.resolveSendModel('x-ai/grok-4.6', 'openzoo/auto'), 'x-ai/grok-4.6');
    assert.strictEqual(auto.resolveSendModel('', 'deepseek/deepseek-v4-flash'), 'deepseek/deepseek-v4-flash');
  });

  await check('Auto is not a race and race needs a pinned model', () => {
    assert.strictEqual(auto.shouldRace(4, 'openzoo/auto'), false);
    assert.strictEqual(auto.shouldRace(0, 'google/gemini-3.7-flash'), false);
    assert.strictEqual(auto.shouldRace(4, 'google/gemini-3.7-flash'), true);
  });

  await check('routed model is a compact id, never a JSON dump', () => {
    assert.strictEqual(auto.routedModelId({ model: 'google/gemini-3.7-flash' }, 'openzoo/auto'), 'google/gemini-3.7-flash');
    assert.strictEqual(auto.routedModelId({ model: 'openzoo/auto', x402: { model: 'x-ai/grok-4.6' } }, 'openzoo/auto'), 'x-ai/grok-4.6');
    assert.strictEqual(auto.compactModelId({ model: 'nope' }), '');
    assert.strictEqual(auto.compactModelId('{"model":"x"}'), '');
    assert.strictEqual(auto.routedModelId({ model: { id: 'nested' } }, 'openzoo/auto'), '');
    assert.strictEqual(auto.routedModelId(JSON.parse('{"model":{"foo":1}}'), 'openzoo/auto'), '');
    assert.doesNotMatch(auto.routedModelId({ model: { a: 1 } }, 'openzoo/auto'), /\{/);
  });

  await check('catalog always leads with Auto', () => {
    const merged = auto.mergeCatalog([
      { id: 'google/gemini-3.7-flash' },
      { id: 'openzoo/auto' }
    ]);
    assert.strictEqual(merged[0].id, 'openzoo/auto');
    assert.strictEqual(merged.filter((m) => m.id === 'openzoo/auto').length, 1);
    assert.ok(merged.some((m) => m.id === 'google/gemini-3.7-flash'));
    assert.strictEqual(auto.formatPickerLabel('openzoo/auto'), '🦓 Auto');
  });

  await check('Seeker grokui wires Auto on completions and keeps x402/MWA', () => {
    const app = read('www/app/app.js');
    const html = read('www/app/index.html');
    const desktop = read('www/app/gui.desktop.html');
    assert.match(html, /auto\.js/);
    assert.match(html, /value="openzoo\/auto"/);
    assert.match(html, /data-component="model-picker"/);
    assert.match(app, /OpenZooAuto/);
    assert.match(app, /selectedModel/);
    assert.match(app, /resolveSendModel/);
    assert.match(app, /shouldRace/);
    assert.match(app, /routedModelId/);
    assert.match(app, /openzoo\/auto/);
    assert.match(app, /OpenZooPay\.paidFetch/);
    assert.match(app, /wallet-sign-transaction/);
    assert.match(app, /X-PAYMENT|paidFetch/);
    assert.doesNotMatch(app, /Play Billing|billingClient|com\.android\.vending/i);
    assert.doesNotMatch(app, /Stripe|sk_live|checkout\.stripe/i);
    assert.doesNotMatch(html, /Play Billing/i);
    assert.doesNotMatch(app, /auto-run tools/i);
    assert.doesNotMatch(app, /task.?classif|difficulty.?score/i);
    assert.match(desktop, /auto\.js/);
    assert.match(desktop, /openzoo\/auto/);
    assert.match(desktop, /selectedModel/);
    assert.match(desktop, /routedModelId/);
  });

  await check('chat canvas still paints message content, not tool dumps', () => {
    const app = read('www/app/app.js');
    assert.match(app, /ch\.message && ch\.message\.content/);
    assert.match(app, /bubble\.textContent = m\.content/);
    assert.match(app, /meta\.className = 'meta'/);
    assert.doesNotMatch(app, /tool_calls|tool_use|function_call/);
  });

  console.log('\n' + passed + ' auto checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
