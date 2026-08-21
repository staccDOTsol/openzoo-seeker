/* Cloud code-server + Cline for Seeker Agent.
   Phones cannot pack a local IDE. Agent is a remote code-server session
   loaded in the Agent webview.

   Door: https://zoo.openzoo.fun
   Paths: POST/GET /api/ide/session → { url, password?, id }
   Host gate: Authorization: Bearer <OpenZoo subscription key>
   No key → no session. Never an open / hardcoded IDE URL.
   Never ANTHROPIC_API_KEY. Chat pay stays x402 + MWA.
   Agent IDE Authorization is the subscription Bearer, not a wallet token. */
(function (root) {
  'use strict';

  var IDE_ORIGIN = 'https://zoo.openzoo.fun';
  var CLIENT = 'openzoo-seeker';
  var SESSION_PATH = '/api/ide/session';

  function Sub() {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('./subscription.js'); } catch (_) { return null; }
    }
    return root.OpenZooSub;
  }

  function IdeError(message, extra) {
    var e = new Error(message);
    extra = extra || {};
    Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    if (!e.code) e.code = 'ide';
    return e;
  }

  var ROUTES = {
    session: SESSION_PATH
  };

  function ideUrl(path) {
    return IDE_ORIGIN + path;
  }

  function requireBearer(sub) {
    var S = Sub();
    var rec = sub || (S && S.loadSubscription());
    var auth = S ? S.bearerAuthorization(rec) : '';
    if (!auth) {
      throw IdeError('No subscription key — Agent IDE needs an OpenZoo subscription Bearer.', {
        code: 'ide-no-key',
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
    delete headers['X-PAYMENT'];
    delete headers['x-payment'];
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

  function looksWalletPayHeader(headers) {
    if (!headers) return false;
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (/^x-payment$/i.test(keys[i])) return true;
    }
    return false;
  }

  function assertHostAuth(headers) {
    if (looksAnthropicKeyHeader(headers)) {
      throw IdeError('Agent IDE never sends ANTHROPIC_API_KEY.', { code: 'ide-no-anthropic' });
    }
    if (looksWalletPayHeader(headers)) {
      throw IdeError('Agent IDE uses the subscription Bearer, not a wallet / x402 token.', {
        code: 'ide-no-wallet'
      });
    }
    if (!headers.authorization || !/^Bearer\s+\S+/.test(headers.authorization)) {
      throw IdeError('No subscription key — Agent IDE needs an OpenZoo subscription Bearer.', {
        code: 'ide-no-key',
        status: 401
      });
    }
    if (/Bearer\s+openzoo-seeker\s*$/i.test(headers.authorization)) {
      throw IdeError('Dummy gateway Bearer is not a subscription key.', {
        code: 'ide-no-key',
        status: 401
      });
    }
  }

  function sessionEndpoint(path) {
    var url = /^https?:\/\//i.test(path) ? path : ideUrl(path || SESSION_PATH);
    if (url !== IDE_ORIGIN + SESSION_PATH) {
      throw IdeError('Agent IDE calls stay on POST/GET /api/ide/session.', { code: 'ide-bad-url' });
    }
    return url;
  }

  async function ideFetch(path, init, ctx) {
    ctx = ctx || {};
    init = init || {};
    if (ctx.pay || ctx.paidFetch) {
      throw IdeError('Agent IDE uses the subscription Bearer, not a wallet / x402 token.', {
        code: 'ide-no-wallet'
      });
    }
    var headers = hostHeaders(ctx.subscription, init.headers);
    assertHostAuth(headers);
    var url = sessionEndpoint(path);
    var opts = Object.assign({}, init, { headers: headers });
    var doFetch = ctx.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw IdeError('no fetch', { code: 'ide-no-fetch' });
    var res = await doFetch(url, opts);
    if (res && res.status === 401) {
      throw IdeError('Subscription key refused — paste a live OpenZoo key to open Agent IDE.', {
        code: 'ide-unauthorized',
        status: 401
      });
    }
    return res;
  }

  function isHttpsUrl(value) {
    try {
      var u = new URL(String(value || ''));
      return u.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function parseSession(body) {
    body = body || {};
    var id = body.id || body.session_id || body.sessionId;
    var url = body.url || body.href || body.ideUrl;
    var password = body.password || body.pass || '';
    if (!url) return null;
    if (!isHttpsUrl(url)) {
      throw IdeError('Agent IDE URL must be https from /api/ide/session — never an open URL.', {
        code: 'ide-open-url'
      });
    }
    return {
      id: id ? String(id) : '',
      url: String(url),
      password: password ? String(password) : ''
    };
  }

  async function readSession(res, fallbackCode) {
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw IdeError((body && (body.error || body.message)) || ('IDE session HTTP ' + res.status), {
        code: res.status === 401 ? 'ide-unauthorized' : fallbackCode,
        status: res.status
      });
    }
    var sess = parseSession(body);
    if (!sess) {
      throw IdeError('IDE host returned no session URL — never load an open URL.', {
        code: 'ide-no-url'
      });
    }
    return sess;
  }

  function sessionBody(ctx) {
    ctx = ctx || {};
    var out = {};
    var threadId = ctx.threadId || (ctx.thread && ctx.thread.id);
    var name = ctx.name || (ctx.thread && ctx.thread.name);
    if (threadId) out.threadId = threadId;
    if (name) out.name = name;
    return out;
  }

  async function getSession(ctx) {
    ctx = ctx || {};
    requireBearer(ctx.subscription);
    var res = await ideFetch(ROUTES.session, { method: 'GET' }, ctx);
    return readSession(res, 'ide-session');
  }

  async function createSession(ctx) {
    ctx = ctx || {};
    requireBearer(ctx.subscription);
    var res = await ideFetch(ROUTES.session, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sessionBody(ctx))
    }, ctx);
    return readSession(res, 'ide-session');
  }

  async function ensureSession(ctx) {
    ctx = ctx || {};
    requireBearer(ctx.subscription);
    try {
      return await getSession(ctx);
    } catch (e) {
      if (e && (e.code === 'ide-no-key' || e.code === 'ide-unauthorized' || e.code === 'ide-no-anthropic' || e.code === 'ide-no-wallet')) {
        throw e;
      }
      if (e && e.status && e.status !== 404 && e.status < 500) throw e;
      return createSession(ctx);
    }
  }

  function frameSrc(session) {
    if (!session || !session.url) {
      throw IdeError('No IDE session URL — never load an open URL.', { code: 'ide-no-url' });
    }
    if (!isHttpsUrl(session.url)) {
      throw IdeError('Agent IDE URL must be https from /api/ide/session — never an open URL.', {
        code: 'ide-open-url'
      });
    }
    var url = String(session.url);
    var password = session.password ? String(session.password) : '';
    if (!password) return url;
    try {
      var u = new URL(url);
      if (!u.searchParams.get('password')) u.searchParams.set('password', password);
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  var api = {
    IDE_ORIGIN: IDE_ORIGIN,
    CLIENT: CLIENT,
    SESSION_PATH: SESSION_PATH,
    ROUTES: ROUTES,
    ideUrl: ideUrl,
    requireBearer: requireBearer,
    hostHeaders: hostHeaders,
    ideFetch: ideFetch,
    parseSession: parseSession,
    getSession: getSession,
    createSession: createSession,
    ensureSession: ensureSession,
    frameSrc: frameSrc,
    IdeError: IdeError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooIde = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
