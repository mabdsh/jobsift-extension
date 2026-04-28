// JobSift Content v2.3.0
// v2.3.0: fix SPA navigation — badges now appear when clicking Jobs tab from any LinkedIn page
// v2.2.0: score cache in chrome.storage.local + filter reset on navigation/reprocess

(function () {
  'use strict';
  if (window._jsContent) return;
  window._jsContent = true;

  let _prefs       = null;
  let _initDone    = false;
  let _batchTimer  = null;
  let _pollTimers  = [];
  let _navObserver = null;

  const _store = new Map();

  // ── Preferences ────────────────────────────────────────────────────────────
  async function loadPreferences() {
    return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift || null)));
  }

  function isJobsPage() {
    const p = location.pathname;
    return p.startsWith('/jobs') || p.includes('/collections/') || p.startsWith('/search/results/jobs');
  }

  // ── Score cache ────────────────────────────────────────────────────────────
  // Caches AI + rule scores in chrome.storage.local so repeat visits to the
  // same jobs page don't trigger a Groq API call.
  //
  // Cache key:   jobId
  // Invalidated: profile change (profileHash mismatch) or age > 24 hours
  // Max size:    500 entries — older entries pruned on write
  //
  // Storage key: 'jobsift_scores' → { [jobId]: { result, timestamp, profileHash } }

  const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours
  const CACHE_MAX     = 500;

  // Generates a string that changes whenever scoring-relevant profile fields change.
  // Sorts each array so the hash is order-independent (adding skills in a different
  // order doesn't invalidate the cache).
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
    if (entry.profileHash !== profileHash) return false; // profile changed
    return (Date.now() - (entry.timestamp || 0)) < CACHE_TTL_MS;
  }

  // Removes stale entries (wrong profile hash or expired).
  // Caps at CACHE_MAX keeping the most recent entries.
  function _pruneCache(cache, profileHash) {
    const now     = Date.now();
    const valid   = Object.entries(cache).filter(
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

  // ── Phase 1: inject loading badges ────────────────────────────────────────
  function showLoadingBadges() {
    const cards = window.findAllJobCards().filter(c => {
      const li = c.closest('li') || c;
      return !li.dataset.jsDone && !li.dataset.jsProcessing;
    });
    cards.forEach(card => window.injectLoadingBadge(card));
    return cards;
  }

  // ── Phase 2: batch score with cache ───────────────────────────────────────
  async function batchScore(cards) {
    if (!cards.length) return;

    const profile     = _prefs?.profile || {};
    const profileHash = _profileHash(profile);
    const hasProfile  = !!(
      profile.mustHaveSkills?.length ||
      profile.primarySkills?.length  ||
      profile.targetRoles?.length
    );

    // Extract job data for all cards
    const jobs = cards.map(card => {
      const jobData = window.extractJobData(card);
      if (jobData.jobId) _store.set(jobData.jobId, { jobData });
      return jobData;
    });

    // ── Cache check ─────────────────────────────────────────────────────────
    // Separate cards into cached (apply immediately) and uncached (need scoring).
    const scoreCache    = await _loadScoreCache();
    const cachedItems   = [];   // { jobData, li, result }
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

    // Apply cached results immediately — no API call, no wait
    cachedItems.forEach(({ jobData, li, result }) => {
      if (jobData.jobId) _store.set(jobData.jobId, { jobData, result });
      window.updateBadgeWithResult(li, result, jobData);
    });

    // If everything was cached, just refresh the UI and return
    if (!uncachedCards.length) {
      window.injectFilterBar();
      window.refreshFilterBar();
      updateExtensionBadge();
      return;
    }

    // ── Rule-based scoring (local, instant, always runs) ────────────────────
    const ruleResults = new Map();
    uncachedJobs.forEach(jd => {
      const r   = window.scoreJob(jd, profile);
      const key = jd.jobId || `${jd.title}|${jd.company}`;
      ruleResults.set(key, r);
    });

    // ── AI scoring (skipped if no meaningful profile) ────────────────────────
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
      } catch (_) {
        // Network error or timeout — fall through to rule-based silently
      }
    }

    // ── Merge results and update badges ─────────────────────────────────────
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
        (jobData.jobId
          ? aiResults.find(r => r.jobId === jobData.jobId)
          : null) ||
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
        // Cache only meaningful scores — don't cache null/gray results from
        // empty profiles since they'd just need re-scoring on next visit
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

    // Persist new cache entries (merged with existing, pruned to max)
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

  // Debounce: collect cards for 400ms then score together
  function scheduleBatch() {
    clearTimeout(_batchTimer);
    _batchTimer = setTimeout(async () => {
      const cards = showLoadingBadges();
      if (cards.length) await batchScore(cards);
    }, 400);
  }

  // ── AI hook ────────────────────────────────────────────────────────────────
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

    // Reset filter state so new cards aren't hidden by a stale filter value.
    // Must come AFTER removing the filter bar DOM element.
    window.resetFilter?.();

    _store.clear();
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});
    startPolling();
    startObserver();
  }

  function listenForChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.jobsift) {
        const newPrefs = changes.jobsift.newValue;

        // If the profile itself changed, clear the score cache so jobs
        // are re-scored against the new profile on the next visit.
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

  let _lastUrl = location.href;

  function watchNavigation() {
    if (_navObserver) return;

    // setInterval URL polling is more reliable than MutationObserver for SPA
    // navigation detection. LinkedIn's pushState fires BEFORE DOM mutations,
    // so a MutationObserver callback can fire while location.href still shows
    // the old URL — causing the URL-change logic to miss the navigation entirely.
    //
    // A 400ms interval with a string compare is immune to these race conditions,
    // uses negligible CPU (<1μs per tick), and guarantees detection within 400ms.
    _navObserver = setInterval(() => {
      if (location.href === _lastUrl) return;
      _lastUrl = location.href;

      // Clear scored-card markers so new page cards get fresh badges
      document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
        delete el.dataset.jsDone;
        delete el.dataset.jsProcessing;
      });

      // Reset filter so new page always starts at "All"
      window.resetFilter?.();

      if (isJobsPage()) {
        // 200ms lets LinkedIn begin rendering the job list before we scan for cards
        setTimeout(() => { startPolling(); startObserver(); }, 200);
      } else {
        chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});
      }
    }, 400);
  }

  async function init() {
    if (_initDone) return;
    _initDone = true;
    _prefs    = await loadPreferences();

    // Always set up these listeners regardless of the current page.
    // watchNavigation detects SPA navigation to /jobs from any other page
    // (e.g. feed → jobs tab click). Without this, users who start on /feed
    // never get badges until they reload — the observer simply wasn't running.
    listenForChanges();
    watchNavigation();

    // Scoring only starts if already on a jobs page on initial load.
    // If the user navigates here later, watchNavigation handles it.
    if (isJobsPage()) {
      startPolling();
      startObserver();
    }
  }

  init();

}());