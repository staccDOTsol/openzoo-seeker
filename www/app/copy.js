/* Address copy/paste that works in Cordova.
   navigator.clipboard is blocked in the Android WebView. The shell owns
   MWA.copyToClipboard / readClipboard (ClipboardManager). This module
   posts to the parent, then falls back to execCommand. */
(function (root) {
  'use strict';

  function copyViaDom(text) {
    if (typeof document === 'undefined' || !document.body) return false;
    var ta = document.createElement('textarea');
    ta.value = String(text == null ? '' : text);
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (_) {}
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(ta);
    return !!ok;
  }

  function copyViaNativeFn(text, nativeCopy) {
    return Promise.resolve(nativeCopy(String(text == null ? '' : text))).then(function (ok) {
      if (ok === false) throw new Error('copy failed');
      return true;
    });
  }

  function copyViaParent(text) {
    return new Promise(function (resolve, reject) {
      if (typeof parent === 'undefined' || parent === window) {
        reject(new Error('no parent'));
        return;
      }
      var id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        if (ok) resolve(true);
        else reject(new Error('copy failed'));
      }
      function onMsg(ev) {
        var data = ev.data;
        if (!data || data.type !== 'wallet-copy-response' || data.id !== id) return;
        finish(!!data.ok);
      }
      window.addEventListener('message', onMsg);
      parent.postMessage({ type: 'wallet-copy', id: id, text: String(text == null ? '' : text) }, '*');
      setTimeout(function () { finish(false); }, 2000);
    });
  }

  function copyText(text, opts) {
    opts = opts || {};
    var value = String(text == null ? '' : text);
    if (typeof opts.nativeCopy === 'function') {
      return copyViaNativeFn(value, opts.nativeCopy);
    }
    if (typeof parent !== 'undefined' && parent !== window) {
      return copyViaParent(value).catch(function () {
        if (copyViaDom(value)) return true;
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(value).then(function () { return true; });
        }
        throw new Error('Could not copy');
      });
    }
    if (copyViaDom(value)) return Promise.resolve(true);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () { return true; });
    }
    return Promise.reject(new Error('Could not copy'));
  }

  function readViaParent() {
    return new Promise(function (resolve, reject) {
      if (typeof parent === 'undefined' || parent === window) {
        reject(new Error('no parent'));
        return;
      }
      var id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      var done = false;
      function finish(ok, text) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        if (ok) resolve(text || '');
        else reject(new Error('paste failed'));
      }
      function onMsg(ev) {
        var data = ev.data;
        if (!data || data.type !== 'wallet-paste-response' || data.id !== id) return;
        finish(!!data.ok, data.text);
      }
      window.addEventListener('message', onMsg);
      parent.postMessage({ type: 'wallet-paste', id: id }, '*');
      setTimeout(function () { finish(false); }, 2000);
    });
  }

  function readText(opts) {
    opts = opts || {};
    if (typeof opts.nativeRead === 'function') {
      return Promise.resolve(opts.nativeRead()).then(function (t) { return t == null ? '' : String(t); });
    }
    if (typeof parent !== 'undefined' && parent !== window) {
      return readViaParent().catch(function () {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
          return navigator.clipboard.readText();
        }
        return '';
      });
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
      return navigator.clipboard.readText();
    }
    return Promise.resolve('');
  }

  var api = {
    copyViaDom: copyViaDom,
    copyText: copyText,
    readText: readText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooCopy = api;
})(typeof window !== 'undefined' ? window : globalThis);
