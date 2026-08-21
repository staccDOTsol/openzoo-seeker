#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const race = require('../www/app/race.js');

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scriptedStream(spec) {
  return async function stream(_messages, onDelta, _ctx, model) {
    const s = spec[model];
    if (!s) throw new Error('unexpected model ' + model);
    if (s.err) {
      await sleep(s.at || 0);
      throw s.err;
    }
    const chunks = s.chunks || (s.text ? [s.text] : []);
    const start = Date.now();
    const tokenAt = s.tokenAt != null ? s.tokenAt : Math.max(0, (s.at || 0) - 20);
    await sleep(tokenAt);
    for (const c of chunks) onDelta(c);
    const left = Math.max(0, (s.at || 0) - (Date.now() - start));
    await sleep(left);
    return s.empty ? '' : (s.text ?? chunks.join(''));
  };
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function run() {
  await check('default race is first 2 of 4', () => {
    assert.strictEqual(race.DEFAULT_NEED, 2);
    assert.strictEqual(race.DEFAULT_N, 4);
    const parsed = race.parseRaceValue('2 4');
    assert.strictEqual(parsed.race, 4);
    assert.strictEqual(parsed.raceNeed, 2);
    assert.strictEqual(race.raceSelectValue(4, 2), '2 4');
    assert.strictEqual(race.parseRaceValue('2').raceNeed, 1);
    assert.strictEqual(race.parseRaceValue('0').race, 0);
  });

  await check('tiers include cheap / medium / expensive / grok4.6', () => {
    assert.deepStrictEqual(race.TIER_NAMES, ['cheap', 'medium', 'expensive', 'grok4.6']);
    assert.deepStrictEqual(race.TIERS['grok4.6'], [
      'x-ai/grok-4.6',
      'x-ai/grok-4.5',
      'x-ai/grok-4.3',
      'x-ai/grok-4.20'
    ]);
    const picks = race.tierModels('grok4.6', 4, false);
    assert.strictEqual(picks.length, 4);
    assert.ok(picks.includes('x-ai/grok-4.6'));
  });

  await check('empty / HTTP / pay / fetch-failed are not countable', () => {
    assert.strictEqual(race.isRaceCountable(''), false);
    assert.strictEqual(race.isRaceCountable('fetch failed'), false);
    assert.strictEqual(race.isRaceCountable('TypeError: fetch failed'), false);
    assert.strictEqual(race.isRaceCountable('(upstream error — HTTP 503, try again)'), false);
    assert.strictEqual(race.isRaceCountable('(payment failed)'), false);
    assert.strictEqual(race.isRaceCountable({ text: 'ok', error: 'HTTP 502' }), false);
    assert.strictEqual(race.isRaceCountable({ text: 'real answer' }), true);
    assert.strictEqual(race.raceLastShip([
      { model: 'a', text: '', error: 'fetch failed' }
    ]).text, race.RACE_EVERY_FAILED);
    assert.ok(race.raceLastShip([{ model: 'a', text: '', error: 'fetch failed' }]).error);
  });

  await check('race forwards onDelta before a winner exists', async () => {
    let resolved = false;
    const deltas = [];
    const p = race.brainRace(
      [{ role: 'user', content: 'q' }],
      (d) => { if (!resolved && d) deltas.push(d); },
      null,
      ['fast', 'slow'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          fast: { chunks: ['Hel', 'lo'], text: 'Hello', at: 40, tokenAt: 5 },
          slow: { chunks: ['Bye'], text: 'Bye', at: 80, tokenAt: 60 }
        }),
        classify: async (_m, c) => (c.model === 'slow' ? 9 : 3)
      }
    );
    await sleep(20);
    assert.ok(deltas.length > 0, 'tokens must land before both racers finish');
    assert.ok(deltas.join('').includes('Hel'));
    const text = await p;
    resolved = true;
    assert.strictEqual(text, 'Bye');
  });

  await check('status updates as racers finish: racing n/X back…', async () => {
    const statuses = [];
    await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['a', 'b', 'c'],
      2,
      undefined,
      (s) => statuses.push(s),
      {
        stream: scriptedStream({
          a: { text: 'one', at: 15 },
          b: { text: 'two', at: 35 },
          c: { text: 'three', at: 200 }
        }),
        classify: async (_m, c) => (c.model === 'b' ? 9 : 7)
      }
    );
    assert.ok(statuses.includes('racing 0/2 back…'));
    assert.ok(statuses.includes('racing 1/2 back…'));
    assert.ok(statuses.includes('racing 2/2 back…'));
    assert.strictEqual(statuses.filter((s) => s === 'racing 3/2 back…').length, 0);
  });

  await check('first two non-empty back are the only ones classified; a slow 3rd does not enter', async () => {
    const classified = [];
    let cStarted = false;
    const t0 = Date.now();
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['empty', 'a', 'b', 'c'],
      2,
      undefined,
      () => {},
      {
        stream: async (_messages, onDelta, _ctx, model) => {
          if (model === 'empty') {
            await sleep(5);
            return '';
          }
          if (model === 'a') {
            await sleep(15);
            onDelta('first');
            return 'first';
          }
          if (model === 'b') {
            await sleep(30);
            onDelta('second');
            return 'second';
          }
          cStarted = true;
          await sleep(250);
          onDelta('third');
          return 'third-should-not-win';
        },
        classify: async (_m, c) => {
          classified.push(c.model);
          return c.model === 'b' ? 9 : 8;
        }
      }
    );
    assert.deepStrictEqual(classified.slice().sort(), ['a', 'b']);
    assert.strictEqual(text, 'second');
    assert.ok(cStarted, 'the 3rd is still paid for / launched');
    assert.ok(Date.now() - t0 < 150, 'must ship when X are in, not wait for N');
  });

  await check('a low-score first-back does not win just by being fast', async () => {
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['fast', 'good'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          fast: { text: 'meh', at: 10 },
          good: { text: 'solid', at: 25 }
        }),
        classify: async (_m, c) => (c.model === 'fast' ? 2 : 9)
      }
    );
    assert.strictEqual(text, 'solid');
  });

  await check('zero-pass classifier still ships the last of the X', async () => {
    const classified = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['a', 'b', 'c'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          a: { text: 'first-back', at: 10 },
          b: { text: 'last-of-x', at: 25 },
          c: { text: 'late-high', at: 200 }
        }),
        classify: async (_m, c) => {
          classified.push(c.text);
          return 1;
        },
        minScore: 6
      }
    );
    assert.deepStrictEqual(classified.slice().sort(), ['first-back', 'last-of-x']);
    assert.strictEqual(text, 'last-of-x');
  });

  await check('if X never fills, one race-level error — not the last model name', async () => {
    const deltas = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      (d) => deltas.push(d),
      null,
      ['boom', 'blank', 'last'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          boom: { err: new Error('HTTP 502'), at: 5 },
          blank: { empty: true, text: '', at: 15 },
          last: { text: '(upstream error — HTTP 503, try again)', at: 30 }
        }),
        classify: async () => { throw new Error('classify must not run when X never fills'); }
      }
    );
    assert.strictEqual(text, '(race: every model failed — no reply)');
    assert.doesNotMatch(text, /boom|blank|last failed|HTTP 503/);
    assert.ok(deltas.some((d) => String(d).includes('every model failed')));
  });

  await check('if everyone errors with no text, surface a race-level error', async () => {
    const t0 = Date.now();
    const deltas = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      (d) => { if (d) deltas.push(d); },
      null,
      ['a', 'b'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          a: { err: new Error('5xx'), at: 8 },
          b: { empty: true, text: '', at: 20 }
        })
      }
    );
    assert.ok(Date.now() - t0 < 100, 'must not wait for a K that will never come');
    assert.strictEqual(text, '(race: every model failed — no reply)');
    assert.ok(deltas.some((d) => /every model failed/i.test(d)));
  });

  await check('fetch-failed racer is dropped; two real answers still classify', async () => {
    const classified = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      [
        'mistralai/mistral-large-2512',
        'bytedance-seed/seed-2.0-code',
        'deepseek/deepseek-v4-pro-0813',
        'z-ai/glm-4.7'
      ],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          'mistralai/mistral-large-2512': {
            err: Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }),
            at: 5
          },
          'bytedance-seed/seed-2.0-code': { text: 'real-seed-answer', at: 25 },
          'deepseek/deepseek-v4-pro-0813': { text: 'real-deepseek-answer', at: 40 },
          'z-ai/glm-4.7': { text: 'late-should-not-enter', at: 200 }
        }),
        classify: async (_m, c) => {
          classified.push(c.text);
          return c.text === 'real-deepseek-answer' ? 9 : 7;
        }
      }
    );
    assert.strictEqual(text, 'real-deepseek-answer');
    assert.doesNotMatch(text, /failed: fetch failed/);
    assert.doesNotMatch(text, /mistral-large-2512|seed-2.0-code failed/);
    assert.deepStrictEqual(classified.slice().sort(), ['real-deepseek-answer', 'real-seed-answer']);
  });

  await check('resolved fetch-failed text is not countable toward X', async () => {
    const classified = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      [
        'mistralai/mistral-large-2512',
        'bytedance-seed/seed-2.0-code',
        'deepseek/deepseek-v4-pro-0813',
        'z-ai/glm-4.7'
      ],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          'mistralai/mistral-large-2512': { text: 'fetch failed', at: 5 },
          'bytedance-seed/seed-2.0-code': { empty: true, text: '', at: 8 },
          'deepseek/deepseek-v4-pro-0813': { text: 'ok-one', at: 25 },
          'z-ai/glm-4.7': { text: 'ok-two', at: 40 }
        }),
        classify: async (_m, c) => {
          classified.push(c.text);
          return c.text === 'ok-two' ? 9 : 7;
        }
      }
    );
    assert.strictEqual(text, 'ok-two');
    assert.doesNotMatch(text, /failed: fetch failed|fetch failed/);
    assert.deepStrictEqual(classified.slice().sort(), ['ok-one', 'ok-two']);
  });

  await check('every racer fetch-failed → race-level failure, not a model name', async () => {
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      [
        'mistralai/mistral-large-2512',
        'bytedance-seed/seed-2.0-code',
        'deepseek/deepseek-v4-pro-0813',
        'z-ai/glm-4.7'
      ],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          'mistralai/mistral-large-2512': { err: new TypeError('fetch failed'), at: 4 },
          'bytedance-seed/seed-2.0-code': { err: new TypeError('fetch failed'), at: 8 },
          'deepseek/deepseek-v4-pro-0813': { err: new TypeError('fetch failed'), at: 12 },
          'z-ai/glm-4.7': { err: new TypeError('fetch failed'), at: 16 }
        }),
        classify: async () => { throw new Error('classify must not run when every racer failed'); }
      }
    );
    assert.strictEqual(text, '(race: every model failed — no reply)');
    assert.doesNotMatch(text, /mistral-large-2512|seed-2.0-code|deepseek|glm-4\.7/);
    assert.doesNotMatch(text, /failed: fetch failed/);
  });

  await check('malformed judge / equally bad scores ship the last finished candidate', async () => {
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['a', 'b'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          a: { text: 'first', at: 10 },
          b: { text: 'last-finished', at: 25 }
        }),
        classify: async () => 8,
        pairwise: async () => ({ text: '' })
      }
    );
    assert.strictEqual(text, 'last-finished');
  });

  await check('empty/5xx do not count toward X', async () => {
    const classified = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['boom', 'blank', 'real1', 'real2'],
      2,
      undefined,
      () => {},
      {
        stream: scriptedStream({
          boom: { err: new Error('5xx'), at: 5 },
          blank: { empty: true, text: '', at: 8 },
          real1: { text: 'ok-one', at: 20 },
          real2: { text: 'ok-two', at: 35 }
        }),
        classify: async (_m, c) => {
          classified.push(c.text);
          return c.text === 'ok-two' ? 9 : 7;
        }
      }
    );
    assert.deepStrictEqual(classified.slice().sort(), ['ok-one', 'ok-two']);
    assert.strictEqual(text, 'ok-two');
  });

  await check('fetch-failed racer is retried once and can still fill X', async () => {
    const tries = {};
    const classified = [];
    const text = await race.brainRace(
      [{ role: 'user', content: 'q' }],
      () => {},
      null,
      ['flaky', 'good'],
      2,
      undefined,
      () => {},
      {
        stream: async (_messages, onDelta, _ctx, model) => {
          tries[model] = (tries[model] || 0) + 1;
          if (model === 'flaky' && tries[model] === 1) {
            await sleep(5);
            throw new TypeError('fetch failed');
          }
          await sleep(10);
          onDelta(model + '-ok');
          return model + '-ok';
        },
        classify: async (_m, c) => {
          classified.push(c.model);
          return c.model === 'flaky' ? 9 : 7;
        }
      }
    );
    assert.strictEqual(tries.flaky, 2);
    assert.strictEqual(tries.good, 1);
    assert.strictEqual(text, 'flaky-ok');
    assert.deepStrictEqual(classified.slice().sort(), ['flaky', 'good']);
  });

  await check('live stream of the winner is not replaced', () => {
    const deltas = [];
    const feed = race.createRaceFeed((d, meta) => deltas.push({ d, meta }), () => {}, 2);
    feed.start();
    feed.onToken('fast', 'Hel');
    feed.onToken('fast', 'lo');
    feed.onBack();
    feed.onToken('slow', 'Bye');
    feed.onBack();
    feed.settle({ model: 'fast', text: 'Hello' });
    assert.ok(!deltas.some((x) => x.meta && x.meta.replace && x.d === 'Hello'));
    assert.strictEqual(deltas.map((x) => x.d).join(''), 'Hello');
  });

  await check('Seeker chat wires race dials, keeps x402/MWA, skips SPAWN/podagent', () => {
    const app = read('www/app/app.js');
    const html = read('www/app/index.html');
    const raceJs = read('www/app/race.js');
    const payJs = read('www/app/pay.js');
    const shell = read('www/index.html');
    assert.match(html, /race\.js/);
    assert.match(html, /id="raceSel"/);
    assert.match(html, /id="tierSel"/);
    assert.match(html, /value="2 4" selected/);
    assert.match(html, /value="grok4\.6"/);
    assert.match(app, /brainRace/);
    assert.match(app, /formatRaceStatus/);
    assert.match(app, /streamRacer/);
    assert.match(app, /tierModels/);
    assert.match(app, /OpenZooPay\.paidFetch/);
    assert.match(app, /wallet-sign-transaction/);
    assert.match(app, /keepPending/);
    assert.match(payJs, /withPayGate/);
    assert.match(payJs, /X-PAYMENT/);
    assert.match(payJs, /signTransaction/);
    assert.match(shell, /MWA\.signTransaction/);
    assert.match(raceJs, /first X countable/);
    assert.match(raceJs, /grok4\.6/);
    assert.doesNotMatch(app, /podagent\.mjs/);
    assert.doesNotMatch(raceJs, /podagent\.mjs/);
    assert.doesNotMatch(app, /\bSPAWN:/);
    assert.doesNotMatch(raceJs, /\bSPAWN:/);
    assert.doesNotMatch(app, /Play Billing|billingClient|com\.android\.vending/i);
    assert.doesNotMatch(html, /Play Billing/i);
    assert.doesNotMatch(app, /Auto\.shortlist|\/v1\/route|127\.0\.0\.1:8402/);
    assert.match(app, /spend\.race >= 2 && !\(Auto && Auto\.isAuto\(pinnedModel\(\)\)\)/);
  });

  console.log('\n' + passed + ' race checks passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
