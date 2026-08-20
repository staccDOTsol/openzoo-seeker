/* First-X-of-Y model race for Seeker chat.
   Policy (lock): first X countable back of Y, default first 2 of 4.
   Cheap classifier among those X. If none clear, last of those X.
   Empty / HTTP / pay / fetch-failed are NOT countable.
   All-fail never ships a single model's fetch-failed as the winner.
   Do not wait on the slowest. Stream live if already streaming.
   Chat only: no SPAWN, no worktrees, no desktop podagent. */
(function (root) {
  'use strict';

  var RACE_EVERY_FAILED = '(race: every model failed — no reply)';
  var RACE_MIN_SCORE = 6;
  var RACE_MAX = 4;
  var DEFAULT_NEED = 2;
  var DEFAULT_N = 4;
  var JUDGE_MODEL = 'deepseek/deepseek-v4-flash';

  var RACE_HTTP_NOTE = /^\((?:upstream error|request failed|payment failed|rate limited|stream timed out|stream stalled)/i;
  var RACE_MODEL_FAILED = /^\([^)]+ (?:failed:|returned nothing)/i;
  var RACE_FETCH_FAILED = /^(?:typeerror:\s*)?fetch failed$/i;

  var TIERS = {
    cheap: [
      'deepseek/deepseek-v4-flash',
      'meta-llama/llama-4-scout',
      'z-ai/glm-4.7-flash',
      'bytedance-seed/seed-2.0-mini',
      'meta-llama/llama-4-maverick',
      'z-ai/glm-4.5-air',
      'minimax/minimax-m2.5',
      'z-ai/glm-4.6v',
      'minimax/minimax-m2',
      'inclusionai/ling-3.0-flash'
    ],
    medium: [
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7',
      'google/gemini-3.7-flash',
      'x-ai/grok-4.3',
      'moonshotai/kimi-k2.7-code',
      'z-ai/glm-5',
      'moonshotai/kimi-k2.6',
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'qwen/qwen3.8-27b'
    ],
    expensive: [
      'anthropic/claude-opus-5',
      'openai/gpt-5.5',
      'anthropic/claude-sonnet-5',
      'x-ai/grok-4.6',
      'moonshotai/kimi-k3',
      'anthropic/claude-opus-4.8',
      'openai/gpt-5.4',
      'qwen/qwen3.8-max',
      'x-ai/grok-4.5'
    ],
    'grok4.6': [
      'x-ai/grok-4.6',
      'x-ai/grok-4.5',
      'x-ai/grok-4.3',
      'x-ai/grok-4.20'
    ]
  };
  var TIER_NAMES = ['cheap', 'medium', 'expensive', 'grok4.6'];

  function formatRaceStatus(back, need) {
    var n = Math.max(1, Number(need) || 1);
    var b = Math.min(n, Math.max(0, Number(back) || 0));
    return 'racing ' + b + '/' + n + ' back…';
  }

  function isRaceCountable(textOrArrival) {
    var arrival = textOrArrival && typeof textOrArrival === 'object' && !Array.isArray(textOrArrival)
      ? textOrArrival
      : { text: textOrArrival };
    if (arrival.error) return false;
    var s = String(arrival.text || '').trim();
    if (!s) return false;
    if (RACE_FETCH_FAILED.test(s)) return false;
    if (RACE_HTTP_NOTE.test(s)) return false;
    if (RACE_MODEL_FAILED.test(s)) return false;
    return true;
  }

  function raceLastShip(arrivals) {
    var list = Array.isArray(arrivals) ? arrivals : [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (isRaceCountable(list[i])) {
        return Object.assign({}, list[i], { text: String(list[i].text) });
      }
    }
    return { model: '', text: RACE_EVERY_FAILED, error: true };
  }

  function raceFailKind(arrival) {
    var err = String((arrival && arrival.error) || '');
    var text = String((arrival && arrival.text) || '').trim();
    var s = (err + ' ' + text).trim();
    if (!s) return 'empty body';
    if (/timeout|STREAM_IDLE|aborted|AbortError/i.test(s)) return 'timeout';
    if (/402|payment failed/i.test(s)) return 'pay';
    if (/fetch failed/i.test(s)) return 'fetch failed';
    var http = /HTTP\s+(\d{3})/i.exec(s);
    if (http) return 'HTTP ' + http[1];
    if (err) return 'error';
    if (!isRaceCountable(arrival)) return 'empty body';
    return 'ok';
  }

  function summarizeRaceFailures(arrivals) {
    var counts = {};
    (Array.isArray(arrivals) ? arrivals : []).forEach(function (a) {
      var k = raceFailKind(a);
      if (k === 'ok') return;
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  function shouldRetryRaceArrival(arrival) {
    if (isRaceCountable(arrival)) return false;
    var k = raceFailKind(arrival);
    return k === 'fetch failed' || k === 'timeout' || k === 'empty body'
      || k === 'error' || /^HTTP 5/.test(k) || k === 'HTTP 000';
  }

  function parseClassifyScore(text) {
    var s = String(text || '');
    var tagged = /SCORE\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(s);
    var lone = tagged || /\b(10|[0-9])(?:\s*\/\s*10)?\b/.exec(s);
    if (!lone) return 0;
    var n = Number(lone[1]);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(10, n));
  }

  function pickRaceWinner(cands, minScore) {
    if (minScore == null) minScore = RACE_MIN_SCORE;
    var list = Array.isArray(cands) ? cands.filter(Boolean) : [];
    if (!list.length) return { winner: null, reason: 'empty', tied: [] };
    var passing = list.filter(function (c) { return (Number(c.score) || 0) >= minScore; });
    if (!passing.length) {
      return { winner: list[list.length - 1], reason: 'fallback-last', tied: [] };
    }
    var max = -Infinity;
    passing.forEach(function (c) {
      var sc = Number(c.score) || 0;
      if (sc > max) max = sc;
    });
    var tied = passing.filter(function (c) { return (Number(c.score) || 0) === max; });
    if (tied.length === 1) return { winner: tied[0], reason: 'score', tied: tied };
    return { winner: null, reason: 'tie', tied: tied };
  }

  function createRaceFeed(onDelta, onStatus, need) {
    var live = null;
    var settled = false;
    var back = 0;
    var buf = new Map();
    var dead = new Set();
    function paintStatus() { if (onStatus) onStatus(formatRaceStatus(back, need)); }
    return {
      start: function () { paintStatus(); },
      liveModel: function () { return live; },
      onToken: function (model, chunk) {
        if (settled || chunk == null || chunk === '') return;
        buf.set(model, (buf.get(model) || '') + chunk);
        if (!live) {
          live = model;
          if (onDelta) onDelta(chunk, { model: model });
          return;
        }
        if (live === model && onDelta) onDelta(chunk, { model: model });
      },
      onFail: function (model) {
        dead.add(model);
        if (settled || live !== model) return;
        var next = null;
        buf.forEach(function (t, m) {
          if (next) return;
          if (m !== model && t && !dead.has(m)) next = [m, t];
        });
        if (next) {
          live = next[0];
          if (onDelta) onDelta(next[1], { replace: true, model: live });
        } else {
          live = null;
        }
      },
      onBack: function () {
        if (settled || back >= need) return;
        back += 1;
        paintStatus();
      },
      settle: function (winner) {
        settled = true;
        var text = String((winner && winner.text) || '').trim()
          ? winner.text
          : RACE_EVERY_FAILED;
        if (winner && winner.model && live === winner.model && !winner.error) return;
        live = (winner && winner.model) || live;
        if (onDelta) onDelta(text, { replace: true, model: winner && winner.model });
      }
    };
  }

  function normalizeTier(name) {
    var t = String(name || '').toLowerCase();
    return TIERS[t] ? t : 'medium';
  }

  function parseRaceValue(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === '0' || s === 'off' || s === '1') {
      return { race: 0, raceNeed: 1 };
    }
    var parts = s.split(/\s+/).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
    var n;
    var k;
    if (parts.length >= 2) {
      k = Math.round(parts[0]);
      n = Math.round(parts[1]);
    } else {
      n = Math.round(parts[0] || 0);
      k = 1;
    }
    if (n < 2) return { race: 0, raceNeed: 1 };
    n = Math.min(RACE_MAX, Math.max(2, n));
    k = Math.min(n, Math.max(1, k || DEFAULT_NEED));
    return { race: n, raceNeed: k };
  }

  function raceSelectValue(race, raceNeed) {
    var n = Number(race) || 0;
    var k = Number(raceNeed) || 1;
    if (n < 2) return '0';
    if (k > 1) return k + ' ' + n;
    return String(n);
  }

  function shuffleCopy(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function tierModels(tier, n, random, catalogIds) {
    var want = TIERS[normalizeTier(tier)] || TIERS.medium;
    var ids = catalogIds;
    var live = want;
    if (ids) {
      var has = typeof ids.has === 'function'
        ? function (m) { return ids.has(m); }
        : function (m) { return ids.indexOf(m) >= 0; };
      live = want.filter(has);
    }
    var pool = live.length ? live : want;
    var take = Math.max(1, Math.min(n == null ? 1 : n, pool.length));
    if (!random) return pool.slice(0, take);
    return shuffleCopy(pool).slice(0, take);
  }

  function raceQuestion(messages) {
    var asked = '';
    for (var i = (messages || []).length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === 'user') {
        asked = messages[i].content;
        break;
      }
    }
    return typeof asked === 'string' ? asked : '(see candidates)';
  }

  function defaultPairwise(messages, tied, stream) {
    var letters = tied.map(function (_, i) { return String.fromCharCode(65 + i); });
    var prompt = 'You are judging answers to one question. Pick the single best one.\n\n'
      + 'QUESTION:\n' + String(raceQuestion(messages)).slice(0, 4000) + '\n\n'
      + tied.map(function (c, i) {
        return 'ANSWER ' + letters[i] + ':\n' + String(c.text || '').slice(0, 6000);
      }).join('\n\n')
      + '\n\nJudge on: correctness first, then completeness, then whether it actually did what was asked. '
      + 'Ignore length and confidence of tone.\n'
      + 'Reply with ONE letter and nothing else: ' + letters.join(' or ') + '.';
    return Promise.resolve(stream(
      [{ role: 'user', content: prompt }],
      function () {},
      null,
      JUDGE_MODEL
    )).then(function (verdict) {
      var hit = String(verdict).toUpperCase().split('').find(function (ch) {
        var idx = ch.charCodeAt(0) - 65;
        return idx >= 0 && idx < tied.length;
      });
      if (hit) return tied[hit.charCodeAt(0) - 65];
      return tied[tied.length - 1];
    }).catch(function () {
      return tied[tied.length - 1];
    });
  }

  function defaultClassify(messages, cand, stream) {
    var prompt = 'Score this answer to one question from 0 to 10.\n\n'
      + 'QUESTION:\n' + String(raceQuestion(messages)).slice(0, 4000) + '\n\n'
      + 'ANSWER:\n' + String((cand && cand.text) || '').slice(0, 6000) + '\n\n'
      + 'Judge on: correctness first, then completeness, then whether it actually did what was asked. '
      + 'Ignore length and confidence of tone.\n'
      + 'Reply with exactly: SCORE <n>';
    return Promise.resolve(stream(
      [{ role: 'user', content: prompt }],
      function () {},
      null,
      JUDGE_MODEL
    )).then(function (verdict) {
      return parseClassifyScore(verdict);
    });
  }

  /**
   * Launch Y models, judge the first X countable answers.
   * hooks: { stream, classify, pairwise, minScore, onArrivals, signal }
   */
  function brainRace(messages, onDelta, contextId, models, need, maxTokens, onStatus, hooks) {
    hooks = hooks || {};
    var stream = hooks.stream;
    if (typeof stream !== 'function') {
      return Promise.reject(new Error('race stream hook required'));
    }
    var classify = hooks.classify || function (m, c) { return defaultClassify(m, c, stream); };
    var pairwise = hooks.pairwise || function (m, tied) { return defaultPairwise(m, tied, stream); };
    var minScore = hooks.minScore != null ? Number(hooks.minScore) : RACE_MIN_SCORE;
    var list = (models || []).filter(Boolean).slice(0, RACE_MAX);
    if (list.length < 2) {
      return Promise.resolve(stream(messages, onDelta, contextId, list[0], maxTokens));
    }
    var want = Math.max(1, Math.min(Number(need) || 1, list.length));

    var feed = createRaceFeed(onDelta, onStatus, want);
    feed.start();

    var done = [];
    var arrivals = [];
    var finished = 0;
    var release;
    var enough = new Promise(function (r) { release = r; });
    var aborted = false;
    if (hooks.signal) {
      if (hooks.signal.aborted) aborted = true;
      else hooks.signal.addEventListener('abort', function () { aborted = true; }, { once: true });
    }

    function ship(cand) {
      var out = cand && String(cand.text || '').trim() ? cand : raceLastShip(arrivals);
      feed.settle(out);
      try { if (hooks.onArrivals) hooks.onArrivals(arrivals); } catch (_) {}
      aborted = true;
      return out.text;
    }

    function runOne(m) {
      var last = { model: m, text: '', error: 'empty body' };
      function attempt(n) {
        if (aborted && n > 0) return Promise.resolve();
        return Promise.resolve()
          .then(function () {
            return stream(messages, function (chunk) { feed.onToken(m, chunk); }, contextId, m, maxTokens);
          })
          .then(function (text) {
            last = { model: m, text: text == null ? '' : String(text) };
            if (isRaceCountable(last)) {
              arrivals.push(last);
              done.push(last);
              feed.onBack();
              return;
            }
            if (!shouldRetryRaceArrival(last) || n >= 1 || aborted) {
              arrivals.push(last);
              feed.onFail(m);
              return;
            }
            return attempt(n + 1);
          })
          .catch(function (e) {
            last = { model: m, text: '', error: (e && e.message) || 'error' };
            if (e && (e.code === 'wrap-cancelled' || e.prompt || e.code === 'short-sol' || e.code === 'short-tokens')) {
              arrivals.push(last);
              feed.onFail(m);
              return;
            }
            if (!shouldRetryRaceArrival(last) || n >= 1 || aborted) {
              arrivals.push(last);
              feed.onFail(m);
              return;
            }
            return attempt(n + 1);
          });
      }
      return attempt(0);
    }

    var attempts = list.map(function (m) {
      return runOne(m).then(function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      }, function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      });
    });
    attempts.forEach(function (p) { p.catch(function () {}); });

    return enough.then(function () {
      var cands = done.slice(0, want);
      if (!cands.length) return ship(raceLastShip(arrivals));
      if (cands.length === 1) return ship(cands[0]);

      if (onStatus) onStatus('judging…');
      return Promise.all(cands.map(function (c) {
        return Promise.resolve()
          .then(function () { return classify(messages, c); })
          .then(function (score) { return Object.assign({}, c, { score: Number(score) || 0 }); })
          .catch(function () { return Object.assign({}, c, { score: 0 }); });
      })).then(function (scored) {
        var picked = pickRaceWinner(scored, minScore);
        if (picked.reason === 'tie' && picked.tied.length > 1) {
          return Promise.resolve()
            .then(function () { return pairwise(messages, picked.tied); })
            .then(function (broken) {
              var usable = broken && String(broken.text || '').trim();
              var winner = usable ? broken : picked.tied[picked.tied.length - 1];
              return ship(winner || scored[scored.length - 1] || raceLastShip(arrivals));
            })
            .catch(function () {
              return ship(picked.tied[picked.tied.length - 1] || scored[scored.length - 1]);
            });
        }
        return ship(picked.winner || scored[scored.length - 1] || raceLastShip(arrivals));
      });
    });
  }

  var api = {
    TIERS: TIERS,
    TIER_NAMES: TIER_NAMES,
    JUDGE_MODEL: JUDGE_MODEL,
    RACE_EVERY_FAILED: RACE_EVERY_FAILED,
    RACE_MIN_SCORE: RACE_MIN_SCORE,
    RACE_MAX: RACE_MAX,
    DEFAULT_NEED: DEFAULT_NEED,
    DEFAULT_N: DEFAULT_N,
    formatRaceStatus: formatRaceStatus,
    isRaceCountable: isRaceCountable,
    raceLastShip: raceLastShip,
    raceFailKind: raceFailKind,
    summarizeRaceFailures: summarizeRaceFailures,
    shouldRetryRaceArrival: shouldRetryRaceArrival,
    parseClassifyScore: parseClassifyScore,
    pickRaceWinner: pickRaceWinner,
    createRaceFeed: createRaceFeed,
    normalizeTier: normalizeTier,
    parseRaceValue: parseRaceValue,
    raceSelectValue: raceSelectValue,
    tierModels: tierModels,
    brainRace: brainRace
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooRace = api;
})(typeof window !== 'undefined' ? window : globalThis);
