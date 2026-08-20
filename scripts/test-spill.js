#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const spill = require('../www/app/spill.js');

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

function turns(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'turn-' + i });
  }
  return out;
}

async function run() {
  await check('short thread without context sends the whole tail and no id', () => {
    const history = turns(3);
    const plan = spill.planChatSpill(history, { memory: null });
    assert.strictEqual(plan.contextId, null);
    assert.strictEqual(plan.bind, false);
    assert.strictEqual(plan.messages.length, 3);
    assert.deepStrictEqual(plan.messages, history);
    const headers = spill.chatHeaders(plan.contextId);
    assert.ok(!headers['x-hrr-context']);
  });

  await check('long thread binds prefix and keeps ~3/N turns', () => {
    const history = turns(131);
    const plan = spill.planChatSpill(history, { memory: null });
    assert.ok(plan.bind);
    assert.ok(plan.corpus.length > 0);
    assert.ok(plan.messages.length <= spill.KEEP_TAIL);
    assert.ok(plan.messages.length < history.length);
    assert.strictEqual(plan.total, 131);
    assert.strictEqual(plan.messages[plan.messages.length - 1].content, 'turn-130');
    assert.match(plan.messages[plan.messages.length - 1].role, /user/);
  });

  await check('context id never travels with the full messages array', () => {
    const history = turns(40);
    const plan = spill.planChatSpill(history, { memory: 'ctx_thread' });
    assert.strictEqual(plan.contextId, 'ctx_thread');
    assert.ok(plan.messages.length < history.length);
    assert.ok(plan.messages.length <= spill.KEEP_TAIL);
    const headers = spill.chatHeaders(plan.contextId);
    assert.strictEqual(headers['x-hrr-context'], 'ctx_thread');
    assert.doesNotThrow(() => spill.assertNoFullDump(headers, plan.messages, history.length));
    assert.throws(
      () => spill.assertNoFullDump(headers, history, history.length),
      /full messages array/
    );
  });

  await check('attached context still sends only the short tail', () => {
    const history = turns(12);
    const plan = spill.planChatSpill(history, { memory: 'ctx_notes' });
    assert.strictEqual(plan.contextId, 'ctx_notes');
    assert.ok(plan.messages.length <= spill.KEEP_TAIL);
    assert.ok(plan.bind);
  });

  await check('append bind sends only the new prefix delta', () => {
    const prior = spill.corpusFromMessages(turns(6).slice(0, 4));
    const next = spill.corpusFromMessages(turns(10).slice(0, 7));
    assert.ok(next.indexOf(prior) === 0);
    const body = spill.nextBindBody({ memory: 'ctx_1', spillCorpus: prior }, next);
    assert.strictEqual(body.append, true);
    assert.strictEqual(body.context_id, 'ctx_1');
    assert.strictEqual(body.corpus, next.slice(prior.length));
    assert.ok(body.corpus.length < next.length);
  });

  await check('HUD savings is directUsd/spentUsd, never a sum of savesVsDirect', () => {
    assert.strictEqual(spill.hudSavingX(0.10, 0.02), 5);
    assert.strictEqual(spill.hudSavingX(0.10, 0), null);
    const acc = spill.noteReceipt(
      { spentUsd: 0, directUsd: 0, calls: 0 },
      { billedUsd: 0.02, directUsd: 0.10, savesVsDirect: 99 }
    );
    assert.strictEqual(acc.spentUsd, 0.02);
    assert.strictEqual(acc.directUsd, 0.10);
    assert.strictEqual(acc.savingX, 5);
    assert.ok(!Object.prototype.hasOwnProperty.call(acc, 'savesVsDirect'));
    const again = spill.noteReceipt(acc, { billedUsd: 0.03, directUsd: 0.15, savesVsDirect: 7 });
    assert.strictEqual(again.spentUsd, 0.05);
    assert.strictEqual(again.directUsd, 0.25);
    assert.strictEqual(again.savingX, 5);
    assert.notStrictEqual(again.savingX, 99 + 7);
    assert.strictEqual(spill.formatSavingX(5), '5.00×');
    assert.strictEqual(spill.formatSavingX(12.34), '12.3×');
  });

  await check('Seeker chat wires spill, keeps x402/MWA, skips SPAWN/worktrees', () => {
    const app = fs.readFileSync(path.join(ROOT, 'www/app/app.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'www/app/index.html'), 'utf8');
    const desktop = fs.readFileSync(path.join(ROOT, 'www/app/gui.desktop.html'), 'utf8');
    assert.match(html, /spill\.js/);
    assert.match(html, /data-component="hud-savings"/);
    assert.match(app, /planChatSpill/);
    assert.match(app, /assertNoFullDump/);
    assert.match(app, /hudSavingX/);
    assert.match(app, /spillPrefix/);
    assert.match(app, /x-hrr-context/);
    assert.match(app, /wallet-sign-transaction/);
    assert.match(app, /OpenZooPay\.paidFetch/);
    assert.doesNotMatch(app, /savesVsDirect/);
    assert.doesNotMatch(app, /SPAWN|worktree/i);
    assert.doesNotMatch(app, /Play Billing|billingClient|com\.android\.vending/i);
    assert.doesNotMatch(desktop, /savesVsDirect/);
    assert.match(desktop, /state\.direct \/ state\.spent/);
  });

  console.log('\n' + passed + ' spill checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
