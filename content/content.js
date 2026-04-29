// JobSift Content v2.4.0
// v2.4.0: LinkedIn job detail page support — auto-scores /jobs/view/ URLs,
//         injects banner above "About the job" section, panel on demand.
// v2.3.0: fix SPA navigation — badges now appear when clicking Jobs tab from any LinkedIn page
// v2.2.0: score cache in chrome.storage.local + filter reset on navigation/reprocess

(function () {
  'use strict';
  if (window._jsContent) return;
  window._jsContent = true;

  let _prefs             = null;
  let _initDone          = false;
  let _batchTimer        = null;
  let _pollTimers        = [];
  let _navObserver       = null;
  let _detailProcessing  = false;
  let _continuousScanner = null;   // safety-net scanner for SPA navigation timing gaps
  let _lastPathname      = location.pathname; // tracks pathname separately from full href

  const _store = new Map();

  // ── Preferences ────────────────────────────────────────────────────────────
  async function loadPreferences() {
    return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift || null)));
  }

  // ── Page type detection ────────────────────────────────────────────────────
  // isDetailPage() takes priority — detail URLs start with /jobs so both return
  // true for /jobs/view/, but the more specific check is checked first everywhere.

  function isDetailPage() {
    return /\/jobs\/view\/\d+/.test(location.pathname);
  }

  function isJobsPage() {
    const p = location.pathname;
    return p.startsWith('/jobs') || p.includes('/collections/') || p.startsWith('/search/results/jobs');
  }

  // ── Score cache ────────────────────────────────────────────────────────────
  // Shared between search-page batch scoring and detail-page scoring.
  // Key: jobId. Invalidated by profile change or age > 24 hours. Max 500 entries.

  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const CACHE_MAX    = 500;

  function _profileHash(profile) {
    if (!profile) return '';
    return [
      ...(profile.mustHaveSkills  || []).slice().sort(),
      ...(profile.primarySkills   || []).slice().sort(),
      ...(profile.secondarySkills || []).slice().sort(),
      ...(profile.targetRoles     || []).slice().sort(),
      ...(profile.workTypes       || []).slice().sort(),
      ...(profile.dealBreakers    || []).slice().sort(),
      ...(profile.avoidIndustries || []).slice().sort(),
      String(profile.minSalary       || 0),
      String(profile.experienceYears || 0),
    ].join('|');
  }

  function _isValidCacheEntry(entry, profileHash) {
    if (!entry || !entry.result) return false;
    if (entry.profileHash !== profileHash) return false;
    return (Date.now() - (entry.timestamp || 0)) < CACHE_TTL_MS;
  }

  function _pruneCache(cache, profileHash) {
    const now   = Date.now();
    const valid = Object.entries(cache).filter(
      ([, v]) => v.profileHash === profileHash && (now - (v.timestamp || 0)) < CACHE_TTL_MS
    );
    if (valid.length > CACHE_MAX) {
      valid.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
      return Object.fromEntries(valid.slice(0, CACHE_MAX));
    }
    return Object.fromEntries(valid);
  }

  function _loadScoreCache() {
    return new Promise(r => chrome.storage.local.get('jobsift_scores', d => r(d.jobsift_scores || {})));
  }

  function _saveScoreCache(cache) {
    chrome.storage.local.set({ jobsift_scores: cache });
  }

  function _clearScoreCache() {
    chrome.storage.local.remove('jobsift_scores');
  }

  // ── Search page: Phase 1 — inject loading badges ───────────────────────────
  function showLoadingBadges() {
    const cards = window.findAllJobCards().filter(c => {
      const li = c.closest('li') || c;
      return !li.dataset.jsDone && !li.dataset.jsProcessing;
    });
    cards.forEach(card => window.injectLoadingBadge(card));
    return cards;
  }

  // ── Search page: Phase 2 — batch score with cache ──────────────────────────
  async function batchScore(cards) {
    if (!cards.length) return;

    const profile     = _prefs?.profile || {};
    const profileHash = _profileHash(profile);
    const hasProfile  = !!(
      profile.mustHaveSkills?.length ||
      profile.primarySkills?.length  ||
      profile.targetRoles?.length
    );

    const jobs = cards.map(card => {
      const jobData = window.extractJobData(card);
      if (jobData.jobId) _store.set(jobData.jobId, { jobData });
      return jobData;
    });

    const scoreCache    = await _loadScoreCache();
    const cachedItems   = [];
    const uncachedCards = [];
    const uncachedJobs  = [];

    cards.forEach((card, i) => {
      const li      = card.closest('li') || card;
      const jobData = jobs[i];
      const entry   = jobData.jobId ? scoreCache[jobData.jobId] : null;

      if (_isValidCacheEntry(entry, profileHash)) {
        cachedItems.push({ jobData, li, result: entry.result });
      } else {
        uncachedCards.push(card);
        uncachedJobs.push(jobData);
      }
    });

    cachedItems.forEach(({ jobData, li, result }) => {
      if (jobData.jobId) _store.set(jobData.jobId, { jobData, result });
      window.updateBadgeWithResult(li, result, jobData);
    });

    if (!uncachedCards.length) {
      window.injectFilterBar();
      window.refreshFilterBar();
      updateExtensionBadge();
      return;
    }

    const ruleResults = new Map();
    uncachedJobs.forEach(jd => {
      const r   = window.scoreJob(jd, profile);
      const key = jd.jobId || `${jd.title}|${jd.company}`;
      ruleResults.set(key, r);
    });

    let aiResults      = [];
    let aiLimitReached = false;
    let aiResetAt      = null;

    if (hasProfile) {
      try {
        const res = await chrome.runtime.sendMessage({
          type:    'JS_BATCH_SCORE',
          profile,
          jobs:    uncachedJobs,
        });
        if (res.ok) {
          aiResults = res.results || [];
        } else if (res.needs_upgrade) {
          aiLimitReached = true;
          aiResetAt      = res.reset_at || null;
        }
      } catch (_) {}
    }

    const newCacheEntries = {};

    uncachedCards.forEach((card, i) => {
      const li      = card.closest('li') || card;
      const jobData = uncachedJobs[i];
      const key     = jobData.jobId || `${jobData.title}|${jobData.company}`;
      const rules   = ruleResults.get(key) || {};

      if (aiLimitReached) {
        const result = {
          score:        rules.score ?? null,
          label:        rules.label || 'gray',
          text:         rules.text  || 'Limit reached',
          limitReached: true,
          resetAt:      aiResetAt,
          verdict:      rules.verdict || '',
        };
        if (jobData.jobId) _store.set(jobData.jobId, { jobData, result });
        window.updateBadgeWithResult(li, result, jobData);
        return;
      }

      const ai =
        (jobData.jobId ? aiResults.find(r => r.jobId === jobData.jobId) : null) ||
        aiResults.find(r => r.jobId === String(i)) ||
        aiResults[i];

      const result = ai
        ? {
            score:           ai.score,
            label:           ai.label,
            text:            ai.text,
            verdict:         ai.verdict,
            criteria:        rules.criteria        || [],
            tips:            rules.tips            || [],
            recommendation:  rules.recommendation  || null,
            missingCritical: rules.missingCritical || [],
            warnings:        rules.warnings        || [],
            confidence:      rules.confidence      || 1,
            metCount:        rules.metCount        || 0,
            total:           rules.total           || 0,
          }
        : rules;

      if (jobData.jobId) {
        _store.set(jobData.jobId, { jobData, result });
        if (result.score !== null) {
          newCacheEntries[jobData.jobId] = {
            result,
            timestamp:   Date.now(),
            profileHash,
          };
        }
      }

      window.updateBadgeWithResult(li, result, jobData);
    });

    if (Object.keys(newCacheEntries).length) {
      const updated = _pruneCache(
        { ...scoreCache, ...newCacheEntries },
        profileHash
      );
      _saveScoreCache(updated);
    }

    window.injectFilterBar();
    window.refreshFilterBar();
    updateExtensionBadge();
  }

  function scheduleBatch() {
    clearTimeout(_batchTimer);
    _batchTimer = setTimeout(async () => {
      const cards = showLoadingBadges();
      if (cards.length) await batchScore(cards);
    }, 400);
  }

  // ── Detail page: wait for DOM ──────────────────────────────────────────────
  // Polls for the LazyColumn — the outermost stable container for the job detail
  // pane. Waiting for this (rather than the deeper "aboutTheJob" section) means
  // the banner can inject at the very top, above the job title, as soon as the
  // container exists. LinkedIn renders this asynchronously after SPA navigation
  // so we retry up to 5 seconds (20 × 250ms) before giving up.
  async function waitForDetailDOM() {
    for (let i = 0; i < 20; i++) {
      const el = document.querySelector('[data-component-type="LazyColumn"]');
      if (el) return el;
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  }

  // ── Detail page: full scoring flow ────────────────────────────────────────
  // Two-phase — mirrors the search-page flow:
  //   Phase 1: inject loading banner (immediate visual feedback)
  //   Phase 2a: rule-based score (instant, updates banner)
  //   Phase 2b: AI score via JS_BATCH_SCORE (single job, updates banner again)
  //
  // Cache: reuses the same chrome.storage.local score cache as search badges.
  // Panel: opened by the "View full analysis →" button in the banner (no auto-open).
  async function handleDetailPage() {
    if (_detailProcessing) return;
    _detailProcessing = true;

    try {
      // Wait for LinkedIn to finish rendering the detail pane
      const aboutJobEl = await waitForDetailDOM();
      if (!aboutJobEl) return; // DOM never arrived — give up silently

      // Inject loading banner before any async work so user gets instant feedback
      window.injectDetailBanner();

      // Extract job data using stable selectors (URL, document.title, data-testid)
      const jobData = window.extractDetailPageData?.();
      if (!jobData?.title) {
        window.removeDetailBanner();
        return;
      }

      const profile     = _prefs?.profile || {};
      const profileHash = _profileHash(profile);
      const hasProfile  = !!(
        profile.mustHaveSkills?.length ||
        profile.primarySkills?.length  ||
        profile.targetRoles?.length
      );

      // ── Cache check ──────────────────────────────────────────────────────
      if (jobData.jobId) {
        const scoreCache = await _loadScoreCache();
        const entry      = scoreCache[jobData.jobId];
        if (_isValidCacheEntry(entry, profileHash)) {
          window.updateDetailBanner(entry.result, jobData);
          return;
        }
      }

      // ── Phase 2a: rule-based score (local, instant) ──────────────────────
      const ruleResult = window.scoreJob(jobData, profile);
      window.updateDetailBanner(ruleResult, jobData);

      // ── Phase 2b: AI score ───────────────────────────────────────────────
      if (hasProfile) {
        try {
          const res = await chrome.runtime.sendMessage({
            type:    'JS_BATCH_SCORE',
            profile,
            jobs:    [jobData],
          });

          if (res.ok && res.results?.length) {
            const ai = res.results[0];
            const result = {
              score:           ai.score,
              label:           ai.label,
              text:            ai.text,
              verdict:         ai.verdict,
              criteria:        ruleResult.criteria        || [],
              tips:            ruleResult.tips            || [],
              recommendation:  ruleResult.recommendation  || null,
              missingCritical: ruleResult.missingCritical || [],
              warnings:        ruleResult.warnings        || [],
              confidence:      ruleResult.confidence      || 1,
              metCount:        ruleResult.metCount        || 0,
              total:           ruleResult.total           || 0,
            };

            window.updateDetailBanner(result, jobData);

            // Cache the AI result so the next visit to this job is instant
            if (result.score !== null && jobData.jobId) {
              const scoreCache = await _loadScoreCache();
              const updated    = _pruneCache(
                { ...scoreCache, [jobData.jobId]: { result, timestamp: Date.now(), profileHash } },
                profileHash
              );
              _saveScoreCache(updated);
            }
          }
          // If res.needs_upgrade or res.ok=false: rule result stays shown — silent fallback
        } catch (_) {
          // Network/timeout: rule result stays shown
        }
      }
    } finally {
      _detailProcessing = false;
    }
  }

  // ── AI panel hook ──────────────────────────────────────────────────────────
  window._jobsiftOnPanelOpen = function (jobData, panelEl, anchor) {
    if (typeof window.analyzeJobDeep === 'function') {
      window.analyzeJobDeep(jobData, panelEl, anchor, _prefs);
    }
  };

  function updateExtensionBadge() {
    const green = document.querySelectorAll('.js-badge--green').length;
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: green }).catch(() => {});
  }

  // ── Continuous background scanner ──────────────────────────────────────────
  // Runs every 2 seconds on jobs pages. Picks up any cards that slipped through
  // the observer or poll timers due to SPA navigation timing gaps.
  // This is the safety net: even if every other mechanism fails, within 2s of
  // cards appearing in the DOM they will be found and scored.
  function startContinuousScanning() {
    stopContinuousScanning();
    if (!isJobsPage() || isDetailPage()) return;
    _continuousScanner = setInterval(() => {
      if (!isJobsPage() || isDetailPage()) return;
      const unscored = (window.findAllJobCards?.() || []).filter(c => {
        const li = c.closest('li') || c;
        return !li.dataset.jsDone && !li.dataset.jsProcessing && !li.querySelector('.js-badge');
      });
      if (unscored.length > 0) scheduleBatch();
    }, 2000);
  }

  function stopContinuousScanning() {
    if (_continuousScanner) { clearInterval(_continuousScanner); _continuousScanner = null; }
  }

  // ── Search page polling + observer ─────────────────────────────────────────
  function startPolling() {
    _pollTimers.forEach(clearTimeout);
    _pollTimers = [];
    if (!isJobsPage() || isDetailPage()) return;
    [300, 1200, 3000, 6000, 12000].forEach(ms => {
      _pollTimers.push(setTimeout(scheduleBatch, ms));
    });
  }

  function startObserver() {
    if (!isJobsPage() || isDetailPage()) return;
    window.setupObserver(() => scheduleBatch(), window.findJobCardsIn);
  }

  // ── Reprocess (profile change) ─────────────────────────────────────────────
  function reprocessAll() {
    window.disconnectObserver?.();
    stopContinuousScanning();

    document.querySelectorAll('.js-badge, .js-panel, #js-filter-bar').forEach(el => el.remove());
    document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
      delete el.dataset.jsDone;
      delete el.dataset.jsProcessing;
    });
    window.hidePanel?.();
    window.resetFilter?.();
    window.removeDetailBanner?.();

    _store.clear();
    _detailProcessing = false;
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});

    if (isDetailPage()) {
      handleDetailPage();
    } else if (isJobsPage()) {
      startPolling();
      startObserver();
      startContinuousScanning();
    }
  }

  function listenForChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.jobsift) {
        const newPrefs = changes.jobsift.newValue;

        const oldHash = _profileHash(_prefs?.profile);
        const newHash = _profileHash(newPrefs?.profile);
        if (oldHash !== newHash) {
          _clearScoreCache();
        }

        _prefs = newPrefs;
        reprocessAll();
      }
    });
  }

  // ── SPA navigation watcher ─────────────────────────────────────────────────
  // Polls location.href every 400ms. Separates two kinds of URL change:
  //
  //   PATHNAME change (e.g. /feed/ → /jobs/search/):
  //     Major navigation. Full reset: clear badges, reset filter, restart
  //     observer, start continuous scanner. Badges must be re-scored from scratch.
  //
  //   QUERY-PARAM-ONLY change (e.g. ?currentJobId=123 → ?currentJobId=456):
  //     User clicked a different card on the same page. Do NOT reset the filter
  //     bar or wipe badges — just let the right-pane update. The left-panel
  //     badges are already correct.
  //
  // This fixes two bugs:
  //   1. Every card click on collections/recommended/ was wiping the filter bar.
  //   2. The observer/poll timers could miss cards due to URL changing twice
  //      quickly — the continuous scanner is the guaranteed fallback.

  let _lastUrl = location.href;

  function watchNavigation() {
    if (_navObserver) return;

    _navObserver = setInterval(() => {
      if (location.href === _lastUrl) return;
      _lastUrl = location.href;

      const newPathname      = location.pathname;
      const pathnameChanged  = newPathname !== _lastPathname;
      _lastPathname          = newPathname;

      if (pathnameChanged) {
        // Full reset — we're on a genuinely different page
        document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
          delete el.dataset.jsDone;
          delete el.dataset.jsProcessing;
        });
        window.resetFilter?.();
        window.removeDetailBanner?.();
        _detailProcessing = false;
      }
      // Query-param-only change (e.g. currentJobId): skip reset entirely.
      // The card list hasn't changed — only the right-pane detail changed.

      if (isDetailPage()) {
        if (pathnameChanged) setTimeout(() => handleDetailPage(), 300);
      } else if (isJobsPage()) {
        if (pathnameChanged) {
          // Start fresh observer and continuous scanner for the new page
          startObserver();
          stopContinuousScanning();
          startContinuousScanning();
          startPolling();
        }
        // Always run a batch scan — catches cards on both pathname changes and
        // the edge case where currentJobId change coincides with new cards
        // appearing (e.g. infinite scroll loading while changing cards)
        scheduleBatch();
      } else {
        // Navigated away from jobs entirely
        stopContinuousScanning();
        window.disconnectObserver?.();
        chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});
      }
    }, 400);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    if (_initDone) return;
    _initDone = true;
    _prefs    = await loadPreferences();

    listenForChanges();
    watchNavigation();

    if (isDetailPage()) {
      handleDetailPage();
    } else if (isJobsPage()) {
      startPolling();
      startObserver();
      startContinuousScanning();
    }
  }

  init();

}());