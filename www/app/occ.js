/* Hosted OCC client for Seeker — same door as iOS/Android.
   Phones cannot run packed openzoo-claude. Agent is a remote OCC session
   plus file upload.

   Door: https://zoo.openzoo.fun
   Paths: /occ/sessions, /occ/sessions/:id/messages, /occ/sessions/:id/files,
          /occ/sessions/:id/stop. Do not invent /api/occ or a second set.
   Host gate: Authorization: Bearer <OpenZoo subscription key> on every
   OCC/upload call. No key → no session. Never an open OCC URL.
   Never ANTHROPIC_API_KEY. Inference pay stays x402 + MWA (paidFetch).
   OCC Authorization is the subscription Bearer, not a wallet token. */
(function (root) {
  'use strict';

  var OCC_ORIGIN = 'https://zoo.openzoo.fun';
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

  var ROUTES = {
    sessions: '/occ/sessions',
    messages: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/messages'; },
    files: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/files'; },
    stop: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/stop'; }
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

  function assertHostAuth(headers) {
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
  }

  async function occFetch(path, init, ctx) {
    ctx = ctx || {};
    init = init || {};
    var headers = hostHeaders(ctx.subscription, init.headers);
    assertHostAuth(headers);
    var url = /^https?:\/\//i.test(path) ? path : occUrl(path);
    if (url.indexOf(OCC_ORIGIN + '/occ/') !== 0) {
      throw OccError('OCC calls stay on the zoo door /occ routes.', { code: 'occ-bad-url' });
    }
    var opts = Object.assign({}, init, { headers: headers });
    var usePay = !!(ctx.pay && ctx.paidFetch);
    var doFetch = usePay ? ctx.paidFetch : (ctx.fetch || (typeof fetch === 'function' ? fetch : null));
    if (!doFetch) throw OccError('no fetch', { code: 'occ-no-fetch' });
    var res;
    if (usePay) res = await ctx.paidFetch(url, opts, ctx.payCtx || {});
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
        threadId: ctx.threadId || (ctx.thread && ctx.thread.id) || undefined,
        name: ctx.name || (ctx.thread && ctx.thread.name) || undefined
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

  function toBase64(raw) {
    var s = raw == null ? '' : (typeof raw === 'string' ? raw : String(raw));
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(s)));
  }

  function fileName(file) {
    return (file && (file.name || file.path)) || 'upload.bin';
  }

  function uploadInit(file) {
    var name = fileName(file);
    var blob = file && (file.file || file.blob);
    if (blob && typeof FormData !== 'undefined') {
      var fd = new FormData();
      if (typeof blob === 'object' && typeof File !== 'undefined' && blob instanceof File) {
        fd.append('file', blob, name);
      } else if (typeof Blob !== 'undefined' && blob instanceof Blob) {
        fd.append('file', blob, name);
      } else {
        fd.append('file', blob, name);
      }
      return { method: 'POST', body: fd };
    }
    var content = file && file.content != null ? file.content : '';
    var alreadyB64 = file && String(file.encoding || '').toLowerCase() === 'base64';
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name,
        content: alreadyB64 ? String(content) : toBase64(content),
        encoding: 'base64'
      })
    };
  }

  async function uploadFile(sessionId, file, ctx) {
    var res = await occFetch(ROUTES.files(sessionId), uploadInit(file), ctx);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw OccError((body && (body.error || body.message)) || ('upload HTTP ' + res.status), {
        code: 'occ-upload',
        status: res.status
      });
    }
    var name = fileName(file);
    return {
      path: (body.path || body.name || name),
      cwd: body.cwd || DEFAULT_CWD,
      wrote: body.wrote || [name]
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
    if (ev.type === 'error' || ev.type === 'done' || ev.type === 'status') return '';
    if (typeof ev.delta === 'string') return ev.delta;
    if (ev.delta && ev.delta.content) return String(ev.delta.content);
    if (ev.text) return String(ev.text);
    if (ev.content && typeof ev.content === 'string') return String(ev.content);
    if (ev.output) return String(ev.output);
    if (ev.pty) return String(ev.pty);
    var ch = ev.choices && ev.choices[0];
    if (ch && ch.delta && ch.delta.content) return String(ch.delta.content);
    if (ch && ch.message && ch.message.content) return String(ch.message.content);
    return '';
  }

  function eventError(ev) {
    if (!ev || typeof ev !== 'object') return '';
    if (ev.type !== 'error') return '';
    if (typeof ev.error === 'string') return ev.error;
    if (ev.error && ev.error.message) return String(ev.error.message);
    return String(ev.message || ev.text || 'OCC error');
  }

  async function readSSE(res, onDelta) {
    if (!res || !res.body || !res.body.getReader) {
      var d = await res.json().catch(function () { return {}; });
      var err0 = eventError(d);
      if (err0) throw OccError(err0, { code: 'occ-turn', status: res.status });
      var text = eventText(d);
      if (text && onDelta) onDelta(text, { replace: true, event: d });
      return { text: text, body: d, streamed: false };
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var text = '';
    var last = {};
    var eventName = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) {
          eventName = '';
          continue;
        }
        if (line.indexOf('event:') === 0) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.indexOf('data:') !== 0) continue;
        var payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          var ev = JSON.parse(payload);
          if (eventName && !ev.type) ev.type = eventName;
          last = ev;
          var err = eventError(ev);
          if (err) throw OccError(err, { code: 'occ-turn', event: ev });
          if (ev.type === 'done') continue;
          var piece = eventText(ev);
          if (piece) {
            if (ev.replace) text = piece;
            else text += piece;
            if (onDelta) onDelta(piece, { replace: !!ev.replace, event: ev });
          }
        } catch (e) {
          if (e && e.code === 'occ-turn') throw e;
          text += payload;
          if (onDelta) onDelta(payload, {});
        }
      }
    }
    return { text: text, body: last, streamed: true };
  }

  function messageBody(text) {
    var line = String(text || '');
    return { text: line, message: line, stream: true };
  }

  async function sendMessage(sessionId, text, ctx) {
    ctx = ctx || {};
    var payCtx = Object.assign({}, ctx, { pay: true });
    var res = await occFetch(ROUTES.messages(sessionId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(messageBody(text))
    }, payCtx);
    var ct = '';
    try { ct = (res.headers && res.headers.get && res.headers.get('content-type')) || ''; } catch (_) {}
    if (/event-stream/i.test(ct) || (res.body && res.body.getReader && ctx.stream !== false)) {
      var streamed = await readSSE(res, ctx.onDelta);
      if (!res.ok && !streamed.text) {
        throw OccError('OCC message HTTP ' + res.status, { code: 'occ-turn', status: res.status });
      }
      return { ok: res.ok, status: res.status, text: streamed.text, body: streamed.body, streamed: true };
    }
    var json = await res.json().catch(function () { return {}; });
    var err = eventError(json);
    if (err) throw OccError(err, { code: 'occ-turn', status: res.status });
    var out = eventText(json);
    if (out && ctx.onDelta) ctx.onDelta(out, { replace: true, event: json });
    if (!res.ok) {
      throw OccError((json && (json.error || json.message)) || ('OCC message HTTP ' + res.status), {
        code: 'occ-turn',
        status: res.status
      });
    }
    return { ok: true, status: res.status, text: out, body: json, streamed: false };
  }

  async function sendGoal(sessionId, text, ctx) {
    var line = String(text || '').trim();
    if (!isGoalText(line)) line = '/goal ' + line;
    return sendMessage(sessionId, line, ctx);
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
    uploadFile: uploadFile,
    uploadFiles: uploadFiles,
    sendMessage: sendMessage,
    sendGoal: sendGoal,
    stopSession: stopSession,
    eventText: eventText,
    OccError: OccError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooOcc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
