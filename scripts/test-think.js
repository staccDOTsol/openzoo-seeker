#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const think = require('../www/app/think.js');

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
  await check('complete think / thinking tags leave only the visible answer', () => {
    const a = think.split('<think>plan the steps</think>\nHello');
    assert.strictEqual(a.content.trim(), 'Hello');
    assert.strictEqual(a.reasoning.trim(), 'plan the steps');
    const b = think.split('<thinking>secret</thinking>visible');
    assert.strictEqual(b.content, 'visible');
    assert.strictEqual(b.reasoning, 'secret');
    assert.ok(think.hasReasoning(a.reasoning));
  });

  await check('empty think tags do not count as reasoning', () => {
    const empty = think.split('<think></think>hi');
    assert.strictEqual(empty.content, 'hi');
    assert.strictEqual(empty.reasoning, '');
    assert.strictEqual(think.hasReasoning(empty.reasoning), false);
    assert.strictEqual(think.hasReasoning('   '), false);
    assert.strictEqual(think.hasReasoning(null), false);
  });

  await check('streaming keeps an unclosed think block out of the transcript', () => {
    const stream = think.createStream();
    let snap = stream.pushContent('<thi');
    assert.ok(!/thi/.test(snap.content));
    snap = stream.pushContent('nk>hidden chain');
    assert.strictEqual(snap.content, '');
    assert.strictEqual(snap.reasoning, 'hidden chain');
    snap = stream.pushContent(' of thought</think>Answer');
    assert.strictEqual(snap.content, 'Answer');
    assert.strictEqual(snap.reasoning, 'hidden chain of thought');
    assert.ok(!/hidden/.test(snap.content));
  });

  await check('reasoning_content / reasoning fields are captured without a JSON dump', () => {
    const parsed = think.fromCompletion({
      choices: [{
        message: {
          content: 'done',
          reasoning_content: 'I should add first'
        }
      }]
    });
    assert.strictEqual(parsed.content, 'done');
    assert.strictEqual(parsed.reasoning, 'I should add first');
    assert.strictEqual(think.reasoningFrom({ reasoning: { secret: true } }), '');
    assert.strictEqual(think.reasoningFrom({ reasoning: JSON.stringify({ a: 1 }) }), '');
    assert.strictEqual(think.reasoningFrom({ reasoning: 'plain' }), 'plain');
  });

  await check('field reasoning plus tagged reasoning merge; default stay collapsed', () => {
    const stream = think.createStream();
    stream.pushReasoning('field note');
    stream.pushContent('<think>tag note</think>ok');
    const snap = stream.snapshot();
    assert.strictEqual(snap.content, 'ok');
    assert.match(snap.reasoning, /field note/);
    assert.match(snap.reasoning, /tag note/);
    const msg = think.applyToMessage({ role: 'assistant', content: '' }, snap);
    assert.strictEqual(msg.thinkOpen, false);
    assert.strictEqual(think.LABEL, 'thinking...');
  });

  await check('no-reasoning completion does not keep a chip', () => {
    const msg = think.applyToMessage(
      { role: 'assistant', content: 'old', reasoning: 'stale', thinkOpen: true },
      { content: 'plain', reasoning: '' }
    );
    assert.strictEqual(msg.content, 'plain');
    assert.ok(!msg.reasoning);
    assert.ok(!msg.thinkOpen);
  });

  await check('normalize leftover tags on persisted assistant messages', () => {
    const msg = think.normalizeMessage({
      role: 'assistant',
      content: '<think>old cot</think>saved answer'
    });
    assert.strictEqual(msg.content, 'saved answer');
    assert.strictEqual(msg.reasoning, 'old cot');
    assert.strictEqual(msg.thinkOpen, false);
    const user = think.normalizeMessage({ role: 'user', content: '<think>keep</think>' });
    assert.strictEqual(user.content, '<think>keep</think>');
  });

  await check('Seeker grokui wires a collapsed thinking row and does not dump CoT', () => {
    const app = read('www/app/app.js');
    const html = read('www/app/index.html');
    const desktop = read('www/app/gui.desktop.html');
    assert.match(html, /think\.js/);
    assert.match(html, /think-row|thinking\.\.\./);
    assert.match(app, /OpenZooThink/);
    assert.match(app, /thinkOpen/);
    assert.match(app, /Think\.LABEL|think-row/);
    assert.match(app, /fromCompletion|createStream|normalizeMessage/);
    assert.doesNotMatch(app, /JSON\.stringify\(d\)\.slice/);
    assert.match(desktop, /think\.js|OpenZooThink/);
    assert.match(read('www/app/auto.js'), /openzoo\/auto/);
  });

  await check('thinking UX is not auto-run tools and keeps x402/MWA + Auto', () => {
    const app = read('www/app/app.js');
    const thinkJs = read('www/app/think.js');
    assert.doesNotMatch(thinkJs, /\/mode auto|runMode|auto-run/);
    assert.doesNotMatch(app, /Play Billing|StoreKit|stripe/i);
    assert.match(app, /OpenZooPay\.paidFetch/);
    assert.match(app, /OpenZooAuto/);
    assert.match(app, /wallet-sign-transaction/);
  });

  console.log('\n' + passed + ' think-row checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
