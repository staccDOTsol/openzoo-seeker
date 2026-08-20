/* OpenZoo Seeker — x402 payment + Solana rail picker.
   No Solana libraries. The gateway builds the unsigned tx; the shell signs it.
   NEVER call MWA.signAndSendTransaction from this path.

   Screen labels match chat.openzoo.fun: USDC / TOKEN / LEOS only.
   Never print yUSDCx / wTOKENx / wLEOSx. Those are settlement plumbing.

   /v1/pay/build was verified 2026-08-20 as transfer-only (ComputeBudget +
   Token-2022 TransferChecked). No wrap program, no underlying mint in the
   account list. loader.js claims wrap+transfer; do not assume it. If that
   changes, flip BUILD_WRAPS after another real POST decode.
*/
(function (root) {
  'use strict';

  var GATEWAY = 'https://x402-tokens.fly.dev';
  var AUTH = 'Bearer openzoo-seeker';

  // Verified live 2026-08-20: pay/build does NOT assemble wrap+transfer.
  var BUILD_WRAPS = false;

  var MINTS = {
    YUSDCX: '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv',
    WTOKENX: 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9',
    WTOKENX_LIVE: 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B',
    WLEOSX: '3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    TOKEN: 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump',
    LEOS: '5xgsnby6P9zqGK71J7H4yJLxzqPvNbC7rDZxNzjHmj7e'
  };

  // Twin symbol / mint → the ONLY names allowed on screen.
  var DISPLAY = {
    yUSDCx: 'USDC', wTOKENx: 'TOKEN', wLEOSx: 'LEOS',
    USDC: 'USDC', TOKEN: 'TOKEN', LEOS: 'LEOS'
  };

  var RAILS = {
    USDC: {
      label: 'USDC',
      underlying: MINTS.USDC,
      twins: [MINTS.YUSDCX],
      symbols: ['yUSDCx', 'USDC']
    },
    TOKEN: {
      label: 'TOKEN',
      underlying: MINTS.TOKEN,
      twins: [MINTS.WTOKENX, MINTS.WTOKENX_LIVE],
      symbols: ['wTOKENx', 'TOKEN']
    },
    LEOS: {
      label: 'LEOS',
      underlying: MINTS.LEOS,
      twins: [MINTS.WLEOSX],
      symbols: ['wLEOSx', 'LEOS']
    }
  };

  var TWIN_TO_LABEL = {};
  Object.keys(RAILS).forEach(function (label) {
    RAILS[label].twins.forEach(function (mint) { TWIN_TO_LABEL[mint] = label; });
  });

  var TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  var RPCS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com'
  ];

  function toBig(v) {
    if (typeof v === 'bigint') return v;
    if (v == null || v === '') return 0n;
    try { return BigInt(String(v)); } catch (_) { return 0n; }
  }

  function isSolanaNetwork(network) {
    return typeof network === 'string' && network.indexOf('solana:') === 0;
  }

  function solanaAccepts(accepts) {
    var out = [];
    var list = accepts || [];
    for (var i = 0; i < list.length; i++) {
      if (isSolanaNetwork(list[i].network)) out.push(list[i]);
    }
    return out;
  }

  function displaySymbol(row) {
    var raw = row && row.extra && row.extra.symbol;
    if (raw && DISPLAY[raw]) return DISPLAY[raw];
    if (row && row.asset && TWIN_TO_LABEL[row.asset]) return TWIN_TO_LABEL[row.asset];
    if (raw && (raw === 'yUSDCx' || raw === 'wTOKENx' || raw === 'wLEOSx')) {
      return DISPLAY[raw];
    }
    return 'token';
  }

  function fundMessage(solRows) {
    var labels = ['USDC', 'TOKEN'];
    (solRows || []).forEach(function (row) {
      if (displaySymbol(row) === 'LEOS' && labels.indexOf('LEOS') < 0) labels.push('LEOS');
    });
    return 'Fund this wallet with ' + labels.join(' / ');
  }

  function findAcceptForRail(accepts, rail) {
    var want = String(rail || '').toUpperCase();
    var spec = RAILS[want];
    var sol = solanaAccepts(accepts);
    for (var i = 0; i < sol.length; i++) {
      var row = sol[i];
      if (displaySymbol(row) === want) return row;
      if (spec && spec.twins.indexOf(row.asset) >= 0) return row;
      var raw = row.extra && row.extra.symbol;
      if (spec && raw && spec.symbols.indexOf(raw) >= 0) return row;
    }
    return null;
  }

  function canCoverMint(mint, need, balances) {
    return toBig(balances && balances[mint]) >= need && need > 0n;
  }

  function assessCoverage(row, balances, solRows) {
    var need = toBig(row.maxAmountRequired);
    if (canCoverMint(row.asset, need, balances)) {
      return { ok: true, accept: row };
    }

    var label = displaySymbol(row);
    var spec = RAILS[label];
    var unwrapped = spec && toBig(balances && balances[spec.underlying]) > 0n;
    var reason = fundMessage(solRows);

    if (unwrapped && !BUILD_WRAPS) {
      return {
        ok: false,
        code: 'unwrapped-only',
        reason: reason,
        details: { rail: label, wrap: false }
      };
    }

    return {
      ok: false,
      code: 'no-balance',
      reason: reason,
      details: { rail: label, wrap: BUILD_WRAPS }
    };
  }

  /**
   * Map the user's USDC / TOKEN / LEOS button onto one Solana accept row.
   * Never defaults to accepts[0]. Never returns an eip155 row.
   * preferredRail is required — that is the button.
   */
  function pickPayableRail(accepts, balances, preferredRail) {
    if (!balances || typeof balances !== 'object') {
      return {
        ok: false,
        code: 'no-balances',
        reason: 'Token balances were not read. The app will not guess a rail.'
      };
    }

    var sol = solanaAccepts(accepts);
    if (!sol.length) {
      return {
        ok: false,
        code: 'no-solana',
        reason: 'This 402 has no Solana rail. Seeker only pays Solana rows.'
      };
    }

    if (!preferredRail) {
      return {
        ok: false,
        code: 'need-rail',
        reason: 'pick USDC, TOKEN, or LEOS'
      };
    }

    var accept = findAcceptForRail(sol, preferredRail);
    if (!accept) {
      return {
        ok: false,
        code: 'not-offered',
        reason: String(preferredRail).toUpperCase() + ' is not offered for this payment'
      };
    }

    return assessCoverage(accept, balances, sol);
  }

  function mergeMintMaps() {
    var out = {};
    for (var a = 0; a < arguments.length; a++) {
      var map = arguments[a] || {};
      Object.keys(map).forEach(function (mint) {
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
      if (!r.ok) throw new Error(rpcUrl + ' HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!Array.isArray(data) || data.length < 2) {
        throw new Error('unexpected rpc batch shape');
      }
      return mergeMintMaps(parseTokenAccounts(data[0]), parseTokenAccounts(data[1]));
    });
  }

  function fetchBalances(owner) {
    var errors = [];
    function next(i) {
      if (i >= RPCS.length) {
        var err = new Error(
          'Could not read token balances from a public Solana RPC. ' +
          'The app will not guess a rail.\n' + errors.join('\n')
        );
        err.code = 'balance-read-failed';
        throw err;
      }
      return fetchBalancesFrom(RPCS[i], owner).catch(function (e) {
        errors.push(RPCS[i] + ': ' + (e && e.message ? e.message : e));
        return next(i + 1);
      });
    }
    return next(0);
  }

  function encodePayment(envelope, signedTxB64) {
    var copy = {
      x402Version: envelope.x402Version,
      scheme: envelope.scheme,
      network: envelope.network,
      payload: {
        transaction: signedTxB64
      }
    };
    return btoa(JSON.stringify(copy));
  }

  function PayError(message, extra) {
    var e = new Error(message);
    e.name = 'PayError';
    if (extra) {
      e.code = extra.code;
      e.details = extra.details;
    }
    return e;
  }

  /**
   * fetch url; on 402 map the user's rail button → pay/build → parent-sign → X-PAYMENT.
   * ctx: { payer, signTransaction, preferredRail, onStatus, fetchBalances? }
   */
  function paidFetch(url, options, ctx) {
    ctx = ctx || {};
    var headers = Object.assign({
      authorization: AUTH
    }, options && options.headers ? options.headers : {});

    function once() {
      return fetch(url, Object.assign({}, options, { headers: headers }));
    }

    return once().then(function (res) {
      if (res.status !== 402) return res;
      if (!ctx.payer) {
        throw PayError('Connect a wallet first — this call needs a Solana x402 payment.');
      }
      return res.json().then(function (challenge) {
        var read = ctx.fetchBalances || fetchBalances;
        if (ctx.onStatus) ctx.onStatus('reading wallet balances…');
        return Promise.resolve(read(ctx.payer)).then(function (balances) {
          var pick = pickPayableRail(challenge.accepts, balances, ctx.preferredRail);
          if (!pick.ok) throw PayError(pick.reason, pick);
          if (ctx.onStatus) {
            ctx.onStatus('building ' + displaySymbol(pick.accept) + ' payment…');
          }
          return fetch(GATEWAY + '/v1/pay/build', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accept: pick.accept, payer: ctx.payer })
          }).then(function (builtRes) {
            return builtRes.json().then(function (built) {
              if (!builtRes.ok || !built.transaction) {
                throw PayError(
                  (built && (built.error || built.detail)) || 'pay/build failed'
                );
              }
              if (ctx.onStatus) ctx.onStatus('approve the payment in your wallet…');
              return Promise.resolve(ctx.signTransaction(built.transaction)).then(function (signed) {
                if (!signed) throw PayError('wallet returned an empty signature');
                var retryHeaders = Object.assign({}, headers, {
                  'X-PAYMENT': encodePayment(built.envelope, signed)
                });
                if (ctx.onStatus) ctx.onStatus('settling…');
                return fetch(url, Object.assign({}, options, { headers: retryHeaders }));
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
    BUILD_WRAPS: BUILD_WRAPS,
    MINTS: MINTS,
    RAILS: RAILS,
    DISPLAY: DISPLAY,
    RPCS: RPCS,
    toBig: toBig,
    isSolanaNetwork: isSolanaNetwork,
    solanaAccepts: solanaAccepts,
    displaySymbol: displaySymbol,
    findAcceptForRail: findAcceptForRail,
    pickPayableRail: pickPayableRail,
    fetchBalances: fetchBalances,
    encodePayment: encodePayment,
    paidFetch: paidFetch
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooPay = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
