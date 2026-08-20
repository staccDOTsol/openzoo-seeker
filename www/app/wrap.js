/* Wrap-nav top-up. Port of staccDOTsol/openzoo lib/wrap.js for the webview.
   Users never see twin tickers. Directory is LIVE GET /supported. */
(function (root) {
  'use strict';

  var S = (typeof module !== 'undefined' && module.exports)
    ? require('./solana.js')
    : root.OpenZooSolana;

  var SUPPORTED_URL = 'https://x402.accrue.fund/supported';
  var WRAP_PROGRAM = 'FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE';
  var DRAINED_MINT = 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9';
  var WTOKENX2 = 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B';
  var MINIMUM_LIQUIDITY = 1000n;
  var AUTHORITY_SEED = (function () {
    var s = 'mint_authority';
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  })();

  var directoryCache = { at: 0, kinds: null };

  function isDrainedMint(mint) {
    return String(mint || '') === DRAINED_MINT;
  }

  function isSolanaNetwork(network) {
    return typeof network === 'string' && network.indexOf('solana:') === 0;
  }

  function userLabelFor(symbol, asset) {
    var raw = String(symbol || '');
    if (asset === WTOKENX2 || raw === 'wTOKENx2') return 'TOKEN';
    if (raw === 'wTOKENx') return 'TOKEN';
    if (raw === 'yUSDCx' || raw === 'USDC') return 'USDC';
    if (raw === 'wLEOSx' || raw === 'LEOS') return 'LEOS';
    if (raw === 'TOKEN') return 'TOKEN';
    if (raw === 'fSPCX' || raw === 'SPCX') return 'SPCX';
    return 'token';
  }

  /* Twin plumbing names — never put these on screen. */
  var TWIN_RE = /yUSDCx|wTOKENx2?|wLEOSx|fSPCX|Bo7xBF7[A-Za-z0-9]+/g;

  function stripTwinHomework(text) {
    return String(text || '')
      .replace(/Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9/g, '')
      .replace(TWIN_RE, 'token')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async function fetchSupported(fetcher) {
    if (directoryCache.kinds && Date.now() - directoryCache.at < 300000) {
      return directoryCache.kinds;
    }
    var fetchFn = fetcher || fetch;
    var r = await fetchFn(SUPPORTED_URL, { method: 'GET' });
    if (!r.ok) throw new Error('directory unavailable');
    var body = await r.json();
    if (!Array.isArray(body && body.kinds)) throw new Error('directory shape');
    directoryCache = { at: Date.now(), kinds: body.kinds };
    return body.kinds;
  }

  function resetDirectoryCache() {
    directoryCache = { at: 0, kinds: null };
  }

  function solanaKinds(kinds) {
    var out = [];
    (kinds || []).forEach(function (k) {
      if (!isSolanaNetwork(k && k.network)) return;
      var asset = k.extra && k.extra.asset;
      if (!asset || isDrainedMint(asset)) return;
      out.push(k);
    });
    return out;
  }

  function acquireForMint(kinds, wrappedMint) {
    if (isDrainedMint(wrappedMint)) return null;
    var rows = solanaKinds(kinds);
    for (var i = 0; i < rows.length; i++) {
      var extra = rows[i].extra || {};
      if (extra.asset !== wrappedMint) continue;
      var acq = extra.acquire;
      if (!acq || acq.method !== 'spl-token-wrap') return null;
      if (!acq.underlying || !acq.underlying.address || !acq.escrow) return null;
      return {
        program: acq.program || WRAP_PROGRAM,
        wrapped: wrappedMint,
        symbol: extra.symbol,
        label: userLabelFor(extra.symbol, wrappedMint),
        decimals: extra.decimals,
        underlying: acq.underlying.address,
        underlyingSymbol: acq.underlying.symbol,
        underlyingDecimals: acq.underlying.decimals,
        underlyingProgram: acq.underlying.tokenProgram || S.TOKEN_PROGRAM,
        escrow: acq.escrow,
        mintAuthority: acq.mintAuthority,
        authorityBump: acq.authorityBump,
        wrappedProgram: S.TOKEN_2022_PROGRAM,
        warning: acq.warning || extra.warning || ''
      };
    }
    return null;
  }

  function resolvePool(kinds, wrappedMint) {
    var acq = acquireForMint(kinds, wrappedMint);
    if (!acq) return null;
    var bump = acq.authorityBump;
    if (bump == null && acq.mintAuthority) {
      var derived = S.findProgramAddress([AUTHORITY_SEED, S.pubkeyBytes(acq.wrapped)], acq.program);
      if (derived.address === acq.mintAuthority) bump = derived.bump;
    }
    if (bump == null) {
      var fresh = S.findProgramAddress([AUTHORITY_SEED, S.pubkeyBytes(acq.wrapped)], acq.program);
      bump = fresh.bump;
      if (!acq.mintAuthority) acq.mintAuthority = fresh.address;
    }
    acq.authorityBump = bump;
    return acq;
  }

  function depositForShares(sharesNeeded, reserves, supply) {
    var need = typeof sharesNeeded === 'bigint' ? sharesNeeded : BigInt(sharesNeeded);
    var res = typeof reserves === 'bigint' ? reserves : BigInt(reserves || 0);
    var sup = typeof supply === 'bigint' ? supply : BigInt(supply || 0);
    if (sup === 0n || res === 0n) return need + MINIMUM_LIQUIDITY;
    var exact = (need * res + sup - 1n) / sup;
    return exact + exact / 200n + 2n;
  }

  /**
   * NINE accounts. The program pulls the deposit itself (TransferChecked CPI).
   * A 5-account call is rejected NotEnoughAccounts (0x6a).
   * wTOKENx2 uses bump 254.
   */
  function buildWrapInstruction(pool, owner, depositRaw) {
    var userWrapped = S.getAssociatedTokenAddress(pool.wrapped, owner, pool.wrappedProgram);
    var userUnderlying = S.getAssociatedTokenAddress(pool.underlying, owner, pool.underlyingProgram);
    var bump = Number(pool.authorityBump);
    var data = S.concatBytes([
      new Uint8Array([1]),
      S.u64le(depositRaw),
      new Uint8Array([bump])
    ]);
    var keys = [
      { pubkey: pool.escrow, isSigner: false, isWritable: true },
      { pubkey: pool.wrapped, isSigner: false, isWritable: true },
      { pubkey: userWrapped, isSigner: false, isWritable: true },
      { pubkey: pool.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: pool.wrappedProgram, isSigner: false, isWritable: false },
      { pubkey: userUnderlying, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: pool.underlying, isSigner: false, isWritable: false },
      { pubkey: pool.underlyingProgram, isSigner: false, isWritable: false }
    ];
    return {
      programId: pool.program,
      keys: keys,
      data: data,
      userWrapped: userWrapped,
      userUnderlying: userUnderlying,
      bump: bump,
      accountCount: keys.length
    };
  }

  function buildWrapInstructions(pool, owner, depositRaw, rentPayer) {
    var wrap = buildWrapInstruction(pool, owner, depositRaw);
    var payer = rentPayer || owner;
    return [
      S.createAtaIdempotentIx(payer, wrap.userWrapped, owner, pool.wrapped, pool.wrappedProgram),
      {
        programId: wrap.programId,
        keys: wrap.keys,
        data: wrap.data
      }
    ];
  }

  function compileWrapTransaction(pool, owner, depositRaw, recentBlockhash, rentPayer) {
    var ixs = buildWrapInstructions(pool, owner, depositRaw, rentPayer || owner);
    var bytes = S.compileLegacyTransaction(rentPayer || owner, recentBlockhash, ixs);
    return {
      bytes: bytes,
      transaction: S.bytesToBase64(bytes),
      instructions: ixs,
      wrap: buildWrapInstruction(pool, owner, depositRaw)
    };
  }

  var api = {
    SUPPORTED_URL: SUPPORTED_URL,
    WRAP_PROGRAM: WRAP_PROGRAM,
    DRAINED_MINT: DRAINED_MINT,
    WTOKENX2: WTOKENX2,
    MINIMUM_LIQUIDITY: MINIMUM_LIQUIDITY,
    isDrainedMint: isDrainedMint,
    isSolanaNetwork: isSolanaNetwork,
    userLabelFor: userLabelFor,
    stripTwinHomework: stripTwinHomework,
    fetchSupported: fetchSupported,
    resetDirectoryCache: resetDirectoryCache,
    solanaKinds: solanaKinds,
    acquireForMint: acquireForMint,
    resolvePool: resolvePool,
    depositForShares: depositForShares,
    buildWrapInstruction: buildWrapInstruction,
    buildWrapInstructions: buildWrapInstructions,
    compileWrapTransaction: compileWrapTransaction
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooWrap = api;
})(typeof window !== 'undefined' ? window : globalThis);
