// JobSift Observer v2.0.0

(function () {
  'use strict';
  if (window._jsObserver) return;
  window._jsObserver = true;

  let _observer = null;

  function setupObserver(onNewCard, cardFinder) {
    if (_observer) _observer.disconnect();
    _observer = new MutationObserver(mutations => {
      const toProcess = new Set();
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (!node || node.nodeType !== 1) continue;
          const gather = cardFinder
            || (typeof window.findJobCardsIn === 'function' ? window.findJobCardsIn : _fallback);
          gather(node).forEach(card => {
            const li = card.closest('li') || card;
            if (!li.dataset.jsDone && !li.dataset.jsProcessing) toProcess.add(card);
          });
        }
      }
      if (toProcess.size > 0) {
        setTimeout(() => toProcess.forEach(card => onNewCard(card)), 180);
      }
    });
    _observer.observe(document.body, { childList:true, subtree:true });
  }

  function disconnectObserver() {
    if (_observer) { _observer.disconnect(); _observer = null; }
  }

  function _fallback(node) {
    const found = new Set();
    ['li[data-occludable-job-id]','li[data-job-id]','li.occludable-update','li.artdeco-list__item']
      .forEach(sel => { try { node.querySelectorAll?.(sel).forEach(el=>found.add(el)); } catch(_){} });
    return Array.from(found);
  }

  window.setupObserver      = setupObserver;
  window.disconnectObserver = disconnectObserver;
}());
