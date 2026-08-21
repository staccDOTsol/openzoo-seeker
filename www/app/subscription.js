/* OpenZoo subscription key — the host gate for Agent IDE (code-server + Cline).
   Chat still pays via x402 + MWA. This is never ANTHROPIC_API_KEY.
   Agent IDE uses this Bearer on /api/ide/session, not a wallet token.
   Paste the bearer itself or the zoo.openzoo.fun /billing/done?session= URL. */
(function (root) {
  'use strict';

  var BILLING_ORIGIN = 'https://zoo.openzoo.fun';
  var SUBSCRIPTIONS_PAGE = 'https://zoo.openzoo.fun/subscriptions';
  var STORE = 'openzoo.seeker.subscription.v1';

  var memoryStore = null;

  function asKey(v) {
    return String(v || '').trim();
  }

  function titleCase(id) {
    var s = String(id || '').trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function storage() {
    if (memoryStore) return memoryStore;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_) { /* private mode */ }
    memoryStore = {
      _data: {},
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
      setItem: function (k, v) { this._data[k] = String(v); },
      removeItem: function (k) { delete this._data[k]; }
    };
    return memoryStore;
  }

  function setMemoryStore(store) {
    memoryStore = store || null;
  }

  function saveSubscription(rec) {
    var key = asKey(rec && rec.key);
    if (!key) return null;
    var payload = {
      key: key,
      tier: rec.tier ? String(rec.tier) : null,
      tierName: rec.tierName ? String(rec.tierName) : (rec.tier ? titleCase(rec.tier) : null),
      sessionId: rec.sessionId ? String(rec.sessionId) : null,
      savedAt: Date.now()
    };
    storage().setItem(STORE, JSON.stringify(payload));
    return payload;
  }

  function clearSubscription() {
    try { storage().removeItem(STORE); } catch (_) { /* gone */ }
  }

  function loadSubscription() {
    try {
      var raw = storage().getItem(STORE);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!asKey(data && data.key)) return null;
      return {
        key: asKey(data.key),
        tier: data.tier || null,
        tierName: data.tierName || (data.tier ? titleCase(data.tier) : null),
        sessionId: data.sessionId || null,
        source: 'store'
      };
    } catch (_) {
      return null;
    }
  }

  function hasSubscriptionKey(sub) {
    return !!asKey((sub || loadSubscription() || {}).key);
  }

  function subscriptionPublicView(sub) {
    sub = sub || loadSubscription();
    if (!asKey(sub && sub.key)) return { active: false };
    var name = String(sub.tierName || titleCase(sub.tier) || '').trim();
    return {
      active: true,
      tier: sub.tier || null,
      tierName: name || null,
      label: name ? (name + ' · Agent IDE') : 'Subscription key · Agent IDE'
    };
  }

  function parseSubscriptionPaste(text) {
    var raw = String(text || '').trim();
    if (!raw) return { error: 'empty' };
    var session = '';
    try {
      if (/^https?:\/\//i.test(raw) || raw.indexOf('session=') >= 0) {
        var url = new URL(raw, BILLING_ORIGIN);
        session = url.searchParams.get('session') || url.searchParams.get('session_id') || '';
      }
    } catch (_) { /* not a URL */ }
    if (!session) {
      var m = /(?:session_id|session)=([A-Za-z0-9_]+)/.exec(raw);
      if (m) session = m[1];
    }
    if (session) return { session: session };
    if (/^https?:\/\//i.test(raw)) return { error: 'no session in URL' };
    if (raw.length < 8 || /\s/.test(raw)) return { error: 'not a key' };
    return { key: raw };
  }

  function applySubscriptionHeaders(headers, sub) {
    var key = asKey((sub || loadSubscription() || {}).key);
    if (!key) return headers || {};
    var out = {};
    var src = headers || {};
    Object.keys(src).forEach(function (k) { out[k] = src[k]; });
    out.authorization = 'Bearer ' + key;
    return out;
  }

  function bearerAuthorization(sub) {
    var key = asKey((sub || loadSubscription() || {}).key);
    return key ? ('Bearer ' + key) : '';
  }

  async function billingJson(url, init) {
    var r = await fetch(url, init);
    var body = await r.json().catch(function () { return {}; });
    return { http: r.status, body: body };
  }

  async function billingTiers(fetchFn) {
    var fn = fetchFn || fetch;
    var r = await fn(BILLING_ORIGIN + '/api/billing/tiers');
    var body = await r.json().catch(function () { return {}; });
    if (!body || !body.ok || !Array.isArray(body.tiers)) {
      throw new Error((body && body.error) || ('tiers HTTP ' + r.status));
    }
    return body;
  }

  async function fetchBillingKey(session, fetchFn) {
    var sid = String(session || '').trim();
    if (!sid) return { ok: false, error: 'session required' };
    var fn = fetchFn || fetch;
    var r = await fn(BILLING_ORIGIN + '/api/billing/key?session=' + encodeURIComponent(sid));
    var body = await r.json().catch(function () { return {}; });
    return body && typeof body === 'object' ? body : { ok: false, error: 'empty key response' };
  }

  function ingestBillingKeyResponse(body, extra) {
    var key = asKey(body && body.key);
    if (!key) {
      if (body && body.pending) return { ok: true, pending: true, saved: false };
      return { ok: false, pending: false, saved: false, error: (body && body.error) || 'no key yet' };
    }
    var rec = saveSubscription({
      key: key,
      tier: (body && body.tier) || (extra && extra.tier) || null,
      tierName: (body && (body.tierName || body.name)) || (extra && extra.tierName) || null,
      sessionId: (extra && (extra.sessionId || extra.session)) || null
    });
    return { ok: true, pending: false, saved: true, view: subscriptionPublicView(rec) };
  }

  var api = {
    BILLING_ORIGIN: BILLING_ORIGIN,
    SUBSCRIPTIONS_PAGE: SUBSCRIPTIONS_PAGE,
    STORE: STORE,
    asKey: asKey,
    setMemoryStore: setMemoryStore,
    saveSubscription: saveSubscription,
    clearSubscription: clearSubscription,
    loadSubscription: loadSubscription,
    hasSubscriptionKey: hasSubscriptionKey,
    subscriptionPublicView: subscriptionPublicView,
    parseSubscriptionPaste: parseSubscriptionPaste,
    applySubscriptionHeaders: applySubscriptionHeaders,
    bearerAuthorization: bearerAuthorization,
    billingTiers: billingTiers,
    fetchBillingKey: fetchBillingKey,
    ingestBillingKeyResponse: ingestBillingKeyResponse
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooSub = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
