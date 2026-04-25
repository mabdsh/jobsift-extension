// JobSift Content v2.1.1
// Flow: loading badges → batch AI score → update all → panel click → deep AI

(function () {
  'use strict';
  if (window._jsContent) return;
  window._jsContent = true;

  let _prefs       = null;
  let _initDone    = false;
  let _batchTimer  = null;
  let _pollTimers  = [];
  let _navObserver = null; // Fix #4: stored so it's never duplicated

  // jobId → { jobData, result } — for panel lookup after batch completes
  const _store = new Map();

  async function loadPreferences() {
    return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift || null)));
  }

  function isJobsPage() {
    const p = location.pathname;
    return p.startsWith('/jobs') || p.includes('/collections/') || p.startsWith('/search/results/jobs');
  }

  // ── Phase 1: inject loading badges on all unprocessed cards ───────────────
  function showLoadingBadges() {
    const cards = window.findAllJobCards().filter(c => {
      const li = c.closest('li') || c;
      return !li.dataset.jsDone && !li.dataset.jsProcessing;
    });
    // Fix #5: injectLoadingBadge only accepts one argument — removed stray extractJobData call
    cards.forEach(card => window.injectLoadingBadge(card));
    return cards;
  }

  // ── Phase 2: batch score all loading cards in one AI call ─────────────────
  async function batchScore(cards) {
    if (!cards.length || !_prefs?.profile) return;

    // Extract job data for each card, store for later
    const jobs = cards.map(card => {
      const jobData = window.extractJobData(card);
      if (jobData.jobId) _store.set(jobData.jobId, { jobData });
      return jobData;
    });

    // Rule-based scoring runs immediately (provides criteria detail for panel)
    const ruleResults = new Map();
    jobs.forEach(jd => {
      const r   = window.scoreJob(jd, _prefs.profile);
      const key = jd.jobId || `${jd.title}|${jd.company}`;
      ruleResults.set(key, r);
    });

    let aiResults = [];
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'JS_BATCH_SCORE',
        profile: _prefs.profile,
        jobs,
      });
      if (res.ok) aiResults = res.results || [];
    } catch (_) {
      // AI unreachable — fall through to rule-based fallback below
    }

    // Merge AI score with rule-based criteria and update each badge
    cards.forEach((card, i) => {
      const li      = card.closest('li') || card;
      const jobData = jobs[i];
      const key     = jobData.jobId || `${jobData.title}|${jobData.company}`;
      const rules   = ruleResults.get(key) || {};

      // Fix #8: only match on jobId when it is a non-empty string.
      // An empty jobId would cause the first result in aiResults to match
      // every card that also has no jobId, mixing up scores.
      const ai =
        (jobData.jobId
          ? aiResults.find(r => r.jobId === jobData.jobId)
          : null) ||
        aiResults.find(r => r.jobId === String(i)) ||
        aiResults[i];

      // Build unified result: AI score + rule-based criteria detail
      const result = ai
        ? {
            score:           ai.score,
            label:           ai.label,
            text:            ai.text,
            verdict:         ai.verdict,
            // Rule-based fields — drive the panel breakdown
            criteria:        rules.criteria        || [],
            tips:            rules.tips            || [],
            recommendation:  rules.recommendation  || null,
            missingCritical: rules.missingCritical || [],
            warnings:        rules.warnings        || [],
            confidence:      rules.confidence      || 1,
            metCount:        rules.metCount        || 0,
            total:           rules.total           || 0,
          }
        : rules; // No AI result → fall back silently to rule-based

      if (jobData.jobId) _store.set(jobData.jobId, { jobData, result });
      window.updateBadgeWithResult(li, result, jobData);
    });

    // Inject/refresh filter bar once all badges are scored
    window.injectFilterBar();
    window.refreshFilterBar();
    updateExtensionBadge();
  }

  // Debounce: collect cards for 400ms then batch score together
  function scheduleBatch() {
    clearTimeout(_batchTimer);
    _batchTimer = setTimeout(async () => {
      const cards = showLoadingBadges();
      if (cards.length) await batchScore(cards);
    }, 400);
  }

  // ── AI hook: panel open → deep analysis of full JD ────────────────────────
  window._jobsiftOnPanelOpen = function (jobData, panelEl, li) {
    if (typeof window.analyzeJobDeep === 'function') {
      window.analyzeJobDeep(jobData, panelEl, li, _prefs);
    }
  };

  function updateExtensionBadge() {
    const green = document.querySelectorAll('.js-badge--green').length;
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: green }).catch(() => {});
  }

  function startPolling() {
    _pollTimers.forEach(clearTimeout);
    _pollTimers = [];
    if (!isJobsPage()) return;
    [300, 1200, 3000, 6000, 12000].forEach(ms => {
      _pollTimers.push(setTimeout(scheduleBatch, ms));
    });
  }

  function startObserver() {
    if (!isJobsPage()) return;
    window.setupObserver(() => scheduleBatch(), window.findJobCardsIn);
  }

  function reprocessAll() {
    window.disconnectObserver?.();
    document.querySelectorAll('.js-badge, .js-panel, #js-filter-bar').forEach(el => el.remove());
    document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
      delete el.dataset.jsDone;
      delete el.dataset.jsProcessing;
    });
    window.hidePanel?.();
    _store.clear();
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});
    startPolling();
    startObserver();
    // _navObserver intentionally NOT reset — URL watching must persist across reprocessing
  }

  function listenForChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.jobsift) {
        _prefs = changes.jobsift.newValue;
        reprocessAll();
      }
    });
  }

  let _lastUrl = location.href;

  // Fix #4: store the observer reference and guard against duplicate setup.
  // Previously `new MutationObserver(...).observe(...)` created an anonymous
  // observer on every reprocessAll() call — accumulated silently and never GC'd.
  function watchNavigation() {
    if (_navObserver) return; // already watching — do not create a second observer
    _navObserver = new MutationObserver(() => {
      if (location.href === _lastUrl) return;
      _lastUrl = location.href;
      document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
        delete el.dataset.jsDone;
        delete el.dataset.jsProcessing;
      });
      if (isJobsPage()) setTimeout(() => { startPolling(); startObserver(); }, 400);
      else chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});
    });
    _navObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    if (_initDone || !isJobsPage()) return;
    _initDone = true;
    _prefs    = await loadPreferences();
    startPolling();
    startObserver();
    listenForChanges();
    watchNavigation();
  }

  init();

}());