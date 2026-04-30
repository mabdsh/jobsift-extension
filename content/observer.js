// Rolevance Observer v5.0
// v2.1.0: Indeed card detection — cardOutline + data-jk in fallback and card-done check

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
            // For LinkedIn cards the anchor is li; for Indeed cards it's the cardOutline div.
            // Check data-js-done on whichever element is the canonical anchor.
            const anchor = card.classList?.contains('cardOutline')
              ? card
              : (card.closest('li') || card);
            if (!anchor.dataset.jsDone && !anchor.dataset.jsProcessing) toProcess.add(card);
          });
        }
      }
      if (toProcess.size > 0) {
        setTimeout(() => toProcess.forEach(card => {
          try {
            onNewCard(card);
          } catch (err) {
            console.warn('[Rolevance] Observer card processing error:', err);
          }
        }), 180);
      }
    });
    _observer.observe(document.body, { childList:true, subtree:true });
  }

  function disconnectObserver() {
    if (_observer) { _observer.disconnect(); _observer = null; }
  }

  function _fallback(node) {
    const found = new Set();
    // LinkedIn cards
    ['li[data-occludable-job-id]','li[data-job-id]','li.occludable-update','li.artdeco-list__item']
      .forEach(sel => { try { node.querySelectorAll?.(sel).forEach(el=>found.add(el)); } catch(_){} });
    // Indeed cards — cardOutline is a stable class, data-jk is a stable attribute
    try {
      node.querySelectorAll?.('div.cardOutline').forEach(el => {
        if (el.querySelector('a[data-jk]') &&
            el.getAttribute('aria-hidden') !== 'true') {
          found.add(el);
        }
      });
    } catch(_) {}
    return Array.from(found);
  }

  window.setupObserver      = setupObserver;
  window.disconnectObserver = disconnectObserver;
}());