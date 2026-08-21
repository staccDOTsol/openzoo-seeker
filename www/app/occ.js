/* Hosted OCC client for Seeker.
   Phones cannot run packed openzoo-claude. Agent is a remote OCC session
   plus file upload to that session's cwd.

   Door: https://openzoo.fun (same product origin as MWA identity).
   Host gate: Authorization: Bearer <subscription key>. No key → no session.
   Inference pay: existing x402 + MWA (paidFetch). Never ANTHROPIC_API_KEY. */
(function (root) {
  'use strict';

  var OCC_ORIGIN = 'https://openzoo.fun';
  var DEFAULT_CWD = '/workspace';
  var CLIENT = 'openzoo-seeker';

  function Sub() {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('./subscription.js'); } catch (_) { return null; }
    }
    return root.OpenZooSub;
  }

  function OccError(message, extra) {
    var e = new Error(message);
    extra = extra || {};
    Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    if (!e.code) e.code = 'occ';
    return e;
  }

  function encodePath(rel) {
    return String(rel || '').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  }

  var ROUTES = {
    sessions: '/api/occ/sessions',
    session: function (id) { return '/api/occ/sessions/' + encodeURIComponent(id); },
    messages: function (id) { return '/api/occ/sessions/' + encodeURIComponent(id) + '/messages'; },
    goal: function (id) { return '/api/occ/sessions/' + encodeURIComponent(id) + '/goal'; },
    files: function (id, rel) {
      var q = encodePath(rel);
      return '/api/occ/sessions/' + encodeURIComponent(id) + '/files' + (q ? ('?path=' + q) : '');
    },
    stream: function (id) { return '/api/occ/sessions/' + encodeURIComponent(id) + '/stream'; },
    stop: function (id) { return '/api/occ/sessions/' + encodeURIComponent(id) + '/stop'; }
  };

  function occUrl(path) {
    return OCC_ORIGIN + path;
  }

  function isGoalText(text) {
    return /^\/goal\b/i.test(String(text || '').trim());
  }

  function goalText(text) {
    var raw = String(text || '').trim();
    if (!isGoalText(raw)) return raw;
    return raw.replace(/^\/goal\s*/i, '').trim();
  }

  function requireBearer(sub) {
    var S = Sub();
    var rec = sub || (S && S.loadSubscription());
    var auth = S ? S.bearerAuthorization(rec) : '';
    if (!auth) {
      throw OccError('No subscription key — Agent needs an OpenZoo subscription Bearer.', {
        code: 'occ-no-key',
        status: 401
      });
    }
    return auth;
  }

  function hostHeaders(sub, extra) {
    var S = Sub();
    var rec = sub || (S && S.loadSubscription());
    var headers = S ? S.applySubscriptionHeaders(extra || {}, rec) : Object.assign({}, extra || {});
    if (!headers.authorization) headers.authorization = requireBearer(rec);
    delete headers['x-api-key'];
    delete headers['X-Api-Key'];
    delete headers.ANTHROPIC_API_KEY;
    delete headers.anthropic_api_key;
    return headers;
  }

  function looksAnthropicKeyHeader(headers) {
    if (!headers) return false;
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (/anthropic/i.test(keys[i])) return true;
      if (/^x-api-key$/i.test(keys[i])) return true;
    }
    return false;
  }

  async function occFetch(path, init, ctx) {
    ctx = ctx || {};
    init = init || {};
    var headers = hostHeaders(ctx.subscription, init.headers);
    if (looksAnthropicKeyHeader(headers)) {
      throw OccError('Agent never sends ANTHROPIC_API_KEY.', { code: 'occ-no-anthropic' });
    }
    if (!headers.authorization || !/^Bearer\s+\S+/.test(headers.authorization)) {
      throw OccError('No subscription key — Agent needs an OpenZoo subscription Bearer.', {
        code: 'occ-no-key',
        status: 401
      });
    }
    if (/Bearer\s+openzoo-seeker\s*$/i.test(headers.authorization)) {
      throw OccError('Dummy gateway Bearer is not a subscription key.', {
        code: 'occ-no-key',
        status: 401
      });
    }
    var url = /^https?:\/\//i.test(path) ? path : occUrl(path);
    var opts = Object.assign({}, init, { headers: headers });
    var doFetch = ctx.paidFetch || ctx.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw OccError('no fetch', { code: 'occ-no-fetch' });
    var res;
    if (ctx.paidFetch) res = await ctx.paidFetch(url, opts, ctx.payCtx || {});
    else res = await doFetch(url, opts);
    if (res && res.status === 401) {
      throw OccError('Subscription key refused — paste a live OpenZoo key to open Agent.', {
        code: 'occ-unauthorized',
        status: 401
      });
    }
    return res;
  }

  function parseSession(body) {
    body = body || {};
    var id = body.id || body.session_id || body.sessionId;
    if (!id) return null;
    return {
      id: String(id),
      cwd: body.cwd || body.dir || DEFAULT_CWD,
      status: body.status || 'ready'
    };
  }

  async function createSession(ctx) {
    ctx = ctx || {};
    requireBearer(ctx.subscription);
    var res = await occFetch(ROUTES.sessions, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: CLIENT,
        cwd: ctx.cwd || DEFAULT_CWD,
        model: ctx.model || undefined
      })
    }, ctx);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw OccError((body && (body.error || body.message)) || ('OCC session HTTP ' + res.status), {
        code: res.status === 401 ? 'occ-unauthorized' : 'occ-session',
        status: res.status
      });
    }
    var sess = parseSession(body);
    if (!sess) throw OccError('OCC host returned no session id.', { code: 'occ-session' });
    return sess;
  }

  async function getSession(id, ctx) {
    var res = await occFetch(ROUTES.session(id), { method: 'GET' }, ctx);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw OccError((body && (body.error || body.message)) || ('OCC session HTTP ' + res.status), {
        code: res.status === 404 ? 'occ-gone' : 'occ-session',
        status: res.status
      });
    }
    return parseSession(body) || { id: id, cwd: DEFAULT_CWD };
  }

  function fileBody(file) {
    if (!file) return { body: '', type: 'text/plain' };
    if (file.file) return { body: file.file, type: file.file.type || 'application/octet-stream' };
    if (file.blob) return { body: file.blob, type: file.type || 'application/octet-stream' };
    if (file.content != null) {
      return { body: String(file.content), type: 'text/plain; charset=utf-8' };
    }
    return { body: '', type: 'text/plain' };
  }

  async function uploadFile(sessionId, file, ctx) {
    var rel = (file && (file.name || file.path)) || 'upload.bin';
    var packed = fileBody(file);
    var res = await occFetch(ROUTES.files(sessionId, rel), {
      method: 'PUT',
      headers: { 'content-type': packed.type },
      body: packed.body
    }, ctx);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw OccError((body && (body.error || body.message)) || ('upload HTTP ' + res.status), {
        code: 'occ-upload',
        status: res.status
      });
    }
    return {
      path: (body.path || rel),
      cwd: body.cwd || DEFAULT_CWD,
      wrote: body.wrote || [rel]
    };
  }

  async function uploadFiles(sessionId, files, ctx) {
    var out = [];
    var list = files || [];
    for (var i = 0; i < list.length; i++) {
      out.push(await uploadFile(sessionId, list[i], ctx));
    }
    return out;
  }

  function eventText(ev) {
    if (ev == null) return '';
    if (typeof ev === 'string') return ev;
    if (ev.text) return String(ev.text);
    if (ev.content) return String(ev.content);
    if (ev.delta && ev.delta.content) return String(ev.delta.content);
    var ch = ev.choices && ev.choices[0];
    if (ch && ch.delta && ch.delta.content) return String(ch.delta.content);
    if (ch && ch.message && ch.message.content) return String(ch.message.content);
    if (ev.output) return String(ev.output);
    return '';
  }

  async function readSSE(res, onDelta) {
    if (!res || !res.body || !res.body.getReader) {
      var d = await res.json().catch(function () { return {}; });
      var text = eventText(d);
      if (text && onDelta) onDelta(text, { replace: true });
      return { text: text, body: d, streamed: false };
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var text = '';
    var last = {};
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data:') !== 0) continue;
        var payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          var ev = JSON.parse(payload);
          last = ev;
          var piece = eventText(ev);
          if (piece) {
            if (ev.replace) text = piece;
            else text += piece;
            if (onDelta) onDelta(piece, { replace: !!ev.replace, event: ev });
          }
        } catch (_) {
          text += payload;
          if (onDelta) onDelta(payload, {});
        }
      }
    }
    return { text: text, body: last, streamed: true };
  }

  async function postTurn(sessionId, kind, text, ctx) {
    ctx = ctx || {};
    var path = kind === 'goal' ? ROUTES.goal(sessionId) : ROUTES.messages(sessionId);
    var body = kind === 'goal'
      ? { goal: goalText(text), text: String(text || '').trim() }
      : { text: String(text || ''), stream: true };
    var res = await occFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body)
    }, ctx);
    var ct = '';
    try { ct = (res.headers && res.headers.get && res.headers.get('content-type')) || ''; } catch (_) {}
    if (/event-stream/i.test(ct) || (res.body && res.body.getReader && ctx.stream !== false)) {
      var streamed = await readSSE(res, ctx.onDelta);
      if (!res.ok && !streamed.text) {
        throw OccError('OCC ' + kind + ' HTTP ' + res.status, { code: 'occ-turn', status: res.status });
      }
      return { ok: res.ok, status: res.status, text: streamed.text, body: streamed.body, streamed: true };
    }
    var json = await res.json().catch(function () { return {}; });
    var out = eventText(json);
    if (out && ctx.onDelta) ctx.onDelta(out, { replace: true });
    if (!res.ok) {
      throw OccError((json && (json.error || json.message)) || ('OCC ' + kind + ' HTTP ' + res.status), {
        code: 'occ-turn',
        status: res.status
      });
    }
    return { ok: true, status: res.status, text: out, body: json, streamed: false };
  }

  async function sendMessage(sessionId, text, ctx) {
    return postTurn(sessionId, isGoalText(text) ? 'goal' : 'message', text, ctx);
  }

  async function sendGoal(sessionId, text, ctx) {
    var line = String(text || '').trim();
    if (!isGoalText(line)) line = '/goal ' + line;
    return postTurn(sessionId, 'goal', line, ctx);
  }

  async function stopSession(sessionId, ctx) {
    var res = await occFetch(ROUTES.stop(sessionId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }, ctx);
    return { ok: res.ok, status: res.status };
  }

  var api = {
    OCC_ORIGIN: OCC_ORIGIN,
    DEFAULT_CWD: DEFAULT_CWD,
    CLIENT: CLIENT,
    ROUTES: ROUTES,
    occUrl: occUrl,
    isGoalText: isGoalText,
    goalText: goalText,
    requireBearer: requireBearer,
    hostHeaders: hostHeaders,
    occFetch: occFetch,
    createSession: createSession,
    getSession: getSession,
    uploadFile: uploadFile,
    uploadFiles: uploadFiles,
    sendMessage: sendMessage,
    sendGoal: sendGoal,
    stopSession: stopSession,
    OccError: OccError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooOcc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
