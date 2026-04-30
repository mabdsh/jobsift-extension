// Rolevance Content v5.0
// v2.5.0: Indeed support — badges on search cards, banner on right pane + /viewjob.
// v2.4.0: LinkedIn job detail page support — auto-scores /jobs/view/ URLs.
// v2.3.0: fix SPA navigation — badges now appear when clicking Jobs tab.
// v2.2.0: score cache in chrome.storage.local + filter reset on navigation/reprocess

(function () {
  'use strict';
  if (window._jsContent) return;
  window._jsContent = true;

  let _prefs                = null;
  let _initDone             = false;
  let _batchTimer           = null;
  let _pollTimers           = [];
  let _navObserver          = null;
  let _detailProcessing     = false;
  let _indeedRightPaneProcessing = false;
  let _continuousScanner    = null;
  let _lastPathname         = location.pathname;
  let _lastIndeedJk         = new URLSearchParams(location.search).get('jk') || '';

  const _store = new Map();

  // ── Preferences ────────────────────────────────────────────────────────────
  async function loadPreferences() {
    return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift || null)));
  }

  // ── Page type detection ────────────────────────────────────────────────────

  function isIndeedPage() {
    return location.hostname.includes('indeed.com');
  }

  // LinkedIn /jobs/view/... OR Indeed /viewjob
  function isDetailPage() {
    if (isIndeedPage()) return location.pathname === '/viewjob';
    return /\/jobs\/view\/\d+/.test(location.pathname);
  }

  // Any LinkedIn jobs page OR any Indeed page that has job cards.
  // For Indeed, delegates to window.isIndeedSearchPage (defined in scraper.js)
  // which uses a DOM-based fallback to catch the homepage feed, recommendation
  // pages, and any other path that renders #mosaic-provider-jobcards.
  function isJobsPage() {
    if (isIndeedPage()) {
      // Direct view page is handled by isDetailPage() — exclude it here
      if (location.pathname === '/viewjob') return true;
      // Delegate to scraper.js which has the DOM-based catch-all
      if (typeof window.isIndeedSearchPage === 'function') {
        return window.isIndeedSearchPage();
      }
      // Fallback if scraper hasn't loaded yet
      const p = location.pathname;
      return p === '/jobs' || p.startsWith('/jobs') || /\/q-.*-jobs/.test(p);
    }
    const p = location.pathname;
    return p.startsWith('/jobs') || p.includes('/collections/') ||
           p.startsWith('/search/results/jobs');
  }

  // ── Daily stats ───────────────────────────────────────────────────────────
  // Lightweight counter written to chrome.storage.local after each new score.
  // Resets automatically each day. Read by the popup dashboard.
  const DAILY_STATS_KEY = 'rolevance_daily';

  function _getTodayDate() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
  }

  function _incrementDailyStats(label) {
    const today = _getTodayDate();
    chrome.storage.local.get(DAILY_STATS_KEY, d => {
      const prev  = d[DAILY_STATS_KEY] || {};
      const stats = (prev.date === today)
        ? { date: today, jobsScored: prev.jobsScored || 0, strongMatches: prev.strongMatches || 0 }
        : { date: today, jobsScored: 0, strongMatches: 0 };

      stats.jobsScored++;
      if (label === 'green') stats.strongMatches++;

      chrome.storage.local.set({ [DAILY_STATS_KEY]: stats });
    });
  }

  // ── Score cache ────────────────────────────────────────────────────────────
  // Shared between search-page batch scoring and detail-page scoring.
  // Key: jobId. Invalidated by profile change or age > 24 hours. Max 500 entries.

  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const CACHE_MAX    = 500;

  function _profileHash(profile) {
    if (!profile) return ''
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
      // currentTitle and careerGoal are sent to the AI in buildProfileSummary
      // and affect scores, so they must invalidate the cache when changed.
      String(profile.currentTitle || ''),
      String(profile.careerGoal   || ''),
    ].join('|')
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
    if (isIndeedPage()) {
      const cards = (window.findAllIndeedCards?.() || []).filter(c =>
        !c.dataset.jsDone && !c.dataset.jsProcessing
      );
      cards.forEach(card => window.injectIndeedLoadingBadge?.(card));
      return cards;
    }
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

    const onIndeed     = isIndeedPage();
    const profile      = _prefs?.profile || {};
    const profileHash  = _profileHash(profile);
    const hasProfile   = !!(
      profile.mustHaveSkills?.length ||
      profile.primarySkills?.length  ||
      profile.targetRoles?.length
    );

    // Extract job data using the right scraper per platform
    const jobs = cards.map(card => {
      const jobData = onIndeed
        ? (window.extractIndeedJobData?.(card) || {})
        : window.extractJobData(card);
      if (jobData.jobId) _store.set(jobData.jobId, { jobData });
      return jobData;
    });

    const scoreCache    = await _loadScoreCache();
    const cachedItems   = [];
    const uncachedCards = [];
    const uncachedJobs  = [];

    cards.forEach((card, i) => {
      // On Indeed the card div is the anchor; on LinkedIn it's the li
      const anchor  = onIndeed ? card : (card.closest('li') || card);
      const jobData = jobs[i];
      const entry   = jobData.jobId ? scoreCache[jobData.jobId] : null;

      if (_isValidCacheEntry(entry, profileHash)) {
        cachedItems.push({ jobData, anchor, result: entry.result });
      } else {
        uncachedCards.push(card);
        uncachedJobs.push(jobData);
      }
    });

    cachedItems.forEach(({ jobData, anchor, result }) => {
      if (jobData.jobId) _store.set(jobData.jobId, { jobData, result });
      if (onIndeed) {
        window.updateIndeedBadgeWithResult?.(anchor, result, jobData);
      } else {
        window.updateBadgeWithResult(anchor, result, jobData);
      }
    });

    if (!uncachedCards.length) {
      _finishBatch(onIndeed);
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
      const anchor  = onIndeed ? card : (card.closest('li') || card);
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
        if (onIndeed) window.updateIndeedBadgeWithResult?.(anchor, result, jobData);
        else          window.updateBadgeWithResult(anchor, result, jobData);
        if (result.score !== null) _incrementDailyStats(result.label);
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

      if (onIndeed) window.updateIndeedBadgeWithResult?.(anchor, result, jobData);
      else          window.updateBadgeWithResult(anchor, result, jobData);
      if (result.score !== null) _incrementDailyStats(result.label);
    });

    if (Object.keys(newCacheEntries).length) {
      const updated = _pruneCache(
        { ...scoreCache, ...newCacheEntries },
        profileHash
      );
      _saveScoreCache(updated);
    }

    _finishBatch(onIndeed);
  }

  // Injects/refreshes the filter bar and updates the extension badge count
  // after a batch completes. Separate function so cached-hit early-return path
  // also calls it without duplicating the three lines.
  function _finishBatch(onIndeed) {
    if (onIndeed) {
      window.injectIndeedFilterBar?.();
      window.refreshIndeedFilterBar?.();
    } else {
      window.injectFilterBar();
      window.refreshFilterBar();
    }
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
  // Before triggering AI analysis, ensure the clicked job is loaded in the
  // LinkedIn right pane. On the two-pane search layout, getFullDescription()
  // reads from the right pane DOM — if the user clicks a badge without first
  // clicking the job card, the pane still shows the previously active job's
  // description. This fix silently clicks the correct card and waits for the
  // pane to update before handing off to analyzeJobDeep.
  // Indeed is excluded — its panel reads card data directly, not the right pane.

  async function _ensureLinkedInJobLoaded(jobId) {
    if (!jobId || isIndeedPage()) return;

    // Read which job LinkedIn currently has active in the right pane.
    // The active card carries both aria-current="page" and the
    // jobs-search-results-list__list-item--active class (seen in DOM snapshot).
    const activeEl  = document.querySelector(
      '.jobs-search-results-list__list-item--active [data-job-id],' +
      '[data-job-id][aria-current="page"]'
    );
    const activeId  = activeEl?.dataset?.jobId
                   || activeEl?.closest('[data-job-id]')?.dataset?.jobId;

    if (String(activeId) === String(jobId)) return; // already loaded — nothing to do

    // Find the job card link for the target job and click it silently.
    // LinkedIn loads the right pane via AJAX when any card link is clicked.
    const link = document.querySelector(
      `[data-occludable-job-id="${jobId}"] a.job-card-container__link,` +
      `[data-job-id="${jobId}"] a.job-card-container__link`
    );

    if (!link) return; // card not in DOM (occluded/not rendered) — proceed anyway

    link.click();

    // Poll until LinkedIn marks the target job as active in the list
    // (aria-current="page" moves to the newly clicked card).
    // Max wait: 3 seconds in 150ms steps.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 150));
      const nowActive = document.querySelector(
        '.jobs-search-results-list__list-item--active [data-job-id],' +
        '[data-job-id][aria-current="page"]'
      );
      const nowId = nowActive?.dataset?.jobId
                 || nowActive?.closest('[data-job-id]')?.dataset?.jobId;
      if (String(nowId) === String(jobId)) {
        // Job is now active — wait one more tick for description HTML to render
        await new Promise(r => setTimeout(r, 400));
        break;
      }
    }
  }

  // panelCheckResult: { allowed, trial, limit, usedToday, resetAt }
  //   limit === null  → Pro / Trial (unlimited)
  //   limit !== null  → Free (capped) — ai-analyzer shows upgrade teaser
  // result: the rule-based scoring result — used to personalise the teaser
  window._jobsiftOnPanelOpen = async function (jobData, panelEl, anchor, panelCheckResult, result) {
    await _ensureLinkedInJobLoaded(jobData.jobId);

    if (typeof window.analyzeJobDeep === 'function') {
      window.analyzeJobDeep(jobData, panelEl, anchor, _prefs, panelCheckResult, result);
    }
  };

  // ── Indeed: right-pane MutationObserver ────────────────────────────────────
  // On some Indeed pages (homepage job feed, recommendation pages), clicking a
  // card does NOT change the URL — Indeed's own JS loads the right pane via AJAX
  // while the URL stays the same. Our URL watcher misses this entirely.
  //
  // The fix: watch for content changes inside the right-pane container.
  // `section#job-full-details` → `div#vjs-container` is the stable container
  // that Indeed uses for the right-pane job detail view across all page types.
  // When the job title element changes (new job loaded), we trigger scoring.

  let _indeedPaneObserver    = null;
  let _lastIndeedPaneTitle   = '';
  let _indeedPaneSetupTimer  = null;

  function setupIndeedRightPaneObserver() {
    if (_indeedPaneObserver) return;

    // Poll until the right-pane container exists — it may not be in the initial DOM
    _indeedPaneSetupTimer = setInterval(() => {
      const pane = document.querySelector('section#job-full-details, #vjs-container');
      if (!pane) return;
      clearInterval(_indeedPaneSetupTimer);
      _indeedPaneSetupTimer = null;

      _indeedPaneObserver = new MutationObserver(() => {
        // Read the current job title from the right pane — stable selector
        const titleEl = document.querySelector(
          '#vjs-container h2.jobsearch-JobInfoHeader-title span:first-child, ' +
          'section#job-full-details h2.jobsearch-JobInfoHeader-title span:first-child'
        );
        const currentTitle = titleEl?.textContent?.trim() || '';
        if (!currentTitle || currentTitle === _lastIndeedPaneTitle) return;

        _lastIndeedPaneTitle = currentTitle;
        // Debounce — mutations fire multiple times during a single pane load
        clearTimeout(window._indeedPaneTrigger);
        window._indeedPaneTrigger = setTimeout(() => {
          handleIndeedRightPane();
        }, 400);
      });

      _indeedPaneObserver.observe(pane, { childList: true, subtree: true });
    }, 600);
  }

  function disconnectIndeedRightPaneObserver() {
    if (_indeedPaneSetupTimer) { clearInterval(_indeedPaneSetupTimer); _indeedPaneSetupTimer = null; }
    if (_indeedPaneObserver)   { _indeedPaneObserver.disconnect(); _indeedPaneObserver = null; }
    _lastIndeedPaneTitle = '';
  }
  // then runs the same two-phase scoring flow as LinkedIn's detail page:
  //   Phase 1: rule-based score → banner updates immediately
  //   Phase 2: AI score → banner updates with better accuracy
  async function waitForIndeedDetailDOM() {
    for (let i = 0; i < 20; i++) {
      const el = document.querySelector(
        '#jobsearch-ViewjobPaneWrapper div.jobsearch-HeaderContainer, ' +
        'div.jobsearch-JobComponent div.jobsearch-HeaderContainer'
      );
      if (el) return el;
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  }

  async function handleIndeedRightPane() {
    if (_indeedRightPaneProcessing) return;
    _indeedRightPaneProcessing = true;

    try {
      const headerEl = await waitForIndeedDetailDOM();
      if (!headerEl) return;

      window.injectIndeedDetailBanner?.();

      const jobData = window.extractIndeedDetailData?.();
      if (!jobData?.title) { window.removeIndeedDetailBanner?.(); return; }

      const profile     = _prefs?.profile || {};
      const profileHash = _profileHash(profile);
      const hasProfile  = !!(
        profile.mustHaveSkills?.length ||
        profile.primarySkills?.length  ||
        profile.targetRoles?.length
      );

      // Cache check
      if (jobData.jobId) {
        const scoreCache = await _loadScoreCache();
        const entry      = scoreCache[jobData.jobId];
        if (_isValidCacheEntry(entry, profileHash)) {
          window.updateIndeedDetailBanner?.(entry.result, jobData);
          return;
        }
      }

      // Phase 2a: rule-based (instant)
      const ruleResult = window.scoreJob(jobData, profile);
      window.updateIndeedDetailBanner?.(ruleResult, jobData);

      // Phase 2b: AI score
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
            window.updateIndeedDetailBanner?.(result, jobData);
            if (result.score !== null && jobData.jobId) {
              const scoreCache = await _loadScoreCache();
              const updated    = _pruneCache(
                { ...scoreCache, [jobData.jobId]: { result, timestamp: Date.now(), profileHash } },
                profileHash
              );
              _saveScoreCache(updated);
            }
          }
        } catch (_) {}
      }
    } finally {
      _indeedRightPaneProcessing = false;
    }
  }

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
    const onIndeed = isIndeedPage();
    _continuousScanner = setInterval(() => {
      try {
        if (!isJobsPage() || isDetailPage()) return;
        let unscored;
        if (onIndeed) {
          unscored = (window.findAllIndeedCards?.() || []).filter(c =>
            !c.dataset.jsDone && !c.dataset.jsProcessing && !c.querySelector('.js-badge')
          );
        } else {
          unscored = (window.findAllJobCards?.() || []).filter(c => {
            const li = c.closest('li') || c;
            return !li.dataset.jsDone && !li.dataset.jsProcessing && !li.querySelector('.js-badge');
          });
        }
        if (unscored.length > 0) scheduleBatch();
      } catch (err) {
        console.warn('[Rolevance] Continuous scanner error:', err);
      }
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
    // Use the platform-appropriate card finder for the MutationObserver
    const finder = isIndeedPage()
      ? window.findIndeedCardsIn
      : window.findJobCardsIn;
    window.setupObserver(() => scheduleBatch(), finder);
    // Also watch the Indeed right pane for content changes that don't trigger URL changes
    if (isIndeedPage()) setupIndeedRightPaneObserver();
  }

  // ── Reprocess (profile change) ─────────────────────────────────────────────
  function reprocessAll() {
    window.disconnectObserver?.();
    stopContinuousScanning();
    disconnectIndeedRightPaneObserver();

    // Remove all injected Rolevance elements on both platforms
    document.querySelectorAll(
      '.js-badge, .js-panel, #js-filter-bar, #js-indeed-filter-bar'
    ).forEach(el => el.remove());
    document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
      delete el.dataset.jsDone;
      delete el.dataset.jsProcessing;
    });
    window.hidePanel?.();

    if (isIndeedPage()) {
      window.resetIndeedFilter?.();
      window.removeIndeedDetailBanner?.();
    } else {
      window.resetFilter?.();
      window.removeDetailBanner?.();
    }

    _store.clear();
    _detailProcessing          = false;
    _indeedRightPaneProcessing = false;
    chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});

    if (isDetailPage()) {
      if (isIndeedPage()) handleIndeedRightPane();
      else                handleDetailPage();
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

      const newPathname     = location.pathname;
      const pathnameChanged = newPathname !== _lastPathname;
      _lastPathname         = newPathname;

      if (pathnameChanged) {
        // Full reset — genuinely different page
        document.querySelectorAll('[data-js-done],[data-js-processing]').forEach(el => {
          delete el.dataset.jsDone;
          delete el.dataset.jsProcessing;
        });
        if (isIndeedPage()) {
          window.resetIndeedFilter?.();
          window.removeIndeedDetailBanner?.();
          _indeedRightPaneProcessing = false;
        } else {
          window.resetFilter?.();
          window.removeDetailBanner?.();
        }
        _detailProcessing = false;
      }

      if (isDetailPage()) {
        // LinkedIn /jobs/view/ or Indeed /viewjob (pathname change)
        if (pathnameChanged) {
          if (isIndeedPage()) setTimeout(() => handleIndeedRightPane(), 300);
          else                setTimeout(() => handleDetailPage(), 300);
        }
      } else if (isJobsPage()) {
        if (pathnameChanged) {
          startObserver();
          stopContinuousScanning();
          startContinuousScanning();
          startPolling();
        } else if (isIndeedPage()) {
          // Query-param change on Indeed — check if a card was clicked (jk changed)
          const newJk = new URLSearchParams(location.search).get('jk') || '';
          if (newJk && newJk !== _lastIndeedJk) {
            _lastIndeedJk = newJk;
            // Small delay lets the right pane start rendering before we scan it
            setTimeout(() => handleIndeedRightPane(), 400);
          }
        }
        // Always scan for any new unscored cards (including after card click on either platform)
        scheduleBatch();
      } else {
        // Navigated away from jobs entirely
        stopContinuousScanning();
        disconnectIndeedRightPaneObserver();
        window.disconnectObserver?.();
        chrome.runtime.sendMessage({ type: 'SET_BADGE', count: 0 }).catch(() => {});
      }
    }, 400);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    if (_initDone) return;
    _initDone = true;

    try {
      _prefs = await loadPreferences();
    } catch (err) {
      console.warn('[Rolevance] Failed to load preferences:', err);
      _prefs = null;
    }

    listenForChanges();
    watchNavigation();

    try {
      if (isDetailPage()) {
        // LinkedIn /jobs/view/ direct load OR Indeed /viewjob direct load
        if (isIndeedPage()) handleIndeedRightPane();
        else                handleDetailPage();
      } else if (isJobsPage()) {
        startPolling();
        startObserver();           // also starts setupIndeedRightPaneObserver if on Indeed
        startContinuousScanning();
        // Indeed: if page loaded with ?jk= already set, score the right pane
        if (isIndeedPage() && _lastIndeedJk) {
          setTimeout(() => handleIndeedRightPane(), 600);
        }
      }
    } catch (err) {
      console.warn('[Rolevance] Init error:', err);
    }
  }

  init();

}());