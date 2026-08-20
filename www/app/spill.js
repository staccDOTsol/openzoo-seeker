/* Chat-history spill/bind — the Claude Code / `npx openzoo claude` path.
   Bind the transcript prefix, send a short tail + context id.
   Never pair x-hrr-context with the full messages array.
   History only: no SPAWN, no worktrees, no file-path harvest. */
(function (root) {
  'use strict';

  var KEEP_TAIL = 3;
  var MIN_TURNS = 2;

  function msgText(m) {
    if (!m) return '';
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.map(function (b) {
        if (typeof b === 'string') return b;
        return (b && (b.text || b.content)) || '';
      }).join('\n');
    }
    if (m.content == null) return '';
    return String(m.content);
  }

  function corpusFromMessages(msgs) {
    return (msgs || []).map(function (m) {
      return msgText(m).trim();
    }).filter(Boolean).join('\n\n');
  }

  function firstSpillableIndex(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role !== 'system') return i;
    }
    return -1;
  }

  function lastUserIndex(msgs) {
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i] && msgs[i].role === 'user' && msgText(msgs[i]).trim()) return i;
    }
    return -1;
  }

  function cutChat(msgs, keepTail) {
    keepTail = keepTail == null ? KEEP_TAIL : keepTail;
    if (!Array.isArray(msgs) || !msgs.length) {
      return { cut: 0, firstSpillable: -1, lastUser: -1 };
    }
    var first = firstSpillableIndex(msgs);
    var lastUser = lastUserIndex(msgs);
    if (first < 0) return { cut: 0, firstSpillable: -1, lastUser: lastUser };
    if (msgs.length <= keepTail) {
      return { cut: first, firstSpillable: first, lastUser: lastUser };
    }
    var cut = msgs.length - keepTail;
    if (cut < first) cut = first;
    var i;
    for (i = cut; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role === 'user') { cut = i; break; }
    }
    if (lastUser >= 0 && cut > lastUser) cut = lastUser;
    if (cut < first) cut = first;
    return { cut: cut, firstSpillable: first, lastUser: lastUser };
  }

  function planChatSpill(history, thread, opts) {
    opts = opts || {};
    var keepTail = opts.keepTail == null ? KEEP_TAIL : opts.keepTail;
    var msgs = Array.isArray(history) ? history : [];
    var ctx = thread && thread.memory;
    var plan = cutChat(msgs, keepTail);
    var prefix = [];
    var tail = msgs.slice();
    var bind = false;

    if (ctx) {
      if (msgs.length > keepTail) {
        prefix = msgs.slice(plan.firstSpillable, plan.cut);
        tail = msgs.slice(plan.cut);
        bind = prefix.length > 0;
      }
      if (!tail.length && msgs.length) tail = msgs.slice(-1);
    } else if (msgs.length > keepTail) {
      prefix = msgs.slice(plan.firstSpillable, plan.cut);
      tail = msgs.slice(plan.cut);
      bind = prefix.length > 0;
    }

    return {
      messages: tail,
      contextId: ctx || null,
      prefix: prefix,
      corpus: corpusFromMessages(prefix),
      bind: bind,
      sent: tail.length,
      total: msgs.length
    };
  }

  function nextBindBody(thread, corpus) {
    var prior = (thread && thread.spillCorpus) || '';
    var text = corpus || '';
    if (thread && thread.memory && prior && text.indexOf(prior) === 0 && text.length > prior.length) {
      return { corpus: text.slice(prior.length), context_id: thread.memory, append: true };
    }
    if (thread && thread.memory && text) {
      return { corpus: text, context_id: thread.memory, append: true };
    }
    return { corpus: text, append: false };
  }

  function chatHeaders(contextId) {
    var headers = { 'content-type': 'application/json' };
    if (contextId) headers['x-hrr-context'] = contextId;
    return headers;
  }

  function assertNoFullDump(headers, messages, total) {
    var ctx = headers && (headers['x-hrr-context'] || headers['X-HRR-Context']);
    var sent = Array.isArray(messages) ? messages.length : 0;
    var n = Number(total);
    if (ctx && n > KEEP_TAIL && sent >= n) {
      throw new Error('x-hrr-context must not travel with the full messages array');
    }
    return true;
  }

  function noteReceipt(acc, x402) {
    acc = acc || {};
    if (typeof acc.spentUsd !== 'number') acc.spentUsd = 0;
    if (typeof acc.directUsd !== 'number') acc.directUsd = 0;
    if (typeof acc.calls !== 'number') acc.calls = 0;
    var x = x402 || {};
    if (typeof x.billedUsd === 'number') acc.spentUsd += x.billedUsd;
    if (typeof x.directUsd === 'number') acc.directUsd += x.directUsd;
    acc.calls += 1;
    acc.savingX = hudSavingX(acc.directUsd, acc.spentUsd);
    return acc;
  }

  function hudSavingX(directUsd, spentUsd) {
    var spent = Number(spentUsd);
    var direct = Number(directUsd);
    if (!(spent > 0) || !Number.isFinite(direct)) return null;
    return direct / spent;
  }

  function formatSavingX(mult) {
    if (mult == null || !Number.isFinite(Number(mult))) return '';
    var n = Number(mult);
    if (n >= 100) return Math.round(n) + '×';
    return n.toFixed(n >= 10 ? 1 : 2) + '×';
  }

  var api = {
    KEEP_TAIL: KEEP_TAIL,
    MIN_TURNS: MIN_TURNS,
    msgText: msgText,
    corpusFromMessages: corpusFromMessages,
    cutChat: cutChat,
    planChatSpill: planChatSpill,
    nextBindBody: nextBindBody,
    chatHeaders: chatHeaders,
    assertNoFullDump: assertNoFullDump,
    noteReceipt: noteReceipt,
    hudSavingX: hudSavingX,
    formatSavingX: formatSavingX
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooSpill = api;
})(typeof window !== 'undefined' ? window : globalThis);
