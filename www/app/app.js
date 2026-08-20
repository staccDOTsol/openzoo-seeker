/* grokui-on-a-phone: threads + chat + wallet. Bind is attach-only and silent. */
(function () {
  'use strict';

  var GATEWAY = (window.OpenZooPay && OpenZooPay.GATEWAY) || 'https://x402-tokens.fly.dev';
  var STORE = 'openzoo.seeker.grokui.v1';
  var COLORS = ['#7c5cff', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#64d2ff', '#bf5af2'];

  var wallet = { address: null, method: null };
  var pendingSigns = new Map();
  var pendingSends = new Map();
  var signSeq = 1;
  var pendingFiles = [];
  var kindsCache = null;

  function $(id) { return document.getElementById(id); }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { return null; }
  }

  function saveStore() {
    localStorage.setItem(STORE, JSON.stringify({
      threads: state.threads,
      activeId: state.activeId,
      model: $('model') && $('model').value
    }));
  }

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newThread(name) {
    var t = {
      id: uid(),
      name: name || 'openzoo',
      color: COLORS[state.threads.length % COLORS.length],
      messages: [],
      spent: 0,
      calls: 0,
      memory: null,
      preview: ''
    };
    state.threads.unshift(t);
    state.activeId = t.id;
    saveStore();
    return t;
  }

  var saved = loadStore();
  var state = {
    threads: (saved && saved.threads) || [],
    activeId: saved && saved.activeId,
    busy: false
  };
  if (!state.threads.length) newThread('openzoo');
  if (!state.activeId || !state.threads.some(function (t) { return t.id === state.activeId; })) {
    state.activeId = state.threads[0].id;
  }

  function active() {
    return state.threads.find(function (t) { return t.id === state.activeId; }) || state.threads[0];
  }

  function setBanner(msg) {
    var el = $('banner');
    if (!msg) { el.classList.remove('show'); el.textContent = ''; return; }
    var text = window.OpenZooPay ? OpenZooPay.humanizeError(msg) : msg;
    if (window.OpenZooWrap) text = OpenZooWrap.stripTwinHomework(text);
    el.textContent = text;
    el.classList.add('show');
  }

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function copyAddress(addr) {
    if (!addr || !window.OpenZooCopy) return;
    OpenZooCopy.copyText(addr).then(function () { toast('copied'); })
      .catch(function () { toast('could not copy'); });
  }

  function signTransaction(txB64) {
    return new Promise(function (resolve, reject) {
      var id = signSeq++;
      var t = setTimeout(function () {
        pendingSigns.delete(id);
        reject(new Error('wallet sign timed out — approve the payment in your wallet'));
      }, 90000);
      pendingSigns.set(id, {
        resolve: function (signed) { clearTimeout(t); resolve(signed); },
        reject: function (err) { clearTimeout(t); reject(err); }
      });
      parent.postMessage({ type: 'wallet-sign-transaction', id: id, transaction: txB64 }, '*');
    });
  }

  function signAndSendTransaction(txB64) {
    return new Promise(function (resolve, reject) {
      var id = signSeq++;
      var t = setTimeout(function () {
        pendingSends.delete(id);
        reject(new Error('top-up timed out — approve it in your wallet'));
      }, 90000);
      pendingSends.set(id, {
        resolve: function (sig) { clearTimeout(t); resolve(sig); },
        reject: function (err) { clearTimeout(t); reject(err); }
      });
      parent.postMessage({ type: 'wallet-sign-and-send-transaction', id: id, transaction: txB64 }, '*');
    });
  }

  function payCtx() {
    return {
      payer: wallet.address,
      signTransaction: signTransaction,
      signAndSendTransaction: signAndSendTransaction,
      onStatus: setBanner
    };
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || !data.type) return;
    if (data.type === 'wallet-connected') {
      wallet.address = data.address;
      wallet.method = data.method;
      setBanner('');
      renderHeader();
    }
    if (data.type === 'wallet-disconnected') {
      wallet.address = null;
      wallet.method = null;
      renderHeader();
    }
    if (data.type === 'wallet-sign-transaction-response') {
      var p = pendingSigns.get(data.id);
      if (!p) return;
      pendingSigns.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.signedTransaction);
    }
    if (data.type === 'wallet-sign-and-send-transaction-response') {
      var s = pendingSends.get(data.id);
      if (!s) return;
      pendingSends.delete(data.id);
      if (data.error) s.reject(new Error(data.error));
      else s.resolve(data.signature);
    }
    if (data.type === 'app-resume' && window.OpenZooPay) {
      OpenZooPay.notifyResume();
    }
  });
  parent.postMessage({ type: 'wallet-request-info' }, '*');

  function animal(id) {
    if (!id) return '🐾';
    if (id.indexOf('anthropic') === 0) return '🦒';
    if (id.indexOf('openai') === 0) return '🦉';
    if (id.indexOf('deepseek') === 0) return '🐋';
    if (id.indexOf('x-ai') === 0) return '🦊';
    if (id.indexOf('google') === 0) return '🐦';
    if (id.indexOf('meta') === 0) return '🦙';
    if (id.indexOf('mistral') === 0) return '🐈';
    if (id.indexOf('qwen') === 0) return '🐼';
    return '🐾';
  }

  async function loadModels() {
    var sel = $('model');
    try {
      var r = await fetch(GATEWAY + '/v1/models');
      var d = await r.json();
      var models = (d.data || []).filter(function (m) {
        return m.id && m.id.indexOf('~') !== 0 && m.id.indexOf(':batch') < 0;
      });
      models.sort(function (a, b) { return a.id.localeCompare(b.id); });
      sel.innerHTML = '';
      models.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.id;
        o.textContent = animal(m.id) + ' ' + m.id.replace(/^[^/]+\//, '');
        sel.appendChild(o);
      });
      var want = (saved && saved.model) || 'google/gemini-3.7-flash';
      if ([].some.call(sel.options, function (o) { return o.value === want; })) sel.value = want;
      else if (models[0]) sel.value = models[0].id;
    } catch (_) {
      sel.innerHTML = '<option value="google/gemini-3.7-flash">gemini flash</option>';
    }
  }

  function renderThreads() {
    var host = $('threads');
    var q = ($('search').value || '').toLowerCase();
    host.innerHTML = '';
    state.threads.forEach(function (t) {
      if (q && (t.name + ' ' + (t.preview || '')).toLowerCase().indexOf(q) < 0) return;
      var row = document.createElement('div');
      row.className = 'trow' + (t.id === state.activeId ? ' active' : '');
      row.setAttribute('data-thread', t.id);
      row.innerHTML = '<div class="tavatar" style="background:' + t.color + '">' +
        (t.name.slice(0, 1).toUpperCase() || 'O') + '</div>' +
        '<div class="tmeta"><div class="tname"></div><div class="tprev"></div></div>' +
        '<button class="tclose" type="button" aria-label="close">✕</button>';
      row.querySelector('.tname').textContent = t.name;
      row.querySelector('.tprev').textContent = t.preview || 'New thread';
      row.addEventListener('click', function (e) {
        if (e.target.closest('.tclose')) return;
        state.activeId = t.id;
        saveStore();
        closeSidebar();
        render();
      });
      row.querySelector('.tclose').addEventListener('click', function (e) {
        e.stopPropagation();
        state.threads = state.threads.filter(function (x) { return x.id !== t.id; });
        if (!state.threads.length) newThread('openzoo');
        if (state.activeId === t.id) state.activeId = state.threads[0].id;
        saveStore();
        render();
      });
      host.appendChild(row);
    });
  }

  function renderHeader() {
    var t = active();
    var el = $('chatHeaderId');
    el.innerHTML = '<div class="tavatar" style="background:' + t.color + ';width:26px;height:26px;border-radius:7px;font-size:11px">' +
      (t.name.slice(0, 1).toUpperCase()) + '</div><div class="hname"><div></div></div>';
    el.querySelector('.hname div').textContent = t.name;
    $('walletBtn').textContent = wallet.address
      ? (wallet.address.slice(0, 4) + '…' + wallet.address.slice(-4))
      : 'wallet';
  }

  function renderLog() {
    var log = $('log');
    log.innerHTML = '';
    var t = active();
    if (!t.messages.length) {
      var welcome = document.createElement('div');
      welcome.className = 'row bot';
      welcome.innerHTML = '<div class="bubble">Threads, chat, and your wallet — same product as the desktop client. Attach files, a folder, or notes; the app keeps them with this thread. Pay from the connected wallet.</div>';
      log.appendChild(welcome);
      return;
    }
    t.messages.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'row ' + (m.role === 'user' ? 'user' : 'bot');
      var bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = m.content;
      row.appendChild(bubble);
      if (m.meta) {
        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = m.meta;
        row.appendChild(meta);
      }
      log.appendChild(row);
    });
    log.scrollTop = log.scrollHeight;
  }

  function renderAttach() {
    var host = $('attachChips');
    host.innerHTML = '';
    pendingFiles.forEach(function (f, i) {
      var chip = document.createElement('span');
      chip.className = 'achip';
      chip.innerHTML = '<span></span><span class="ax">✕</span>';
      chip.querySelector('span').textContent = f.name;
      chip.querySelector('.ax').addEventListener('click', function () {
        pendingFiles.splice(i, 1);
        renderAttach();
        updateSend();
      });
      host.appendChild(chip);
    });
  }

  function render() {
    renderThreads();
    renderHeader();
    renderLog();
    renderAttach();
    updateSend();
  }

  function updateSend() {
    $('send').classList.toggle('show', !!($('inp').value.trim() || pendingFiles.length));
  }

  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('scrim').classList.remove('show');
  }

  function looksText(file) {
    return /^text\//.test(file.type) ||
      /\.(txt|md|js|mjs|ts|tsx|jsx|py|json|css|html|csv|log|ya?ml|sh|rs|go|java|c|h|cpp)$/i.test(file.name);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { resolve(null); };
      r.readAsText(file);
    });
  }

  async function addFiles(fileList) {
    var files = Array.from(fileList || []);
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var path = f.webkitRelativePath || f.name;
      var content = (looksText(f) && f.size < 400000) ? await readFileAsText(f) : null;
      pendingFiles.push({ name: path, size: f.size, content: content });
    }
    renderAttach();
    updateSend();
  }

  function corpusFromPending() {
    var parts = [];
    pendingFiles.forEach(function (f) {
      if (f.content != null) parts.push('--- ' + f.name + ' ---\n' + f.content);
      else parts.push('(file ' + f.name + ', ' + f.size + ' bytes)');
    });
    return parts.join('\n\n');
  }

  async function attachQuietly(thread, corpus) {
    if (!corpus || !corpus.trim()) return thread.memory || null;
    setBanner('attaching…');
    var body = thread.memory
      ? { corpus: corpus, context_id: thread.memory }
      : { corpus: corpus };
    var r = await OpenZooPay.paidFetch(GATEWAY + '/v1/hrr/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }, payCtx());
    var d = await r.json();
    if (!r.ok) {
      var gone = r.status === 404 && /context_not_found/.test(JSON.stringify(d));
      if (gone && thread.memory) {
        thread.memory = null;
        return attachQuietly(thread, corpus);
      }
      throw new Error((d && (d.error && d.error.message || d.error || d.message)) || 'Could not attach those notes.');
    }
    if (d.context_id) thread.memory = d.context_id;
    saveStore();
    setBanner('');
    return thread.memory;
  }

  async function submit() {
    var text = $('inp').value.trim();
    if ((!text && !pendingFiles.length) || state.busy) return;
    if (!wallet.address) {
      setBanner('Connect a wallet on the shell first — chat is paid from your wallet.');
      return;
    }
    var t = active();
    var corpus = corpusFromPending();
    pendingFiles = [];
    $('inp').value = '';
    renderAttach();
    updateSend();
    if (text) t.name = t.name === 'openzoo' && t.messages.length === 0 ? text.slice(0, 32) : t.name;
    if (text) {
      t.messages.push({ role: 'user', content: text });
      t.preview = text;
    }
    t.messages.push({ role: 'assistant', content: '…' });
    state.busy = true;
    render();
    try {
      if (corpus) await attachQuietly(t, corpus);
      var headers = { 'content-type': 'application/json' };
      if (t.memory) headers['x-hrr-context'] = t.memory;
      var history = t.messages.filter(function (m, i) {
        return !(i === t.messages.length - 1 && m.role === 'assistant');
      }).map(function (m) { return { role: m.role, content: m.content }; });
      var r = await OpenZooPay.paidFetch(GATEWAY + '/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: $('model').value,
          messages: history,
          max_tokens: /deepseek|grok|thinking|fable|sonnet-5|-r1|reason/i.test($('model').value) ? 16384 : 4096
        })
      }, payCtx());
      var d = await r.json();
      if (r.status === 404 && /context_not_found/.test(JSON.stringify(d)) && corpus) {
        t.memory = null;
        await attachQuietly(t, corpus);
        headers['x-hrr-context'] = t.memory;
        r = await OpenZooPay.paidFetch(GATEWAY + '/v1/chat/completions', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: $('model').value,
            messages: history,
            max_tokens: 4096
          })
        }, payCtx());
        d = await r.json();
      }
      if (!r.ok) {
        var msg = OpenZooPay.humanizeError((d.error && d.error.message) || d.error || d.message || ('HTTP ' + r.status));
        t.messages.pop();
        t.messages.push({ role: 'assistant', content: 'the zoo hiccuped: ' + msg });
        setBanner(msg);
      } else {
        setBanner('');
        var ch = d.choices && d.choices[0];
        var content = (ch && ch.message && ch.message.content) || '';
        if (!content) content = 'the zoo returned an empty reply.';
        var x = d.x402 || {};
        t.calls += 1;
        if (typeof x.billedUsd === 'number') t.spent += x.billedUsd;
        var bits = [];
        if (typeof x.billedUsd === 'number') bits.push('$' + x.billedUsd.toFixed(4));
        t.messages.pop();
        t.messages.push({ role: 'assistant', content: content, meta: bits.join(' · ') });
        t.preview = content.slice(0, 80);
      }
      saveStore();
    } catch (e) {
      var fail = OpenZooPay.humanizeError(e);
      t.messages.pop();
      t.messages.push({ role: 'assistant', content: 'the zoo hiccuped: ' + fail });
      setBanner(fail);
    }
    state.busy = false;
    render();
  }

  async function openWallet() {
    $('walletOverlay').classList.add('show');
    var body = $('walletBody');
    body.textContent = 'loading…';
    if (!wallet.address) {
      body.innerHTML = '<div class="wnote">Connect on the shell first.</div>';
      return;
    }
    try {
      var kinds = kindsCache || await OpenZooWrap.fetchSupported();
      kindsCache = kinds;
      var balances = await OpenZooPay.fetchBalances(wallet.address);
      var holdings = OpenZooPay.visibleHoldings(balances, kinds);
      body.innerHTML = '';
      var addr = document.createElement('div');
      addr.className = 'wrow';
      addr.innerHTML = '<div class="wlab">Solana · tap to copy</div><div class="waddr copyable" data-component="wallet-address"></div>';
      addr.querySelector('.waddr').textContent = wallet.address;
      addr.querySelector('.waddr').title = 'Tap to copy';
      addr.addEventListener('click', function () { copyAddress(wallet.address); });
      body.appendChild(addr);
      var bal = document.createElement('div');
      bal.className = 'wbal';
      if (!holdings.length) bal.textContent = 'This wallet is empty. Add USDC, TOKEN, or LEOS, then top up.';
      else {
        bal.innerHTML = holdings.map(function (h) {
          return '<div>' + h.label + '</div>';
        }).join('');
      }
      body.appendChild(bal);
    } catch (e) {
      body.textContent = OpenZooPay.humanizeError(e.message || e);
    }
  }

  async function topUpNow() {
    if (!wallet.address) { setBanner('Connect a wallet first.'); return; }
    try {
      var result = await OpenZooPay.topUpFromHoldings(wallet.address, signAndSendTransaction, setBanner);
      setBanner(result.wrapped ? 'Top-up sent.' : 'This wallet is already ready to pay.');
      openWallet();
    } catch (e) {
      setBanner(OpenZooPay.humanizeError(e));
    }
  }

  $('newMsgBtn').onclick = function () { newThread('openzoo'); closeSidebar(); render(); };
  $('search').oninput = renderThreads;
  $('menuBtn').onclick = function () {
    $('sidebar').classList.toggle('open');
    $('scrim').classList.toggle('show');
  };
  $('scrim').onclick = closeSidebar;
  $('walletBtn').onclick = openWallet;
  $('walletClose').onclick = function () { $('walletOverlay').classList.remove('show'); };
  $('walletOverlay').addEventListener('click', function (e) {
    if (e.target === $('walletOverlay')) $('walletOverlay').classList.remove('show');
  });
  $('topUpBtn').onclick = topUpNow;
  $('leaveBtn').onclick = function () { parent.postMessage({ type: 'wallet-exit' }, '*'); };
  $('plusBtn').onclick = function (e) {
    e.stopPropagation();
    $('plusMenu').classList.toggle('show');
  };
  document.addEventListener('click', function () { $('plusMenu').classList.remove('show'); });
  $('attachFiles').onclick = function (e) {
    e.stopPropagation();
    $('plusMenu').classList.remove('show');
    $('fileInp').click();
  };
  $('attachFolder').onclick = function (e) {
    e.stopPropagation();
    $('plusMenu').classList.remove('show');
    $('folderInp').click();
  };
  $('attachPaste').onclick = function (e) {
    e.stopPropagation();
    $('plusMenu').classList.remove('show');
    $('pasteOverlay').classList.add('show');
    $('pasteText').focus();
  };
  $('fileInp').onchange = function () { addFiles($('fileInp').files); $('fileInp').value = ''; };
  $('folderInp').onchange = function () { addFiles($('folderInp').files); $('folderInp').value = ''; };
  $('pasteClip').onclick = function () {
    if (!window.OpenZooCopy) return;
    OpenZooCopy.readText().then(function (text) {
      if (!text) { toast('clipboard empty'); return; }
      $('pasteText').value = ($('pasteText').value || '') + text;
    }).catch(function () { toast('could not paste'); });
  };
  $('pasteAttach').onclick = function () {
    var text = $('pasteText').value;
    if (text.trim()) pendingFiles.push({ name: 'notes.txt', size: text.length, content: text });
    $('pasteText').value = '';
    $('pasteOverlay').classList.remove('show');
    renderAttach();
    updateSend();
  };
  $('pasteClose').onclick = function () { $('pasteOverlay').classList.remove('show'); };
  $('inp').addEventListener('input', updateSend);
  $('inp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  $('send').onclick = submit;
  $('model').onchange = saveStore;

  render();
  loadModels();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' && window.OpenZooPay) OpenZooPay.notifyResume();
  });
})();
