/* OpenZoo Seeker — live 402 rails + ez-mode wrap + partial-sign pay.
   402 pay: MWA.signTransaction only (never broadcast).
   Wrap / top-up: MWA.signAndSendTransaction is allowed. */
(function (root) {
  'use strict';

  var wrap = (typeof module !== 'undefined' && module.exports)
    ? require('./wrap.js')
    : root.OpenZooWrap;

  var GATEWAY = 'https://x402-tokens.fly.dev';
  var AUTH = 'Bearer openzoo-seeker';
  var TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var RPCS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com'
  ];

  var HOLDING_MINTS = {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    TOKEN: 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump',
    LEOS: '5xgsnby6P9zqGK71J7H4yJLxzqPvNbC7rDZxNzjHmj7e'
  };

  function toBig(v) {
    if (typeof v === 'bigint') return v;
    if (v == null || v === '') return 0n;
    try { return BigInt(String(v)); } catch (_) { return 0n; }
  }

  function solanaAccepts(accepts) {
    var out = [];
    (accepts || []).forEach(function (row) {
      if (!wrap.isSolanaNetwork(row && row.network)) return;
      if (wrap.isDrainedMint(row.asset)) return;
      out.push(row);
    });
    return out;
  }

  function displaySymbol(row) {
    var raw = row && row.extra && row.extra.symbol;
    return wrap.userLabelFor(raw, row && row.asset);
  }

  var COPY = {
    wrap: function (label) {
      return 'You have ' + (label || 'TOKEN') + '. Wrap enough to send this?';
    },
    shortSol: 'Needs a little SOL for the network fee',
    shortTokens: 'Send TOKEN, USDC, or LEOS to this wallet.',
    copied: 'Copied',
    wrapCancelled: 'Wrap cancelled.'
  };

  function fundMessage() {
    return COPY.shortTokens;
  }

  var MIN_WRAP_SOL = 3000000n;

  function mergeMintMaps() {
    var out = {};
    for (var a = 0; a < arguments.length; a++) {
      var map = arguments[a] || {};
      Object.keys(map).forEach(function (mint) {
        if (wrap.isDrainedMint(mint)) return;
        out[mint] = (toBig(out[mint]) + toBig(map[mint])).toString();
      });
    }
    return out;
  }

  function parseTokenAccounts(rpcItem) {
    var out = {};
    if (!rpcItem || rpcItem.error) {
      var msg = rpcItem && rpcItem.error && rpcItem.error.message
        ? rpcItem.error.message
        : 'rpc error';
      throw new Error(msg);
    }
    var value = rpcItem.result && rpcItem.result.value ? rpcItem.result.value : [];
    for (var i = 0; i < value.length; i++) {
      var info = value[i] && value[i].account && value[i].account.data &&
        value[i].account.data.parsed && value[i].account.data.parsed.info;
      if (!info || !info.mint || !info.tokenAmount) continue;
      if (wrap.isDrainedMint(info.mint)) continue;
      var amount = info.tokenAmount.amount;
      if (amount == null) continue;
      out[info.mint] = (toBig(out[info.mint]) + toBig(amount)).toString();
    }
    return out;
  }

  function fetchBalancesFrom(rpcUrl, owner) {
    var body = JSON.stringify([
      {
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
        params: [owner, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]
      },
      {
        jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
        params: [owner, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed' }]
      }
    ]);
    return fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('balance read failed');
      return r.json();
    }).then(function (data) {
      if (!Array.isArray(data) || data.length < 2) throw new Error('balance read failed');
      return mergeMintMaps(parseTokenAccounts(data[0]), parseTokenAccounts(data[1]));
    });
  }

  function fetchBalances(owner) {
    var errors = [];
    function next(i) {
      if (i >= RPCS.length) {
        var err = new Error('Could not read this wallet. Try again on the phone network.');
        err.code = 'balance-read-failed';
        throw err;
      }
      return fetchBalancesFrom(RPCS[i], owner).catch(function (e) {
        errors.push(e && e.message ? e.message : e);
        return next(i + 1);
      });
    }
    return next(0);
  }

  function rpcCall(method, params) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params });
    function next(i) {
      if (i >= RPCS.length) throw new Error('Could not reach Solana.');
      return fetch(RPCS[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body
      }).then(function (r) {
        if (!r.ok) throw new Error('rpc http');
        return r.json();
      }).then(function (j) {
        if (j.error) throw new Error('rpc');
        return j.result;
      }).catch(function () { return next(i + 1); });
    }
    return next(0);
  }

  function poolState(pool) {
    return Promise.all([
      rpcCall('getTokenAccountBalance', [pool.escrow]).then(function (r) {
        return toBig(r && r.value && r.value.amount);
      }).catch(function () { return 0n; }),
      rpcCall('getTokenSupply', [pool.wrapped]).then(function (r) {
        return toBig(r && r.value && r.value.amount);
      }).catch(function () { return 0n; })
    ]).then(function (pair) {
      return { reserves: pair[0], supply: pair[1] };
    });
  }

  function latestBlockhash() {
    return rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]).then(function (r) {
      return r && r.value && r.value.blockhash;
    });
  }

  function holdingScore(row, balances, kinds) {
    var haveTwin = toBig(balances && balances[row.asset]);
    var pool = wrap.resolvePool(kinds, row.asset);
    var haveUnder = pool ? toBig(balances && balances[pool.underlying]) : 0n;
    var label = displaySymbol(row);
    var prefer = 0;
    if (label === 'TOKEN' && toBig(balances && balances[HOLDING_MINTS.TOKEN]) > 0n) prefer = 3;
    else if (label === 'USDC' && toBig(balances && balances[HOLDING_MINTS.USDC]) > 0n) prefer = 2;
    else if (label === 'LEOS' && toBig(balances && balances[HOLDING_MINTS.LEOS]) > 0n) prefer = 1;
    if (haveTwin > 0n) prefer += 4;
    return { haveTwin: haveTwin, haveUnder: haveUnder, prefer: prefer, pool: pool };
  }

  /**
   * Ez-mode picker. Gate wrap on held underlying > 0. NEVER compare
   * underlying raw 1:1 to twin maxAmountRequired — $10 TOKEN is useful
   * even when the quoted twin raw is larger. Sufficiency is depositForShares.
   */
  function pickLargestUseful(accepts, balances, kinds) {
    if (!balances || typeof balances !== 'object') {
      return { ok: false, code: 'no-balances', reason: 'Could not read this wallet.', prompt: 'short-tokens' };
    }
    var sol = solanaAccepts(accepts);
    if (!sol.length) {
      return { ok: false, code: 'no-solana', reason: 'This call has no Solana payment option.' };
    }

    var ranked = sol.map(function (row) {
      var score = holdingScore(row, balances, kinds);
      return { row: row, score: score };
    }).sort(function (a, b) {
      if (b.score.prefer !== a.score.prefer) return b.score.prefer - a.score.prefer;
      if (b.score.haveUnder === a.score.haveUnder) return 0;
      return b.score.haveUnder > a.score.haveUnder ? 1 : -1;
    });

    for (var i = 0; i < ranked.length; i++) {
      var row = ranked[i].row;
      var need = toBig(row.maxAmountRequired);
      var have = toBig(balances[row.asset]);
      if (need > 0n && have >= need) {
        return { ok: true, accept: row, wrap: null, label: displaySymbol(row) };
      }
    }

    for (var j = 0; j < ranked.length; j++) {
      var plan = ranked[j];
      var accept = plan.row;
      var pool = plan.score.pool;
      if (!pool) continue;
      var short = toBig(accept.maxAmountRequired) - plan.score.haveTwin;
      if (short <= 0n) {
        return { ok: true, accept: accept, wrap: null, label: displaySymbol(accept) };
      }
      if (plan.score.haveUnder <= 0n) continue;
      return {
        ok: true,
        accept: accept,
        wrap: {
          pool: pool,
          sharesNeeded: short.toString(),
          from: wrap.userLabelFor(pool.underlyingSymbol, pool.underlying)
        },
        label: displaySymbol(accept),
        prompt: 'wrap',
        promptCopy: COPY.wrap(wrap.userLabelFor(pool.underlyingSymbol, pool.underlying))
      };
    }

    return {
      ok: false,
      code: 'no-balance',
      reason: fundMessage(),
      prompt: 'short-tokens',
      promptCopy: COPY.shortTokens
    };
  }

  function pickPayablePlan(accepts, balances, kinds) {
    return pickLargestUseful(accepts, balances, kinds);
  }

  function fetchSolBalance(owner) {
    return rpcCall('getBalance', [owner]).then(function (r) {
      return { ok: true, lamports: toBig(r && (r.value != null ? r.value : r)) };
    }).catch(function () { return { ok: false, lamports: 0n }; });
  }

  function looksNoSol(text) {
    var s = String(text || '').toLowerCase();
    return /no sol|insufficient.*lamports|insufficient funds for (rent|fee)|need .*sol\b|0x1\b.*lamport/.test(s);
  }

  function looksUnderfunded(text) {
    var s = String(text || '').toLowerCase();
    return /insufficient|underfund|not enough|0x1\b|custom program error: 1|simulation failed|failed_settle|insufficientfunds|no token account/.test(s);
  }

  function looksBackgrounded(text) {
    var s = String(text || '').toLowerCase();
    return /timed out|timeout|background|session (closed|destroyed|lost)|activity|interrupted|canceled|cancelled|user rejected/.test(s);
  }

  function encodePayment(envelope, signedTxB64) {
    var copy = {
      x402Version: envelope.x402Version,
      scheme: envelope.scheme,
      network: envelope.network,
      payload: { transaction: signedTxB64 }
    };
    var json = JSON.stringify(copy);
    if (typeof btoa === 'function') return btoa(json);
    return Buffer.from(json, 'utf8').toString('base64');
  }

  var PENDING_KEY = 'openzoo.seeker.pending402.v1';
  var memStore = {};
  var resumeWaiters = [];
  var NET_RE = /load failed|failed to fetch|failed to load|networkerror|typeerror|net::|err_internet|err_connection|err_name_not_resolved|offline|interrupted|abort|the internet connection appears to be offline|network request failed/i;

  function defaultStore() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (_) {}
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
      setItem: function (k, v) { memStore[k] = String(v); },
      removeItem: function (k) { delete memStore[k]; }
    };
  }

  function storeOf(ctx) {
    return (ctx && ctx.store) || defaultStore();
  }

  function savePending402(record, ctx) {
    record = record || {};
    record.at = Date.now();
    try { storeOf(ctx).setItem(PENDING_KEY, JSON.stringify(record)); } catch (_) {}
    return record;
  }

  function loadPending402(ctx) {
    try {
      var raw = storeOf(ctx).getItem(PENDING_KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || typeof rec !== 'object') return null;
      if (Date.now() - (rec.at || 0) > 10 * 60 * 1000) {
        clearPending402(ctx);
        return null;
      }
      return rec;
    } catch (_) { return null; }
  }

  function clearPending402(ctx) {
    try { storeOf(ctx).removeItem(PENDING_KEY); } catch (_) {}
  }

  function isTransientNetworkError(err) {
    if (!err) return false;
    var name = err.name || '';
    var msg = String(err.message || err || '');
    if (name === 'NetworkError' || name === 'AbortError') return true;
    if (name === 'TypeError' && (!err.message || NET_RE.test(msg))) return true;
    return NET_RE.test(msg);
  }

  function friendlyNetworkMessage(err) {
    return 'Connection dropped while the wallet app was open. The payment retries when you return.';
  }

  function humanizeError(err) {
    var raw = String((err && err.message) || err || '');
    if (isTransientNetworkError(err) || NET_RE.test(raw) || /typeerror|load failed|failed to fetch/i.test(raw)) {
      return friendlyNetworkMessage(err);
    }
    if (!raw) return 'Something went wrong.';
    return wrap.stripTwinHomework(raw);
  }

  function notifyResume() {
    var list = resumeWaiters.slice();
    resumeWaiters = [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (_) {}
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function waitForForeground(ctx) {
    if (ctx && ctx.waitForForeground) return Promise.resolve(ctx.waitForForeground());
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        resolve();
      }
      resumeWaiters.push(done);
      document.addEventListener('visibilitychange', function onVis() {
        if (document.visibilityState !== 'hidden') {
          document.removeEventListener('visibilitychange', onVis);
          done();
        }
      });
      setTimeout(done, 120000);
    });
  }

  function afterWalletReturn(ctx) {
    var extra = ctx && ctx.resumeDelayMs != null ? ctx.resumeDelayMs : 350;
    return waitForForeground(ctx).then(function () { return delay(extra); });
  }

  function fetchWithResumeRetry(url, options, ctx) {
    var doFetch = (ctx && ctx.fetch) || fetch;
    var tries = 0;
    var max = (ctx && ctx.maxNetRetries) || 5;
    function go() {
      return Promise.resolve(doFetch(url, options)).catch(function (err) {
        tries += 1;
        if (!isTransientNetworkError(err) || tries > max) {
          throw PayError(humanizeError(err), { code: 'network' });
        }
        if (ctx && ctx.onStatus) ctx.onStatus('reconnecting…');
        var backoff = delay(200 * tries);
        return waitForForeground(ctx).then(function () { return backoff; }).then(go);
      });
    }
    return go();
  }

  function PayError(message, extra) {
    extra = extra || {};
    var e = new Error(wrap.stripTwinHomework(message));
    e.name = 'PayError';
    e.code = extra.code;
    e.details = extra.details;
    e.prompt = extra.prompt || extra.code;
    e.promptCopy = extra.promptCopy || message;
    e.address = extra.address;
    e.holdings = extra.holdings;
    return e;
  }

  function shortTokensError(ctx, balances, kinds) {
    return PayError(COPY.shortTokens, {
      code: 'short-tokens',
      prompt: 'short-tokens',
      promptCopy: COPY.shortTokens,
      address: ctx && ctx.payer,
      holdings: visibleHoldings(balances, kinds)
    });
  }

  function shortSolError(ctx) {
    return PayError(COPY.shortSol, {
      code: 'short-sol',
      prompt: 'short-sol',
      promptCopy: COPY.shortSol,
      address: ctx && ctx.payer
    });
  }

  function visibleHoldings(balances, kinds) {
    var rows = [];
    var seen = {};
    function add(label, mint) {
      if (!mint || wrap.isDrainedMint(mint) || seen[mint]) return;
      var raw = toBig(balances && balances[mint]);
      if (raw <= 0n) return;
      seen[mint] = true;
      rows.push({ label: label, mint: mint, raw: raw.toString() });
    }
    add('USDC', HOLDING_MINTS.USDC);
    add('TOKEN', HOLDING_MINTS.TOKEN);
    add('LEOS', HOLDING_MINTS.LEOS);
    solanaKindsSafe(kinds).forEach(function (k) {
      var extra = k.extra || {};
      add(wrap.userLabelFor(extra.symbol, extra.asset), extra.asset);
    });
    return rows;
  }

  function solanaKindsSafe(kinds) {
    try { return wrap.solanaKinds(kinds); } catch (_) { return []; }
  }

  async function confirmWrapIfNeeded(plan, ctx) {
    if (!plan || !plan.wrap) return true;
    var label = plan.wrap.from || plan.label || 'TOKEN';
    if (!ctx || !ctx.confirmWrap) return true;
    return Promise.resolve(ctx.confirmWrap({
      label: label,
      message: COPY.wrap(label),
      plan: plan
    })).then(function (ok) { return ok !== false; });
  }

  async function topUpIfNeeded(plan, ctx) {
    if (!plan.wrap) return;
    var pool = plan.wrap.pool;
    if (ctx.onStatus) ctx.onStatus('topping up…');
    var state = await poolState(pool);
    var deposit = wrap.depositForShares(plan.wrap.sharesNeeded, state.reserves, state.supply);
    var haveUnder = toBig(ctx.balances && ctx.balances[pool.underlying]);
    if (haveUnder < deposit) {
      throw shortTokensError(ctx, ctx.balances, ctx.kinds);
    }
    var solKnown = ctx.solKnown === true;
    var sol = toBig(ctx.solLamports);
    if (ctx.solLamports == null) {
      var solRead = await fetchSolBalance(ctx.payer);
      sol = solRead.lamports;
      solKnown = solRead.ok;
      ctx.solLamports = sol.toString();
      ctx.solKnown = solKnown;
    }
    if (solKnown && sol < MIN_WRAP_SOL) {
      throw shortSolError(ctx);
    }
    var blockhash = await latestBlockhash();
    if (!blockhash) throw PayError('Could not prepare a top-up.');
    var built = wrap.compileWrapTransaction(pool, ctx.payer, deposit, blockhash, ctx.payer);
    if (!ctx.signAndSendTransaction) {
      throw PayError('This wallet cannot top up from here.');
    }
    if (ctx.onStatus) ctx.onStatus('approve the top-up in your wallet…');
    try {
      var sig = await ctx.signAndSendTransaction(built.transaction);
      if (!sig) throw PayError('Top-up was not approved.');
      await confirmSignature(sig);
      return sig;
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (e && e.prompt) throw e;
      if (looksNoSol(msg)) throw shortSolError(ctx);
      if (looksUnderfunded(msg) && !looksBackgrounded(msg) && !isTransientNetworkError(e)) {
        throw shortTokensError(ctx, ctx.balances, ctx.kinds);
      }
      throw e;
    }
  }

  function confirmSignature(signature) {
    var deadline = Date.now() + 90000;
    function once() {
      return rpcCall('getSignatureStatuses', [[signature]]).then(function (res) {
        var st = res && res.value && res.value[0];
        if (st && st.err) throw PayError('Top-up failed on-chain.');
        if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
          return signature;
        }
        if (Date.now() >= deadline) throw PayError('Top-up is taking too long. Try the call again.');
        return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(once);
      });
    }
    return once();
  }

  async function topUpFromHoldings(payer, signAndSendTransaction, onStatus) {
    var kinds = await wrap.fetchSupported();
    var balances = await fetchBalances(payer);
    var fake = wrap.solanaKinds(kinds).map(function (k) {
      return {
        scheme: 'exact',
        network: k.network,
        asset: k.extra.asset,
        maxAmountRequired: '1',
        extra: { symbol: k.extra.symbol, decimals: k.extra.decimals }
      };
    });
    var plan = pickLargestUseful(fake, balances, kinds);
    if (!plan.ok) throw PayError(plan.reason, plan);
    if (!plan.wrap) return { wrapped: false, reason: 'ready' };
    var extras = (onStatus && typeof onStatus === 'object') ? onStatus : { onStatus: onStatus };
    var ctx = {
      payer: payer,
      balances: balances,
      kinds: kinds,
      signAndSendTransaction: signAndSendTransaction,
      onStatus: extras.onStatus || (typeof onStatus === 'function' ? onStatus : null),
      confirmWrap: extras.confirmWrap
    };
    return confirmWrapIfNeeded(plan, ctx).then(function (ok) {
      if (!ok) throw PayError(COPY.wrapCancelled, { code: 'wrap-cancelled' });
      return topUpIfNeeded(plan, ctx);
    }).then(function (sig) {
      return { wrapped: true, signature: sig };
    });
  }

  /**
   * fetch url; on 402: persist the challenge, live directory → holdings →
   * wrap if needed → wait for MWA resume → pay/build (retried if the
   * WebView dropped the socket) → partial-sign → X-PAYMENT.
   * Never broadcasts the payment tx. Never surfaces raw "Load failed" /
   * TypeError from the WebView.
   */
  function paidFetch(url, options, ctx) {
    ctx = ctx || {};
    var headers = Object.assign({ authorization: AUTH }, options && options.headers ? options.headers : {});
    clearPending402(ctx);

    function once(extraHeaders) {
      return fetchWithResumeRetry(url, Object.assign({}, options, {
        headers: Object.assign({}, headers, extraHeaders || {})
      }), ctx);
    }

    function persist(extra) {
      var prev = loadPending402(ctx) || {};
      return savePending402(Object.assign({}, prev, extra, {
        url: url,
        payer: ctx.payer
      }), ctx);
    }

    function settle(envelope, signed) {
      if (ctx.onStatus) ctx.onStatus('settling…');
      persist({ step: 'settle', envelope: envelope, signedTx: signed });
      return once({ 'X-PAYMENT': encodePayment(envelope, signed) }).then(function (res) {
        clearPending402(ctx);
        return res;
      });
    }

    function buildAndPay(plan) {
      persist({ step: 'build', accept: plan.accept, wrapDone: true, label: plan.label });
      if (ctx.onStatus) ctx.onStatus('building payment…');
      return fetchWithResumeRetry(GATEWAY + '/v1/pay/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accept: plan.accept, payer: ctx.payer })
      }, ctx).then(function (builtRes) {
        return builtRes.json().then(function (built) {
          if (!builtRes.ok || !built.transaction) {
            throw PayError(humanizeError((built && (built.error || built.detail)) || 'Could not build the payment.'));
          }
          persist({
            step: 'sign',
            unsignedTx: built.transaction,
            envelope: built.envelope,
            accept: plan.accept
          });
          if (ctx.onStatus) ctx.onStatus('approve the payment in your wallet…');
          return Promise.resolve(ctx.signTransaction(built.transaction)).then(function (signed) {
            if (!signed) throw PayError('wallet returned an empty signature');
            return afterWalletReturn(ctx).then(function () {
              return settle(built.envelope, signed);
            });
          });
        });
      });
    }

    function fromChallenge(challenge) {
      persist({ step: 'plan', challenge: challenge });
      var pending = loadPending402(ctx);
      var read = ctx.fetchBalances || fetchBalances;
      var dir = ctx.fetchSupported || wrap.fetchSupported;
      if (ctx.onStatus) ctx.onStatus('checking this wallet…');
      return Promise.all([
        Promise.resolve(read(ctx.payer)).catch(function (e) {
          throw PayError(humanizeError(e), { code: 'balance-read-failed' });
        }),
        Promise.resolve(dir())
      ]).then(function (pair) {
        var balances = pair[0];
        var kinds = pair[1];
        var plan;
        if (pending && pending.accept && pending.wrapDone) {
          plan = { ok: true, accept: pending.accept, wrap: null, label: pending.label };
        } else {
          plan = pickLargestUseful(challenge.accepts, balances, kinds);
        }
        if (!plan.ok) {
          throw PayError(plan.reason, {
            code: plan.code,
            prompt: plan.prompt || (plan.code === 'no-balance' ? 'short-tokens' : plan.code),
            promptCopy: plan.promptCopy || plan.reason,
            address: ctx.payer,
            holdings: visibleHoldings(balances, kinds)
          });
        }
        ctx.balances = balances;
        ctx.kinds = kinds;
        persist({
          step: plan.wrap ? 'wrap' : 'build',
          accept: plan.accept,
          label: plan.label,
          challenge: challenge
        });
        return Promise.resolve(confirmWrapIfNeeded(plan, ctx)).then(function (ok) {
          if (!ok) {
            clearPending402(ctx);
            throw PayError(COPY.wrapCancelled, { code: 'wrap-cancelled' });
          }
          return Promise.resolve(topUpIfNeeded(plan, ctx)).then(function (sig) {
            persist({ wrapDone: true, step: 'build' });
            var wait = sig ? afterWalletReturn(ctx) : Promise.resolve();
            return wait.then(function () { return buildAndPay(plan); });
          });
        });
      });
    }

    return once().then(function (res) {
      if (res.status !== 402) {
        clearPending402(ctx);
        return res;
      }
      if (!ctx.payer) {
        throw PayError('Connect a wallet first — this call is paid from your wallet.');
      }
      return res.json().then(function (challenge) {
        persist({ step: 'plan', challenge: challenge });
        return fromChallenge(challenge);
      });
    }).catch(function (err) {
      if (err && err.name === 'PayError') throw err;
      throw PayError(humanizeError(err), { code: err && err.code });
    });
  }

  var api = {
    GATEWAY: GATEWAY,
    AUTH: AUTH,
    RPCS: RPCS,
    HOLDING_MINTS: HOLDING_MINTS,
    toBig: toBig,
    solanaAccepts: solanaAccepts,
    displaySymbol: displaySymbol,
    COPY: COPY,
    MIN_WRAP_SOL: MIN_WRAP_SOL,
    fundMessage: fundMessage,
    fetchBalances: fetchBalances,
    fetchSolBalance: fetchSolBalance,
    pickLargestUseful: pickLargestUseful,
    pickPayablePlan: pickPayablePlan,
    encodePayment: encodePayment,
    paidFetch: paidFetch,
    visibleHoldings: visibleHoldings,
    poolState: poolState,
    topUpFromHoldings: topUpFromHoldings,
    PENDING_KEY: PENDING_KEY,
    savePending402: savePending402,
    loadPending402: loadPending402,
    clearPending402: clearPending402,
    isTransientNetworkError: isTransientNetworkError,
    humanizeError: humanizeError,
    notifyResume: notifyResume,
    afterWalletReturn: afterWalletReturn,
    fetchWithResumeRetry: fetchWithResumeRetry,
    looksNoSol: looksNoSol,
    looksUnderfunded: looksUnderfunded,
    looksBackgrounded: looksBackgrounded
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooPay = api;
})(typeof window !== 'undefined' ? window : globalThis);
