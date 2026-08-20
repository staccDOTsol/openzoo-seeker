/* OpenZoo Auto — virtual model id the sidecar / proxy routes.
   Clients send model: "openzoo/auto". The sidecar picks the cheapest
   model that probably finishes the task. Do not classify here.
   This is model selection, not auto-run tools. */
(function (root) {
  'use strict';

  var AUTO_MODEL = 'openzoo/auto';
  var AUTO_LABEL = 'Auto';

  function compactModelId(value) {
    if (value == null) return '';
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    var s = String(value).trim();
    if (!s) return '';
    if (s.charAt(0) === '{' || s.charAt(0) === '[') return '';
    if (s.length > 96) return '';
    if (/[\n\r\t]/.test(s)) return '';
    return s;
  }

  function isAuto(id) {
    return compactModelId(id) === AUTO_MODEL;
  }

  function isPinned(id) {
    var s = compactModelId(id);
    return !!(s && s !== AUTO_MODEL);
  }

  function resolveSendModel(pickerValue, savedValue) {
    if (isPinned(pickerValue)) return compactModelId(pickerValue);
    if (isPinned(savedValue)) return compactModelId(savedValue);
    return AUTO_MODEL;
  }

  function shouldRace(raceN, model) {
    return Number(raceN) >= 2 && isPinned(model);
  }

  function routedModelId(payload, requested) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
    var x = payload.x402 && typeof payload.x402 === 'object' && !Array.isArray(payload.x402)
      ? payload.x402
      : {};
    var candidates = [
      payload.model,
      x.model,
      x.routed,
      x.routedModel,
      x.routed_model
    ];
    var i;
    var id;
    for (i = 0; i < candidates.length; i++) {
      id = compactModelId(candidates[i]);
      if (id && !isAuto(id)) return id;
    }
    var req = compactModelId(requested);
    return req && !isAuto(req) ? req : '';
  }

  function mergeCatalog(models) {
    var seen = {};
    var out = [{ id: AUTO_MODEL, name: AUTO_LABEL }];
    seen[AUTO_MODEL] = true;
    (models || []).forEach(function (m) {
      var id = compactModelId(m && (m.id != null ? m.id : m));
      if (!id || seen[id]) return;
      seen[id] = true;
      if (typeof m === 'string' || typeof m === 'number') out.push({ id: id });
      else out.push(Object.assign({}, m, { id: id }));
    });
    return out;
  }

  function formatPickerLabel(id, animalFn) {
    if (isAuto(id)) return '🦓 ' + AUTO_LABEL;
    var suffix = String(id || '').replace(/^[^/]+\//, '');
    var mark = typeof animalFn === 'function' ? animalFn(id) : '';
    return ((mark ? mark + ' ' : '') + suffix).trim();
  }

  var api = {
    AUTO_MODEL: AUTO_MODEL,
    AUTO_LABEL: AUTO_LABEL,
    compactModelId: compactModelId,
    isAuto: isAuto,
    isPinned: isPinned,
    resolveSendModel: resolveSendModel,
    shouldRace: shouldRace,
    routedModelId: routedModelId,
    mergeCatalog: mergeCatalog,
    formatPickerLabel: formatPickerLabel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenZooAuto = api;
})(typeof window !== 'undefined' ? window : globalThis);
