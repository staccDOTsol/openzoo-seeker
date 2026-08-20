/* Compact Solana helpers for wrap txs. No @solana/web3.js in the webview. */
(function (root) {
  'use strict';

  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var B58_MAP = (function () {
    var m = {};
    for (var i = 0; i < B58.length; i++) m[B58[i]] = i;
    return m;
  })();

  var SYSTEM_PROGRAM = '11111111111111111111111111111111';
  var TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var PDA_MARKER = strBytes('ProgramDerivedAddress');

  function strBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function concatBytes(parts) {
    var n = 0;
    for (var i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    var o = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], o);
      o += parts[j].length;
    }
    return out;
  }

  function decodeBase58(str) {
    if (typeof str !== 'string' || !str) throw new Error('empty base58');
    var zeros = 0;
    while (zeros < str.length && str[zeros] === '1') zeros++;
    var size = Math.ceil(str.length * 0.7322476243909465) + 1;
    var b = new Uint8Array(size);
    for (var i = zeros; i < str.length; i++) {
      var c = B58_MAP[str[i]];
      if (c == null) throw new Error('invalid base58');
      var carry = c;
      for (var j = size - 1; j >= 0; j--) {
        carry += 58 * b[j];
        b[j] = carry & 0xff;
        carry >>= 8;
      }
    }
    var start = 0;
    while (start < b.length && b[start] === 0) start++;
    var out = new Uint8Array(zeros + (b.length - start));
    out.set(b.subarray(start), zeros);
    return out;
  }

  function encodeBase58(bytes) {
    var zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    var size = Math.ceil(bytes.length * 1.365658237309761) + 1;
    var b = new Uint8Array(size);
    for (var i = zeros; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = size - 1; j >= 0; j--) {
        carry += 256 * b[j];
        b[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
    }
    var start = 0;
    while (start < b.length && b[start] === 0) start++;
    var chars = '';
    for (var z = 0; z < zeros; z++) chars += '1';
    for (var k = start; k < b.length; k++) chars += B58[b[k]];
    return chars;
  }

  function pubkeyBytes(pk) {
    if (pk instanceof Uint8Array) {
      if (pk.length !== 32) throw new Error('pubkey must be 32 bytes');
      return pk;
    }
    var b = decodeBase58(String(pk));
    if (b.length !== 32) throw new Error('pubkey must decode to 32 bytes');
    return b;
  }

  function pubkeyStr(pk) {
    if (typeof pk === 'string') return pk;
    return encodeBase58(pk);
  }

  /* SHA-256 (sync) — compact public-domain implementation. */
  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256(bytes) {
    var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bitLen = data.length * 8;
    var withOne = data.length + 1;
    var padLen = (withOne % 64 <= 56) ? 64 - (withOne % 64) : 128 - (withOne % 64);
    var buf = new Uint8Array(withOne + padLen);
    buf.set(data);
    buf[data.length] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 4, bitLen >>> 0);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Uint32Array(64);

    for (var off = 0; off < buf.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (var t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (var r = 0; r < 64; r++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[r] + w[r]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    odv.setUint32(0, h0); odv.setUint32(4, h1); odv.setUint32(8, h2); odv.setUint32(12, h3);
    odv.setUint32(16, h4); odv.setUint32(20, h5); odv.setUint32(24, h6); odv.setUint32(28, h7);
    return out;
  }

  /* ed25519 on-curve check (Solana PDA reject-if-on-curve). */
  var ED_P = (1n << 255n) - 19n;
  var ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

  function modP(n) {
    n %= ED_P;
    return n < 0n ? n + ED_P : n;
  }

  function modPow(base, exp, m) {
    var r = 1n;
    var b = base % m;
    var e = exp;
    while (e > 0n) {
      if (e & 1n) r = (r * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return r;
  }

  function isOnCurve(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
    var y = 0n;
    for (var i = 0; i < 32; i++) y |= BigInt(bytes[i]) << (8n * BigInt(i));
    y &= (1n << 255n) - 1n;
    if (y >= ED_P) return false;
    var y2 = modP(y * y);
    var u = modP(y2 - 1n);
    var v = modP(ED_D * y2 + 1n);
    if (v === 0n) return false;
    var x2 = modP(u * modPow(v, ED_P - 2n, ED_P));
    if (x2 === 0n) return true;
    return modPow(x2, (ED_P - 1n) / 2n, ED_P) === 1n;
  }

  function findProgramAddress(seeds, programId) {
    var program = pubkeyBytes(programId);
    for (var bump = 255; bump >= 0; bump--) {
      var parts = [];
      for (var i = 0; i < seeds.length; i++) {
        var s = seeds[i];
        parts.push(typeof s === 'string' ? pubkeyBytes(s) : s);
      }
      parts.push(new Uint8Array([bump]));
      parts.push(program);
      parts.push(PDA_MARKER);
      var hash = sha256(concatBytes(parts));
      if (!isOnCurve(hash)) {
        return { address: encodeBase58(hash), bytes: hash, bump: bump };
      }
    }
    throw new Error('unable to find program address');
  }

  function getAssociatedTokenAddress(mint, owner, tokenProgram) {
    var found = findProgramAddress(
      [pubkeyBytes(owner), pubkeyBytes(tokenProgram || TOKEN_PROGRAM), pubkeyBytes(mint)],
      ASSOCIATED_TOKEN_PROGRAM
    );
    return found.address;
  }

  function u16le(n) {
    return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  }

  function compactU16(n) {
    if (n < 0x80) return new Uint8Array([n]);
    if (n < 0x4000) return new Uint8Array([ (n & 0x7f) | 0x80, n >> 7 ]);
    return new Uint8Array([ (n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14 ]);
  }

  function u64le(n) {
    var v = typeof n === 'bigint' ? n : BigInt(n);
    var b = new Uint8Array(8);
    for (var i = 0; i < 8; i++) {
      b[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return b;
  }

  /**
   * Compile a legacy unsigned transaction (empty signatures).
   * instructions: [{ programId, keys: [{pubkey, isSigner, isWritable}], data: Uint8Array }]
   */
  function compileLegacyTransaction(feePayer, recentBlockhash, instructions) {
    var payer = pubkeyStr(feePayer);
    var meta = Object.create(null);

    function touch(pk, isSigner, isWritable) {
      var k = pubkeyStr(pk);
      if (!meta[k]) meta[k] = { key: k, isSigner: false, isWritable: false };
      if (isSigner) meta[k].isSigner = true;
      if (isWritable) meta[k].isWritable = true;
    }

    touch(payer, true, true);
    for (var i = 0; i < instructions.length; i++) {
      var ix = instructions[i];
      touch(ix.programId, false, false);
      for (var j = 0; j < ix.keys.length; j++) {
        touch(ix.keys[j].pubkey, ix.keys[j].isSigner, ix.keys[j].isWritable);
      }
    }

    var keys = Object.keys(meta);
    keys.sort(function (a, b) {
      var A = meta[a], B = meta[b];
      if (a === payer) return -1;
      if (b === payer) return 1;
      if (A.isSigner !== B.isSigner) return A.isSigner ? -1 : 1;
      if (A.isWritable !== B.isWritable) return A.isWritable ? -1 : 1;
      return 0;
    });

    var indexOf = Object.create(null);
    for (var ki = 0; ki < keys.length; ki++) indexOf[keys[ki]] = ki;

    var numSigners = 0, numRoSigners = 0, numRoUnsigned = 0;
    for (var s = 0; s < keys.length; s++) {
      if (meta[keys[s]].isSigner) {
        numSigners++;
        if (!meta[keys[s]].isWritable) numRoSigners++;
      } else if (!meta[keys[s]].isWritable) {
        numRoUnsigned++;
      }
    }

    var header = new Uint8Array([numSigners, numRoSigners, numRoUnsigned]);
    var keyBytes = concatBytes(keys.map(function (k) { return pubkeyBytes(k); }));
    var bh = pubkeyBytes(recentBlockhash);

    var ixParts = [compactU16(instructions.length)];
    for (var x = 0; x < instructions.length; x++) {
      var ins = instructions[x];
      var accs = ins.keys.map(function (k) { return indexOf[pubkeyStr(k.pubkey)]; });
      ixParts.push(new Uint8Array([indexOf[pubkeyStr(ins.programId)]]));
      ixParts.push(compactU16(accs.length));
      ixParts.push(new Uint8Array(accs));
      ixParts.push(compactU16(ins.data.length));
      ixParts.push(ins.data);
    }

    var message = concatBytes([
      header,
      compactU16(keys.length),
      keyBytes,
      bh,
      concatBytes(ixParts)
    ]);

    var sigs = concatBytes([compactU16(numSigners), new Uint8Array(numSigners * 64)]);
    return concatBytes([sigs, message]);
  }

  function bytesToBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') return btoa(bin);
    return Buffer.from(bytes).toString('base64');
  }

  function createAtaIdempotentIx(payer, ata, owner, mint, tokenProgram) {
    return {
      programId: ASSOCIATED_TOKEN_PROGRAM,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false }
      ],
      data: new Uint8Array([1])
    };
  }

  var api = {
    SYSTEM_PROGRAM: SYSTEM_PROGRAM,
    TOKEN_PROGRAM: TOKEN_PROGRAM,
    TOKEN_2022_PROGRAM: TOKEN_2022_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM: ASSOCIATED_TOKEN_PROGRAM,
    decodeBase58: decodeBase58,
    encodeBase58: encodeBase58,
    pubkeyBytes: pubkeyBytes,
    pubkeyStr: pubkeyStr,
    sha256: sha256,
    isOnCurve: isOnCurve,
    findProgramAddress: findProgramAddress,
    getAssociatedTokenAddress: getAssociatedTokenAddress,
    compactU16: compactU16,
    u64le: u64le,
    u16le: u16le,
    compileLegacyTransaction: compileLegacyTransaction,
    bytesToBase64: bytesToBase64,
    createAtaIdempotentIx: createAtaIdempotentIx,
    concatBytes: concatBytes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooSolana = api;
})(typeof window !== 'undefined' ? window : globalThis);
