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

  function fundMessage() {
    return 'Add USDC, TOKEN, or LEOS to this wallet to pay.';
  }

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
   * Ez-mode: pick the Solana row this wallet can actually cover, wrapping
   * TOKEN / USDC / LEOS (or the live twin) behind the scenes.
   */
  function pickPayablePlan(accepts, balances, kinds) {
    if (!balances || typeof balances !== 'object') {
      return { ok: false, code: 'no-balances', reason: 'Could not read this wallet.' };
    }
    var sol = solanaAccepts(accepts);
    if (!sol.length) {
      return { ok: false, code: 'no-solana', reason: 'This call has no Solana payment option.' };
    }

    var ranked = sol.map(function (row) {
      var score = holdingScore(row, balances, kinds);
      return { row: row, score: score };
    }).sort(function (a, b) { return b.score.prefer - a.score.prefer; });

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
        label: displaySymbol(accept)
      };
    }

    return { ok: false, code: 'no-balance', reason: fundMessage() };
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

  function PayError(message, extra) {
    var e = new Error(wrap.stripTwinHomework(message));
    e.name = 'PayError';
    if (extra) {
      e.code = extra.code;
      e.details = extra.details;
    }
    return e;
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

  async function topUpIfNeeded(plan, ctx) {
    if (!plan.wrap) return;
    var pool = plan.wrap.pool;
    if (ctx.onStatus) ctx.onStatus('topping up…');
    var state = await poolState(pool);
    var deposit = wrap.depositForShares(plan.wrap.sharesNeeded, state.reserves, state.supply);
    var haveUnder = toBig(ctx.balances && ctx.balances[pool.underlying]);
    if (haveUnder < deposit) {
      throw PayError(fundMessage(), { code: 'underfunded' });
    }
    var blockhash = await latestBlockhash();
    if (!blockhash) throw PayError('Could not prepare a top-up.');
    var built = wrap.compileWrapTransaction(pool, ctx.payer, deposit, blockhash, ctx.payer);
    if (!ctx.signAndSendTransaction) {
      throw PayError('This wallet cannot top up from here.');
    }
    if (ctx.onStatus) ctx.onStatus('approve the top-up in your wallet…');
    var sig = await ctx.signAndSendTransaction(built.transaction);
    if (!sig) throw PayError('Top-up was not approved.');
    await confirmSignature(sig);
    return sig;
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
    var plan = pickPayablePlan(fake, balances, kinds);
    if (!plan.ok) throw PayError(plan.reason, plan);
    if (!plan.wrap) return { wrapped: false, reason: 'ready' };
    return topUpIfNeeded(plan, {
      payer: payer,
      balances: balances,
      signAndSendTransaction: signAndSendTransaction,
      onStatus: onStatus
    }).then(function (sig) {
      return { wrapped: true, signature: sig };
    });
  }

  /**
   * fetch url; on 402: live directory → holdings → wrap if needed → pay/build
   * → partial-sign → X-PAYMENT. Never broadcasts the payment tx.
   */
  function paidFetch(url, options, ctx) {
    ctx = ctx || {};
    var headers = Object.assign({ authorization: AUTH }, options && options.headers ? options.headers : {});

    function once(extraHeaders) {
      return fetch(url, Object.assign({}, options, {
        headers: Object.assign({}, headers, extraHeaders || {})
      }));
    }

    return once().then(function (res) {
      if (res.status !== 402) return res;
      if (!ctx.payer) {
        throw PayError('Connect a wallet first — this call is paid from your wallet.');
      }
      return res.json().then(function (challenge) {
        var read = ctx.fetchBalances || fetchBalances;
        var dir = ctx.fetchSupported || wrap.fetchSupported;
        if (ctx.onStatus) ctx.onStatus('checking this wallet…');
        return Promise.all([
          Promise.resolve(read(ctx.payer)),
          Promise.resolve(dir())
        ]).then(function (pair) {
          var balances = pair[0];
          var kinds = pair[1];
          var plan = pickPayablePlan(challenge.accepts, balances, kinds);
          if (!plan.ok) throw PayError(plan.reason, plan);
          ctx.balances = balances;
          return Promise.resolve(topUpIfNeeded(plan, ctx)).then(function () {
            if (ctx.onStatus) ctx.onStatus('building payment…');
            return fetch(GATEWAY + '/v1/pay/build', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ accept: plan.accept, payer: ctx.payer })
            }).then(function (builtRes) {
              return builtRes.json().then(function (built) {
                if (!builtRes.ok || !built.transaction) {
                  throw PayError((built && (built.error || built.detail)) || 'payment build failed');
                }
                if (ctx.onStatus) ctx.onStatus('approve the payment in your wallet…');
                return Promise.resolve(ctx.signTransaction(built.transaction)).then(function (signed) {
                  if (!signed) throw PayError('wallet returned an empty signature');
                  if (ctx.onStatus) ctx.onStatus('settling…');
                  return once({ 'X-PAYMENT': encodePayment(built.envelope, signed) });
                });
              });
            });
          });
        });
      });
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
    fundMessage: fundMessage,
    fetchBalances: fetchBalances,
    pickPayablePlan: pickPayablePlan,
    encodePayment: encodePayment,
    paidFetch: paidFetch,
    visibleHoldings: visibleHoldings,
    poolState: poolState,
    topUpFromHoldings: topUpFromHoldings
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooPay = api;
})(typeof window !== 'undefined' ? window : globalThis);
