/* grokui-on-a-phone: threads + chat + wallet + hosted OCC Agent.
   Chat: attach binds files; later turns spill a short tail + context id —
   never the growing thread together with x-hrr-context.
   Agent: hosted OCC + upload to session cwd (phones cannot run packed
   openzoo-claude). Host gate is a subscription Bearer. x402/MWA still pays
   inference. Never ANTHROPIC_API_KEY. */
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
  var modelIds = [];
  var Auto = window.OpenZooAuto;
  var AUTO_MODEL = (Auto && Auto.AUTO_MODEL) || 'openzoo/auto';
  var Think = window.OpenZooThink;
  var Sub = window.OpenZooSub;
  var Occ = window.OpenZooOcc;

  function $(id) { return document.getElementById(id); }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { return null; }
  }

  function saveStore() {
    var t = active();
    localStorage.setItem(STORE, JSON.stringify({
      threads: state.threads,
      activeId: state.activeId,
      model: $('model') && $('model').value,
      mode: t && t.mode,
      tier: t && t.tier,
      race: t && t.race,
      raceNeed: t && t.raceNeed
    }));
  }

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function defaultSpend() {
    var Race = window.OpenZooRace;
    var tierSel = typeof document !== 'undefined' && document.getElementById('tierSel');
    var raceSel = typeof document !== 'undefined' && document.getElementById('raceSel');
    if (Race && tierSel && raceSel && raceSel.value) {
      var live = Race.parseRaceValue(raceSel.value);
      return {
        tier: Race.normalizeTier(tierSel.value),
        race: live.race,
        raceNeed: live.raceNeed
      };
    }
    var parsed = Race
      ? Race.parseRaceValue((saved && saved.race != null)
        ? Race.raceSelectValue(saved.race, saved.raceNeed)
        : (Race.DEFAULT_NEED + ' ' + Race.DEFAULT_N))
      : { race: 4, raceNeed: 2 };
    return {
      tier: (Race && Race.normalizeTier(saved && saved.tier)) || 'medium',
      race: parsed.race,
      raceNeed: parsed.raceNeed
    };
  }

  function spendOf(thread) {
    var Race = window.OpenZooRace;
    var fallback = defaultSpend();
    if (!thread) return fallback;
    return {
      tier: (Race && Race.normalizeTier(thread.tier)) || fallback.tier,
      race: thread.race == null ? fallback.race : (Number(thread.race) || 0),
      raceNeed: thread.raceNeed == null ? fallback.raceNeed : (Number(thread.raceNeed) || 1)
    };
  }

  function newThread(name) {
    var spend = defaultSpend();
    var t = {
      id: uid(),
      name: name || 'openzoo',
      color: COLORS[state.threads.length % COLORS.length],
      messages: [],
      spent: 0,
      directUsd: 0,
      calls: 0,
      memory: null,
      spillCorpus: '',
      preview: '',
      mode: 'chat',
      occSessionId: null,
      occCwd: null,
      goalSet: false,
      tier: spend.tier,
      race: spend.race,
      raceNeed: spend.raceNeed
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

  var promptWaiter = null;

  function hidePrompt() {
    var overlay = $('promptOverlay');
    if (overlay) overlay.classList.remove('show');
    if (promptWaiter) {
      var w = promptWaiter;
      promptWaiter = null;
      w(false);
    }
  }

  function showPayPrompt(spec) {
    spec = spec || {};
    hidePrompt();
    return new Promise(function (resolve) {
      promptWaiter = resolve;
      $('promptTitle').textContent = spec.title || 'Payment';
      $('promptBody').textContent = spec.message || '';
      var addrRow = $('promptAddr');
      var addrVal = $('promptAddrVal');
      if (spec.address) {
        addrRow.style.display = '';
        addrVal.textContent = spec.address;
        addrVal.onclick = function () { copyAddress(spec.address); };
      } else {
        addrRow.style.display = 'none';
      }
      var choices = $('promptChoices');
      choices.innerHTML = '';
      (spec.choices || []).forEach(function (c) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice';
        btn.textContent = c.label;
        btn.onclick = function () { copyAddress(spec.address || c.value); };
        choices.appendChild(btn);
      });
      $('promptOk').textContent = spec.okLabel || 'Continue';
      $('promptOk').onclick = function () {
        var w = promptWaiter;
        promptWaiter = null;
        $('promptOverlay').classList.remove('show');
        if (w) w(true);
      };
      $('promptCancel').onclick = function () {
        var w = promptWaiter;
        promptWaiter = null;
        $('promptOverlay').classList.remove('show');
        if (window.OpenZooPay) OpenZooPay.clearPending402();
        if (w) w(false);
      };
      $('promptOverlay').classList.add('show');
    });
  }

  function confirmWrap(info) {
    var label = (info && info.label) || 'TOKEN';
    var message = (info && info.message) || ('You have ' + label + '. Wrap enough to send this?');
    return showPayPrompt({
      title: 'Wrap ' + label,
      message: message,
      okLabel: 'Wrap'
    });
  }

  function showFundPrompt(err) {
    var address = (err && err.address) || wallet.address;
    var prompt = err && (err.prompt || err.code);
    if (prompt === 'short-sol') {
      return showPayPrompt({
        title: 'Network fee',
        message: (err && (err.promptCopy || err.message)) || 'Needs a little SOL for the network fee',
        address: address,
        okLabel: 'Copied? Retry'
      }).then(function (ok) {
        if (ok && address) copyAddress(address);
        return ok;
      });
    }
    var holdings = (err && err.holdings) || [];
    var choices = ['TOKEN', 'USDC', 'LEOS'].map(function (label) {
      return { label: label, value: address };
    });
    if (holdings.length) {
      choices = holdings.map(function (h) { return { label: h.label, value: address }; });
    }
    return showPayPrompt({
      title: 'Send tokens',
      message: (err && (err.promptCopy || err.message)) || 'Send TOKEN, USDC, or LEOS to this wallet.',
      address: address,
      choices: choices,
      okLabel: 'Copied? Retry'
    }).then(function (ok) {
      if (ok && address) copyAddress(address);
      return ok;
    });
  }

  function isFundPrompt(err) {
    var code = err && (err.prompt || err.code);
    return code === 'short-sol' || code === 'short-tokens' || code === 'no-balance' || code === 'underfunded';
  }

  function payCtx() {
    return {
      payer: wallet.address,
      signTransaction: signTransaction,
      signAndSendTransaction: signAndSendTransaction,
      onStatus: setBanner,
      confirmWrap: confirmWrap
    };
  }

  function runMode(thread) {
    return (thread && thread.mode) === 'agent' ? 'agent' : 'chat';
  }

  function isAgent(thread) {
    return runMode(thread || active()) === 'agent';
  }

  function subRec() {
    return Sub ? Sub.loadSubscription() : null;
  }

  function hasAgentKey() {
    return !!(Sub && Sub.hasSubscriptionKey(subRec()));
  }

  function occCtx() {
    return {
      subscription: subRec(),
      paidFetch: window.OpenZooPay && OpenZooPay.paidFetch,
      payCtx: payCtx(),
      model: pinnedModel()
    };
  }

  function paintSubStatus() {
    var el = $('subStatus');
    if (!el || !Sub) return;
    var view = Sub.subscriptionPublicView(subRec());
    el.textContent = view.active
      ? (view.label + ' — Agent host is gated. Inference still pays via x402.')
      : 'No key — Agent stays closed. Chat still pays via x402.';
  }

  async function ingestSubPaste() {
    if (!Sub) return;
    var raw = ($('subKey') && $('subKey').value) || '';
    var parsed = Sub.parseSubscriptionPaste(raw);
    if (parsed.error) {
      toast(parsed.error === 'empty' ? 'paste a key' : parsed.error);
      return;
    }
    if (parsed.session) {
      setBanner('checking subscription…');
      try {
        var body = await Sub.fetchBillingKey(parsed.session);
        var ingested = Sub.ingestBillingKeyResponse(body, { session: parsed.session });
        if (ingested.pending) {
          setBanner('That checkout is still confirming.');
          return;
        }
        if (!ingested.ok) {
          setBanner(ingested.error || 'no key yet');
          return;
        }
      } catch (e) {
        setBanner(e.message || 'could not fetch billing key');
        return;
      }
    } else {
      Sub.saveSubscription({ key: parsed.key });
    }
    if ($('subKey')) $('subKey').value = '';
    paintSubStatus();
    setBanner('Subscription key saved. Agent host is gated; x402 still pays inference.');
    toast('key saved');
    renderHeader();
  }

  function clearSubKey() {
    if (Sub) Sub.clearSubscription();
    var t = active();
    if (t) {
      t.occSessionId = null;
      t.occCwd = null;
    }
    saveStore();
    paintSubStatus();
    setBanner('Subscription key removed. Agent stays closed until you paste one.');
    renderHeader();
  }

  async function ensureOccSession(thread) {
    if (!Occ) throw new Error('hosted OCC client missing');
    if (!hasAgentKey()) {
      var err = new Error('No subscription key — Agent needs an OpenZoo subscription Bearer.');
      err.code = 'occ-no-key';
      throw err;
    }
    if (thread.occSessionId) return { id: thread.occSessionId, cwd: thread.occCwd || Occ.DEFAULT_CWD };
    setBanner('opening Agent session…');
    var sess = await Occ.createSession(Object.assign(occCtx(), {
      threadId: thread.id,
      name: thread.name
    }));
    thread.occSessionId = sess.id;
    thread.occCwd = sess.cwd;
    saveStore();
    return sess;
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
    if (Auto) return Auto.animalFor(id);
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

  function pinnedModel() {
    var sel = $('model');
    var v = sel && sel.value;
    return Auto ? Auto.sendModel(v) : (v || AUTO_MODEL);
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
      if (Auto) models = Auto.catalogWithAuto(models);
      else models = [{ id: AUTO_MODEL }].concat(models.filter(function (m) { return m.id !== AUTO_MODEL; }));
      modelIds = models.map(function (m) { return m.id; }).filter(function (id) { return id !== AUTO_MODEL; });
      sel.innerHTML = '';
      models.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.id;
        o.textContent = Auto ? Auto.pickerLabel(m.id) : (animal(m.id) + ' ' + m.id.replace(/^[^/]+\//, ''));
        sel.appendChild(o);
      });
      var want = (saved && saved.model) || AUTO_MODEL;
      if (want !== AUTO_MODEL && [].some.call(sel.options, function (o) { return o.value === want; })) {
        sel.value = want;
      } else {
        sel.value = AUTO_MODEL;
      }
    } catch (_) {
      sel.innerHTML = '<option value="openzoo/auto">🎯 Auto</option>';
      sel.value = AUTO_MODEL;
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
    setDials();
    renderHud();
  }

  function setDials() {
    if (!window.OpenZooRace) return;
    var t = active();
    var spend = spendOf(t);
    var tierSel = $('tierSel');
    var raceSel = $('raceSel');
    var modelSel = $('model');
    if (!tierSel || !raceSel) return;
    tierSel.value = spend.tier;
    raceSel.value = OpenZooRace.raceSelectValue(spend.race, spend.raceNeed);
    var racing = spend.race >= 2;
    if (modelSel) {
      modelSel.disabled = racing;
      modelSel.className = 'dial' + (racing ? ' pinned' : '');
      modelSel.title = racing
        ? 'Racing the ' + spend.tier + ' band — pick 1 model to pin a single model.'
        : 'Auto lets the sidecar pick. Pin a real model to lock one.';
    }
    tierSel.className = 'dial' + (spend.tier === 'expensive' || spend.tier === 'grok4.6' ? ' hot' : '');
    raceSel.className = 'dial' + (racing ? ' hot' : '');
    tierSel.title = 'How much to spend per turn when racing';
    raceSel.title = 'Ask N models from the tier at once. First X countable back are judged. You pay for every entrant.';
    var modeSel = $('modeSel');
    if (modeSel) {
      modeSel.value = runMode(t);
      modeSel.className = 'dial' + (isAgent(t) ? ' hot' : '');
    }
    var tip = $('goalTip');
    if (tip) {
      tip.classList.toggle('show', isAgent(t) && !t.goalSet);
    }
    var inp = $('inp');
    if (inp) {
      inp.placeholder = isAgent(t) ? 'Message or /goal …' : 'Message';
    }
    if (isAgent(t)) {
      raceSel.disabled = true;
      raceSel.className = 'dial pinned';
      raceSel.title = 'Agent is one hosted OCC session — race stays on Chat.';
      if (modelSel) {
        modelSel.disabled = false;
        modelSel.className = 'dial';
      }
    } else {
      raceSel.disabled = false;
    }
  }

  function renderHud() {
    var el = $('hudChip');
    if (!el || !window.OpenZooSpill) return;
    var t = active();
    var spent = Number(t.spent) || 0;
    var direct = Number(t.directUsd) || 0;
    var mult = OpenZooSpill.hudSavingX(direct, spent);
    if (spent <= 0) {
      el.textContent = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = '$' + spent.toFixed(4) + (mult ? ' · ' + OpenZooSpill.formatSavingX(mult) : '');
    el.title = mult
      ? ('direct $' + direct.toFixed(4) + ' / spent $' + spent.toFixed(4))
      : ('spent $' + spent.toFixed(4));
  }

  function renderLog() {
    var log = $('log');
    log.innerHTML = '';
    var t = active();
    if (!t.messages.length) {
      var welcome = document.createElement('div');
      welcome.className = 'row bot';
      welcome.innerHTML = '<div class="bubble">Chat is completions from your wallet (x402 + MWA). Agent is hosted OCC + upload — phones cannot run packed openzoo-claude. Agent needs a subscription Bearer; no key means no session. Never ANTHROPIC_API_KEY.</div>';
      log.appendChild(welcome);
      return;
    }
    t.messages.forEach(function (m) {
      if (Think) Think.normalizeMessage(m);
      var row = document.createElement('div');
      row.className = 'row ' + (m.role === 'user' ? 'user' : 'bot') + (m.pending ? ' pending' : '');
      if (m.role !== 'user' && Think && Think.hasReasoning(m.reasoning)) {
        var thinkBtn = document.createElement('button');
        thinkBtn.type = 'button';
        thinkBtn.className = 'think-row';
        thinkBtn.setAttribute('data-component', 'think-row');
        thinkBtn.setAttribute('aria-expanded', m.thinkOpen ? 'true' : 'false');
        thinkBtn.textContent = Think.LABEL;
        thinkBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          m.thinkOpen = !m.thinkOpen;
          renderLog();
        });
        row.appendChild(thinkBtn);
        if (m.thinkOpen) {
          var thinkBody = document.createElement('div');
          thinkBody.className = 'think-body';
          thinkBody.setAttribute('data-component', 'think-body');
          thinkBody.textContent = m.reasoning;
          row.appendChild(thinkBody);
        }
      }
      var showBubble = m.content || (m.pending && !(Think && Think.hasReasoning(m.reasoning)));
      if (showBubble) {
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = m.content || (m.pending ? '…' : '');
        row.appendChild(bubble);
      }
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
      pendingFiles.push({ name: path, size: f.size, content: content, file: f });
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

  function completedHistory(thread) {
    return thread.messages.filter(function (m, i) {
      return !(i === thread.messages.length - 1 && m.role === 'assistant' && (m.pending || m.content === '…'));
    }).map(function (m) {
      var copy = { role: m.role, content: m.content };
      if (Think && m.role === 'assistant') {
        var n = Think.split(m.content || '');
        copy.content = n.content;
      }
      return copy;
    });
  }

  function noteThreadReceipt(thread, x402) {
    if (!window.OpenZooSpill) return null;
    if (typeof thread.directUsd !== 'number') thread.directUsd = 0;
    var receipt = OpenZooSpill.noteReceipt({
      spentUsd: thread.spent,
      directUsd: thread.directUsd,
      calls: thread.calls
    }, x402 || {});
    thread.spent = receipt.spentUsd;
    thread.directUsd = receipt.directUsd;
    thread.calls = receipt.calls;
    return receipt;
  }

  function paintAssistant(thread, patch) {
    var last = thread.messages[thread.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (patch.replace) last.content = patch.content == null ? '' : String(patch.content);
    else if (patch.content != null && patch.content !== '') {
      if (!last.content || last.content === '…') last.content = String(patch.content);
      else last.content += String(patch.content);
    }
    if (patch.reasoning != null) {
      last.reasoning = patch.reasoning;
      if (last.thinkOpen == null) last.thinkOpen = false;
    }
    if (patch.raw != null) last.raw = patch.raw;
    if (Think) Think.normalizeMessage(last);
    if (patch.meta != null) last.meta = patch.meta;
    if (patch.pending != null) last.pending = patch.pending;
    renderLog();
    renderHud();
  }

  function ingestAssistant(thread, text, extra, opts) {
    extra = extra || {};
    opts = opts || {};
    var last = thread.messages[thread.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (opts.replace || extra.replace) last.raw = text == null ? '' : String(text);
    else if (text) last.raw = (last.raw || '') + String(text);
    var parsed = Think
      ? (extra.visible != null || extra.reasoning != null
        ? { content: extra.visible == null ? last.content : extra.visible, reasoning: extra.reasoning || '' }
        : Think.split(last.raw || last.content || ''))
      : { content: last.raw || text || last.content || '', reasoning: extra.reasoning || '' };
    if (Think) Think.applyToMessage(last, parsed, opts);
    else {
      last.content = parsed.content;
      if (parsed.reasoning) last.reasoning = parsed.reasoning;
    }
    if (opts.pending != null) last.pending = opts.pending;
    if (opts.meta != null) last.meta = opts.meta;
    renderLog();
    renderHud();
  }

  async function bindCorpus(thread, corpus, opts) {
    opts = opts || {};
    if (!corpus || !String(corpus).trim()) return thread.memory || null;
    if (!opts.silent) setBanner(opts.label || 'attaching…');
    var spec = opts.chat
      ? OpenZooSpill.nextBindBody(thread, corpus)
      : (thread.memory
        ? { corpus: corpus, context_id: thread.memory, append: true }
        : { corpus: corpus, append: false });
    var body = (spec.append && thread.memory)
      ? { corpus: spec.corpus, context_id: thread.memory }
      : { corpus: spec.corpus };
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
        thread.spillCorpus = '';
        return bindCorpus(thread, corpus, opts);
      }
      throw new Error((d && (d.error && d.error.message || d.error || d.message)) || 'Could not keep that with this thread.');
    }
    if (d.context_id) thread.memory = d.context_id;
    if (opts.chat) thread.spillCorpus = corpus;
    saveStore();
    if (!opts.silent) setBanner('');
    return thread.memory;
  }

  async function attachQuietly(thread, corpus) {
    return bindCorpus(thread, corpus, { label: 'attaching…' });
  }

  async function spillPrefix(thread, corpus) {
    return bindCorpus(thread, corpus, { chat: true, silent: true });
  }

  async function readSSE(res, onDelta) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var last = {};
    var stream = Think ? Think.createStream() : null;
    var content = '';
    var reasoning = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data:') !== 0) continue;
        var payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          var ev = JSON.parse(payload);
          last = ev;
          var delta = ev.choices && ev.choices[0] && ev.choices[0].delta;
          var piece = delta && delta.content;
          var snap = null;
          if (stream) {
            if (piece) stream.pushContent(piece);
            var rdelta = Think.reasoningFrom(delta);
            if (rdelta) stream.pushReasoning(rdelta);
            snap = stream.snapshot();
            content = snap.content;
            reasoning = snap.reasoning;
            if (onDelta && (piece || rdelta)) {
              onDelta(piece || '', {
                visible: snap.content,
                reasoning: snap.reasoning,
                visibleDelta: snap.visibleDelta,
                replace: true
              });
            }
          } else if (piece) {
            content += piece;
            if (onDelta) onDelta(piece);
          }
        } catch (_) {}
      }
    }
    if (stream) {
      var finished = stream.finish(last);
      content = finished.content;
      reasoning = finished.reasoning;
    }
    if (!last.choices) last = { choices: [{ message: { content: content } }] };
    if (!last.choices[0]) last.choices[0] = {};
    if (!last.choices[0].message) last.choices[0].message = { content: content };
    last.choices[0].message.content = content;
    if (reasoning) last.choices[0].message.reasoning = reasoning;
    return { r: res, d: last, streamed: true, streamedContent: content, streamedReasoning: reasoning };
  }

  async function readCompletion(res, onDelta) {
    var ct = '';
    try { ct = (res.headers && res.headers.get && res.headers.get('content-type')) || ''; } catch (_) {}
    if (/event-stream/i.test(ct) && res.body && res.body.getReader) {
      return readSSE(res, onDelta);
    }
    var d = await res.json();
    var parsed = Think ? Think.fromCompletion(d) : null;
    if (parsed && d && d.choices && d.choices[0] && d.choices[0].message) {
      d.choices[0].message.content = parsed.content;
      if (parsed.reasoning) d.choices[0].message.reasoning = parsed.reasoning;
      else delete d.choices[0].message.reasoning;
    }
    if (parsed && onDelta && parsed.content) onDelta(parsed.content, {
      visible: parsed.content,
      reasoning: parsed.reasoning,
      replace: true
    });
    return { r: res, d: d, streamed: false, streamedContent: parsed ? parsed.content : undefined,
      streamedReasoning: parsed ? parsed.reasoning : undefined };
  }

  async function postChat(thread, history, retried, opts) {
    opts = opts || {};
    var planned = OpenZooSpill.planChatSpill(history, thread);
    if (planned.bind && planned.corpus) {
      try {
        await spillPrefix(thread, planned.corpus);
      } catch (e) {
        if (!thread.memory) throw e;
      }
      planned = OpenZooSpill.planChatSpill(history, thread);
    }
    var headers = OpenZooSpill.chatHeaders(planned.contextId);
    OpenZooSpill.assertNoFullDump(headers, planned.messages, history.length);
    var model = opts.model || pinnedModel();
    var maxTok = opts.maxTokens || (Auto ? Auto.reasoningMaxTokens(model)
      : (/deepseek|grok|thinking|fable|sonnet-5|-r1|reason|openzoo\/auto/i.test(model) ? 16384 : 4096));
    var body = {
      model: model,
      messages: planned.messages,
      max_tokens: maxTok
    };
    if (opts.stream) body.stream = true;
    var r = await OpenZooPay.paidFetch(GATEWAY + '/v1/chat/completions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }, Object.assign(payCtx(), { keepPending: !!opts.keepPending }));
    var read = await readCompletion(r, opts.onDelta);
    var d = read.d;
    if (r.status === 404 && /context_not_found/.test(JSON.stringify(d)) && !retried) {
      thread.memory = null;
      thread.spillCorpus = '';
      var fresh = OpenZooSpill.planChatSpill(history, thread);
      if (fresh.corpus) await spillPrefix(thread, fresh.corpus);
      return postChat(thread, history, true, opts);
    }
    return { r: r, d: d, planned: planned, streamed: read.streamed, streamedContent: read.streamedContent };
  }

  async function postJudge(model, messages, maxTok) {
    var r = await OpenZooPay.paidFetch(GATEWAY + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model || OpenZooRace.JUDGE_MODEL,
        messages: messages,
        max_tokens: maxTok || 24
      })
    }, Object.assign(payCtx(), { keepPending: true }));
    var d = await r.json();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    noteThreadReceipt(active(), d.x402);
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  }

  function isJudgePrompt(messages) {
    var first = messages && messages[0] && messages[0].content;
    return /Score this answer to one question|Pick the single best one/i.test(String(first || ''));
  }

  function streamRacer(thread) {
    return async function (messages, onDelta, _ctx, model) {
      if (isJudgePrompt(messages) || model === OpenZooRace.JUDGE_MODEL) {
        return postJudge(OpenZooRace.JUDGE_MODEL, messages, 24);
      }
      try {
        var posted = await postChat(thread, messages, false, {
          model: model,
          stream: typeof onDelta === 'function',
          onDelta: onDelta,
          keepPending: true
        });
        if (!posted.r.ok) throw new Error('HTTP ' + posted.r.status);
        var ch = posted.d.choices && posted.d.choices[0];
        var content = (ch && ch.message && ch.message.content) || posted.streamedContent || '';
        var parsed = Think ? Think.fromCompletion({
          choices: [{ message: { content: content, reasoning: posted.streamedReasoning || (ch && ch.message && ch.message.reasoning) } }]
        }) : { content: content, reasoning: posted.streamedReasoning || '' };
        noteThreadReceipt(thread, posted.d && posted.d.x402);
        if (parsed.content && onDelta && !posted.streamed) {
          onDelta(parsed.content, { visible: parsed.content, reasoning: parsed.reasoning, replace: true });
        }
        return parsed.content;
      } catch (e) {
        if (e && (e.code === 'wrap-cancelled' || e.prompt || /wrap cancelled/i.test(e.message || ''))) throw e;
        if (window.OpenZooPay && OpenZooPay.isTransientNetworkError(e)) {
          throw Object.assign(new TypeError('fetch failed'), { name: 'TypeError' });
        }
        throw e;
      }
    };
  }

  async function submitAgent(thread, text, files) {
    if (!hasAgentKey()) {
      setBanner('No subscription key — Agent needs an OpenZoo subscription Bearer. Paste one in wallet.');
      openWallet();
      return false;
    }
    if (!wallet.address) {
      setBanner('Connect a wallet — x402 still pays Agent inference.');
      return false;
    }
    var sess;
    try {
      sess = await ensureOccSession(thread);
    } catch (e) {
      if (e && (e.code === 'occ-no-key' || e.code === 'occ-unauthorized')) {
        thread.occSessionId = null;
        setBanner(e.message);
        openWallet();
        return false;
      }
      throw e;
    }
    if (files && files.length) {
      setBanner('uploading to Agent cwd…');
      await Occ.uploadFiles(sess.id, files, occCtx());
      setBanner('');
    }
    if (!text && !(files && files.length)) return true;
    var line = text;
    if (!line && files && files.length) {
      line = 'uploaded ' + files.map(function (f) { return f.name; }).join(', ') + ' to session cwd';
    }
    var turn = await Occ.sendMessage(sess.id, line, Object.assign(occCtx(), {
      onDelta: function (piece, extra) {
        ingestAssistant(thread, piece, extra || {}, { replace: !!(extra && extra.replace), pending: true });
      }
    }));
    if (Occ.isGoalText(line)) thread.goalSet = true;
    var content = turn.text || '';
    var last = thread.messages[thread.messages.length - 1];
    if (last && last.role === 'assistant') {
      last.content = content || last.content || (Occ.isGoalText(line) ? 'goal set' : '…');
      last.pending = false;
      last.meta = 'Agent · hosted OCC';
    }
    thread.preview = (last && last.content || content).slice(0, 80);
    saveStore();
    return true;
  }

  async function submit() {
    var text = $('inp').value.trim();
    if ((!text && !pendingFiles.length) || state.busy) return;
    var t = active();
    if (!isAgent(t) && !wallet.address) {
      setBanner('Connect a wallet on the shell first — chat is paid from your wallet.');
      return;
    }
    if (isAgent(t) && !hasAgentKey()) {
      setBanner('No subscription key — Agent needs an OpenZoo subscription Bearer. Paste one in wallet.');
      openWallet();
      return;
    }
    var corpus = corpusFromPending();
    var agentFiles = pendingFiles.slice();
    pendingFiles = [];
    $('inp').value = '';
    renderAttach();
    updateSend();
    if (text) t.name = t.name === 'openzoo' && t.messages.length === 0 ? text.slice(0, 32) : t.name;
    if (text) {
      t.messages.push({ role: 'user', content: text });
      t.preview = text;
    }
    t.messages.push({ role: 'assistant', content: '', meta: '…', pending: true });
    state.busy = true;
    render();
    try {
      if (isAgent(t)) {
        var ok = await submitAgent(t, text, agentFiles);
        if (!ok) {
          t.messages.pop();
          saveStore();
          state.busy = false;
          render();
          return;
        }
        setBanner('');
        state.busy = false;
        render();
        return;
      }
      if (corpus) await attachQuietly(t, corpus);
      var history = completedHistory(t);
      var spend = spendOf(t);
      var racing = window.OpenZooRace && spend.race >= 2;
      var content = '';
      var lastX402 = {};
      var lastRouted = '';
      if (racing) {
        if (window.OpenZooPay) OpenZooPay.clearPending402();
        var models = OpenZooRace.tierModels(spend.tier, spend.race, true, modelIds);
        if (Auto && Auto.isAuto(pinnedModel()) && Auto.shortlist) {
          var picked = await Auto.shortlist(text, spend.race);
          if (picked && picked.length) models = picked;
        }
        if (models.length < 2) {
          racing = false;
        } else {
          paintAssistant(t, { meta: OpenZooRace.formatRaceStatus(0, spend.raceNeed), pending: true });
          content = await OpenZooRace.brainRace(
            history,
            function (delta, meta) {
              ingestAssistant(t, delta, meta || {}, { replace: !!(meta && meta.replace), pending: true });
            },
            t.memory,
            models,
            spend.raceNeed,
            undefined,
            function (status) {
              paintAssistant(t, { meta: status, pending: true });
            },
            { stream: streamRacer(t) }
          );
          lastX402 = {};
        }
      }
      if (!racing) {
        var posted = await postChat(t, history, false, {
          stream: true,
          onDelta: function (_piece, extra) {
            ingestAssistant(t, _piece, extra || {}, { replace: true, pending: true });
          }
        });
        var r = posted.r;
        var d = posted.d;
        if (!r.ok) {
          var msg = OpenZooPay.humanizeError((d.error && d.error.message) || d.error || d.message || ('HTTP ' + r.status));
          t.messages.pop();
          t.messages.push({ role: 'assistant', content: 'the zoo hiccuped: ' + msg });
          setBanner(msg);
          saveStore();
          state.busy = false;
          render();
          return;
        }
        var ch = d.choices && d.choices[0];
        content = (ch && ch.message && ch.message.content) || posted.streamedContent || '';
        lastX402 = d.x402 || {};
        lastRouted = Auto ? Auto.displayRouted(d, pinnedModel()) : (d.model && d.model !== AUTO_MODEL ? d.model : '');
        noteThreadReceipt(t, lastX402);
        if (Think) {
          var done = Think.fromCompletion(d);
          if (!done.content && posted.streamedContent) done = Think.split(posted.streamedContent);
          content = done.content || content;
          ingestAssistant(t, content, { visible: content, reasoning: done.reasoning || posted.streamedReasoning || '' }, { replace: true, pending: true });
        }
      }
      setBanner('');
      if (!content) content = racing ? OpenZooRace.RACE_EVERY_FAILED : 'the zoo returned an empty reply.';
      var bits = [];
      if (typeof lastX402.billedUsd === 'number') bits.push('$' + lastX402.billedUsd.toFixed(4));
      if (t.spent > 0 && window.OpenZooSpill) {
        var mult = OpenZooSpill.hudSavingX(t.directUsd, t.spent);
        if (mult) bits.push(OpenZooSpill.formatSavingX(mult));
        else if (!lastX402.billedUsd && t.spent) bits.push('$' + Number(t.spent).toFixed(4));
      }
      if (lastRouted) bits.push(lastRouted);
      if (racing) bits.push('race ' + spend.raceNeed + '/' + spend.race);
      var last = t.messages[t.messages.length - 1];
      if (last && last.role === 'assistant') {
        var finalParsed = Think ? Think.split(content) : { content: content, reasoning: last.reasoning || '' };
        last.content = finalParsed.content || content;
        if (Think) {
          Think.applyToMessage(last, {
            content: last.content,
            reasoning: Think.merge(finalParsed.reasoning, last.reasoning)
          });
        }
        last.meta = bits.join(' · ');
        last.pending = false;
      } else {
        t.messages.push({ role: 'assistant', content: content, meta: bits.join(' · ') });
      }
      t.preview = content.slice(0, 80);
      saveStore();
    } catch (e) {
      if (e && (e.code === 'wrap-cancelled' || /wrap cancelled/i.test(e.message || ''))) {
        t.messages.pop();
        setBanner('Wrap cancelled.');
        state.busy = false;
        render();
        return;
      }
      if (e && (e.code === 'occ-no-key' || e.code === 'occ-unauthorized')) {
        t.messages.pop();
        t.occSessionId = null;
        saveStore();
        state.busy = false;
        render();
        setBanner(e.message);
        openWallet();
        return;
      }
      if (isFundPrompt(e)) {
        t.messages.pop();
        saveStore();
        state.busy = false;
        render();
        showFundPrompt(e);
        return;
      }
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
    paintSubStatus();
  }

  async function topUpNow() {
    if (!wallet.address) { setBanner('Connect a wallet first.'); return; }
    try {
      var result = await OpenZooPay.topUpFromHoldings(wallet.address, signAndSendTransaction, {
        onStatus: setBanner,
        confirmWrap: confirmWrap
      });
      setBanner(result.wrapped ? 'Top-up sent.' : 'This wallet is already ready to pay.');
      openWallet();
    } catch (e) {
      if (isFundPrompt(e)) {
        showFundPrompt(e);
        return;
      }
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
  if ($('subSave')) $('subSave').onclick = ingestSubPaste;
  if ($('subClear')) $('subClear').onclick = clearSubKey;
  $('leaveBtn').onclick = function () { parent.postMessage({ type: 'wallet-exit' }, '*'); };
  if ($('modeSel')) {
    $('modeSel').onchange = function () {
      var t = active();
      t.mode = $('modeSel').value === 'agent' ? 'agent' : 'chat';
      if (t.mode === 'agent' && !hasAgentKey()) {
        setBanner('No subscription key — Agent needs an OpenZoo subscription Bearer. Paste one in wallet.');
        openWallet();
      }
      saveStore();
      setDials();
      renderLog();
    };
  }
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
  if ($('tierSel')) {
    $('tierSel').onchange = function () {
      active().tier = window.OpenZooRace ? OpenZooRace.normalizeTier($('tierSel').value) : $('tierSel').value;
      saveStore();
      setDials();
    };
  }
  if ($('raceSel')) {
    $('raceSel').onchange = function () {
      var parsed = window.OpenZooRace
        ? OpenZooRace.parseRaceValue($('raceSel').value)
        : { race: 0, raceNeed: 1 };
      active().race = parsed.race;
      active().raceNeed = parsed.raceNeed;
      saveStore();
      setDials();
    };
  }

  render();
  // Chrome is painted. Do not wait on fly.dev /v1/models — dismiss the
  // shell's #oz-boot overlay now, then fetch the catalog in the background.
  try { parent.postMessage({ type: 'openzoo-chrome-ready' }, '*'); } catch (_) {}
  paintSubStatus();
  loadModels();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' && window.OpenZooPay) OpenZooPay.notifyResume();
  });
  if ($('promptOverlay')) {
    $('promptOverlay').addEventListener('click', function (e) {
      if (e.target === $('promptOverlay')) hidePrompt();
    });
  }
})();
