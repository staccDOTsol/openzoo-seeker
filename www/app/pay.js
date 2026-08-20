/* OpenZoo Seeker — x402 payment + Solana rail picker.
   No Solana libraries. The gateway builds the unsigned tx; the shell signs it.
   NEVER call MWA.signAndSendTransaction from this path.
*/
(function (root) {
  'use strict';

  var GATEWAY = 'https://x402-tokens.fly.dev';
  var AUTH = 'Bearer openzoo-seeker';

  var MINTS = {
    YUSDCX: '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv',
    WTOKENX: 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B',
    WLEOSX: '3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    TOKEN: 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump'
  };

  // Known unwraps for steering copy. Quoted twins we don't recognize are
  // still eligible if the wallet already holds that exact settlement mint.
  var UNWRAP = {};
  UNWRAP[MINTS.YUSDCX] = { mint: MINTS.USDC, symbol: 'USDC', wrappedSymbol: 'yUSDCx' };
  UNWRAP[MINTS.WTOKENX] = { mint: MINTS.TOKEN, symbol: 'TOKEN', wrappedSymbol: 'wTOKENx' };

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

  function rowSymbol(row) {
    if (row && row.extra && row.extra.symbol) return row.extra.symbol;
    if (row && row.asset) return String(row.asset).slice(0, 8) + '…';
    return 'token';
  }

  function quotedSymbols(solRows) {
    var seen = {};
    var names = [];
    for (var i = 0; i < solRows.length; i++) {
      var s = rowSymbol(solRows[i]);
      if (!seen[s]) { seen[s] = true; names.push(s); }
    }
    return names;
  }

  function canCover(row, balances) {
    var have = toBig(balances && balances[row.asset]);
    var need = toBig(row.maxAmountRequired);
    return have >= need && need > 0n;
  }

  /**
   * Pick a Solana accept row the wallet can actually pay.
   * Never defaults to the first Solana row. Never returns an eip155 row.
   *
   * balances: { [mint: string]: string|number|bigint }
   * returns { ok:true, accept } | { ok:false, code, reason, details }
   */
  function pickPayableRail(accepts, balances) {
    if (!balances || typeof balances !== 'object') {
      return {
        ok: false,
        code: 'no-balances',
        reason: 'Token balances were not read. The app will not guess a rail (the first Solana row is often yUSDCx and fails simulation if you do not hold it).'
      };
    }

    var sol = solanaAccepts(accepts);
    if (!sol.length) {
      return {
        ok: false,
        code: 'no-solana',
        reason: 'This 402 has no Solana rail. Seeker only pays Solana rows — eip155 is not used.'
      };
    }

    var payable = [];
    for (var i = 0; i < sol.length; i++) {
      if (canCover(sol[i], balances)) payable.push(sol[i]);
    }

    if (payable.length === 1) {
      return { ok: true, accept: payable[0] };
    }
    if (payable.length > 1) {
      // Prefer a non-yUSDCx twin when more than one quoted mint covers.
      // This is the opposite of "take accepts[0]".
      var preferred = null;
      for (var j = 0; j < payable.length; j++) {
        if (payable[j].asset !== MINTS.YUSDCX) { preferred = payable[j]; break; }
      }
      return { ok: true, accept: preferred || payable[0] };
    }

    var unwrapHeld = [];
    var seenUnwrap = {};
    function noteUnwrap(pair, amount) {
      if (!pair || seenUnwrap[pair.mint]) return;
      if (toBig(amount) <= 0n) return;
      seenUnwrap[pair.mint] = true;
      unwrapHeld.push({
        mint: pair.mint,
        symbol: pair.symbol,
        wrappedSymbol: pair.wrappedSymbol,
        amount: String(amount)
      });
    }
    for (var k = 0; k < sol.length; k++) {
      var pair = UNWRAP[sol[k].asset];
      if (pair) noteUnwrap(pair, balances[pair.mint]);
    }
    noteUnwrap(UNWRAP[MINTS.YUSDCX], balances[MINTS.USDC]);
    noteUnwrap(UNWRAP[MINTS.WTOKENX], balances[MINTS.TOKEN]);

    var names = quotedSymbols(sol);
    var twins = names.join(', ');
    var details = { quoted: names, unwrapHeld: unwrapHeld, solanaRows: sol.length };

    if (unwrapHeld.length) {
      var held = unwrapHeld.map(function (u) { return u.symbol; }).join(' / ');
      return {
        ok: false,
        code: 'unwrapped-only',
        reason:
          'This app settles in NAV-wrapped Token-2022 twins (' + twins +
          '), not plain USDC or TOKEN. Your wallet holds unwrapped ' + held +
          '. yUSDCx wraps USDC; wTOKENx wraps TOKEN. Fund the matching wrapped twin, then try again. ' +
          'The app will not build a payment against yUSDCx (or any twin) you cannot pay.',
        details: details
      };
    }

    return {
      ok: false,
      code: 'no-balance',
      reason:
        'No payable Solana rail. Quoted settlement mints: ' + twins +
        '. A user holding only plain USDC holds neither yUSDCx nor wTOKENx. ' +
        'Fund a wrapped twin in this wallet, then retry.',
      details: details
    };
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
   * fetch url; on 402 pick a payable Solana rail, pay/build, parent-sign, retry with X-PAYMENT.
   * ctx: { payer, signTransaction(txB64)=>Promise<signedB64>, onStatus(msg), fetchBalances? }
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
          var pick = pickPayableRail(challenge.accepts, balances);
          if (!pick.ok) throw PayError(pick.reason, pick);
          if (ctx.onStatus) {
            ctx.onStatus('building ' + rowSymbol(pick.accept) + ' payment…');
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
    MINTS: MINTS,
    UNWRAP: UNWRAP,
    RPCS: RPCS,
    toBig: toBig,
    isSolanaNetwork: isSolanaNetwork,
    solanaAccepts: solanaAccepts,
    rowSymbol: rowSymbol,
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
