/* Hide model chain-of-thought behind a collapsible "thinking..." row.
   Default collapsed. No chip when there is no reasoning. The open
   transcript stays the visible answer only unless the user unfurls. */
(function (root) {
  'use strict';

  var LABEL = 'thinking...';
  var OPEN_TAG = /<think(?:ing)?\b[^>]*>/i;
  var CLOSE_TAG = /<\/think(?:ing)?>/i;
  var PAIR = /<think(?:ing)?\b[^>]*>([\s\S]*?)<\/think(?:ing)?>/gi;
  var TRAIL = /<think(?:ing)?\b[^>]*>([\s\S]*)$/i;

  function looksLikeDump(value) {
    if (value == null) return true;
    if (typeof value === 'object') return true;
    var s = String(value);
    var t = s.trim();
    if (!t) return true;
    if (t.charAt(0) === '{' || t.charAt(0) === '[') return true;
    return false;
  }

  function asText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return looksLikeDump(value) ? '' : value;
    return '';
  }

  function reasoningFrom(node) {
    if (node == null) return '';
    if (typeof node === 'string') return asText(node);
    if (Array.isArray(node)) {
      var joined = '';
      for (var i = 0; i < node.length; i++) joined += reasoningFrom(node[i]);
      return joined;
    }
    if (typeof node !== 'object') return '';
    var direct = asText(node.reasoning_content) || asText(node.reasoning) || asText(node.reasoning_text);
    if (direct) return direct;
    if (typeof node.text === 'string' && node.type && /reason/i.test(String(node.type))) {
      return asText(node.text);
    }
    return '';
  }

  function split(text) {
    var raw = text == null ? '' : String(text);
    var parts = [];
    var visible = raw.replace(PAIR, function (_, body) {
      if (body && String(body).trim()) parts.push(body);
      return '';
    });
    var trail = TRAIL.exec(visible);
    if (trail) {
      if (trail[1] && String(trail[1]).trim()) parts.push(trail[1]);
      visible = visible.slice(0, trail.index);
    }
    visible = visible.replace(CLOSE_TAG, '').replace(OPEN_TAG, '');
    visible = visible.replace(/<(?:\/)?[a-z]*$/i, '');
    return {
      content: visible,
      reasoning: parts.join('\n\n')
    };
  }

  function merge() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i] == null ? '' : String(arguments[i]);
      if (s && s.trim() && out.indexOf(s) < 0) out.push(s);
    }
    return out.join('\n\n');
  }

  function hasReasoning(value) {
    return !!(value && String(value).trim());
  }

  function fromCompletion(payload) {
    var empty = { content: '', reasoning: '' };
    if (!payload || typeof payload !== 'object') return empty;
    var ch = payload.choices && payload.choices[0];
    var msg = (ch && (ch.message || ch.delta)) || {};
    var tagged = split(msg.content || payload.streamedContent || '');
    var field = reasoningFrom(msg) || reasoningFrom(ch) || reasoningFrom(payload);
    return {
      content: tagged.content,
      reasoning: merge(tagged.reasoning, field)
    };
  }

  function createStream() {
    var raw = '';
    var field = '';
    var prevVisible = '';
    function snapshot() {
      var tagged = split(raw);
      var content = tagged.content;
      var reasoning = merge(tagged.reasoning, field);
      var visibleDelta = '';
      var replace = false;
      if (content.indexOf(prevVisible) === 0) visibleDelta = content.slice(prevVisible.length);
      else {
        visibleDelta = content;
        replace = true;
      }
      prevVisible = content;
      return {
        content: content,
        reasoning: reasoning,
        visibleDelta: visibleDelta,
        replace: replace,
        raw: raw
      };
    }
    return {
      pushContent: function (chunk) {
        if (chunk) raw += String(chunk);
        return snapshot();
      },
      pushReasoning: function (chunk) {
        var piece = reasoningFrom(chunk) || asText(chunk);
        if (piece) field += piece;
        return snapshot();
      },
      finish: function (payload) {
        var extra = fromCompletion(payload || {});
        if (extra.content && !raw) raw = extra.content;
        if (extra.reasoning) field = merge(field, extra.reasoning);
        var tagged = split(raw);
        if (extra.content && !tagged.content && extra.content !== raw) {
          tagged = split(extra.content);
          raw = extra.content;
        }
        field = merge(tagged.reasoning, field, extra.reasoning);
        raw = tagged.content;
        prevVisible = tagged.content;
        return {
          content: tagged.content,
          reasoning: merge(tagged.reasoning, field),
          visibleDelta: '',
          replace: true,
          raw: raw
        };
      },
      snapshot: function () {
        var tagged = split(raw);
        return {
          content: tagged.content,
          reasoning: merge(tagged.reasoning, field),
          visibleDelta: '',
          replace: false,
          raw: raw
        };
      }
    };
  }

  function applyToMessage(msg, parsed, opts) {
    opts = opts || {};
    if (!msg) return msg;
    if (parsed && parsed.content != null) msg.content = parsed.content;
    if (parsed && parsed.reasoning != null) msg.reasoning = parsed.reasoning;
    if (!hasReasoning(msg.reasoning)) {
      delete msg.reasoning;
      delete msg.thinkOpen;
    } else if (msg.thinkOpen == null) {
      msg.thinkOpen = false;
    }
    if (opts.pending != null) msg.pending = opts.pending;
    if (opts.meta != null) msg.meta = opts.meta;
    return msg;
  }

  function normalizeMessage(msg) {
    if (!msg || msg.role !== 'assistant') return msg;
    var parsed = split(msg.content || '');
    var reasoning = merge(parsed.reasoning, msg.reasoning);
    msg.content = parsed.content;
    if (hasReasoning(reasoning)) {
      msg.reasoning = reasoning;
      if (msg.thinkOpen == null) msg.thinkOpen = false;
    } else {
      delete msg.reasoning;
    }
    return msg;
  }

  var api = {
    LABEL: LABEL,
    split: split,
    merge: merge,
    hasReasoning: hasReasoning,
    reasoningFrom: reasoningFrom,
    fromCompletion: fromCompletion,
    createStream: createStream,
    applyToMessage: applyToMessage,
    normalizeMessage: normalizeMessage
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooThink = api;
})(typeof window !== 'undefined' ? window : globalThis);
