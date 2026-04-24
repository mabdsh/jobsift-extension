// JobSift AI Analyzer v2.1.0
// Panel deep analysis only — badge scoring is handled by batch in content.js

(function () {
  'use strict';
  if (window._jsAI) return;
  window._jsAI = true;

  const _deepCache = new Map();

  const JD_SELECTORS = [
    '.jobs-description-content__text',
    '.jobs-description__content',
    '[class*="jobs-description-content__text"]',
    '.jobs-box__html-content',
  ];

  function getFullDescription() {
    for (const s of JD_SELECTORS) {
      try {
        const el = document.querySelector(s);
        if (el?.textContent.trim().length > 150)
          return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 4500);
      } catch (_) {}
    }
    return null;
  }

  // Deep analysis for the panel — runs after badge is already scored
  async function analyzeJobDeep(jobData, panelEl, li, prefs) {
    const cacheKey = jobData.jobId || jobData.title;
    if (!cacheKey) return;

    if (_deepCache.has(cacheKey)) {
      renderDeepResult(panelEl, _deepCache.get(cacheKey));
      return;
    }

    renderLoading(panelEl);

    try {
      await sleep(250); // Let the panel render first
      const fullDesc = getFullDescription();

      const res = await chrome.runtime.sendMessage({
        type: 'JS_ANALYZE_JOB',
        profile: prefs?.profile || {},
        jobData,
        fullDescription: fullDesc || jobData.rawText || '',
      });

      if (!res.ok) throw new Error(res.error);
      _deepCache.set(cacheKey, res.result);
      renderDeepResult(panelEl, res.result);
    } catch (err) {
      renderError(panelEl, err.message);
    }
  }

  // ── Renderers ──────────────────────────────────────────────────────────────
  function renderLoading(panel) {
    const sec = getOrCreate(panel);
    sec.innerHTML = `
      <div class="js-ai-hdr">
        <span class="js-ai-badge">AI</span>
        <span class="js-ai-title">Deep analysis</span>
        <span class="js-ai-loading">Reading full job description…</span>
      </div>
      <div class="js-shimmer">
        <div class="js-shimmer-ln js-shimmer-ln--lg"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
        <div class="js-shimmer-ln js-shimmer-ln--sm"></div>
      </div>`;
  }

  function renderDeepResult(panel, r) {
    const sec = getOrCreate(panel);
    let html = `<div class="js-ai-hdr">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
    </div>`;

    if (r.summary)      html += `<div class="js-ai-summary">${r.summary}</div>`;
    if (r.strengths?.length) {
      html += '<div class="js-ai-list"><div class="js-ai-list-ttl js-ai-list-ttl--strength">Strengths</div>';
      r.strengths.forEach(s => { html += `<div class="js-ai-list-item js-ai-list-item--strength">${s}</div>`; });
      html += '</div>';
    }
    if (r.gaps?.length) {
      html += '<div class="js-ai-list"><div class="js-ai-list-ttl js-ai-list-ttl--gap">Gaps to address</div>';
      r.gaps.forEach(g => { html += `<div class="js-ai-list-item js-ai-list-item--gap">${g}</div>`; });
      html += '</div>';
    }
    if (r.tips?.length) {
      html += '<div class="js-ai-list"><div class="js-ai-list-ttl js-ai-list-ttl--tip">Application tips</div>';
      r.tips.forEach(t => { html += `<div class="js-ai-list-item js-ai-list-item--tip">${t}</div>`; });
      html += '</div>';
    }
    if (r.insights) html += `<div class="js-ai-insight">💡 ${r.insights}</div>`;

    sec.innerHTML = html;
  }

  function renderError(panel, msg) {
    const sec = getOrCreate(panel);
    const noKey = msg?.includes('NO_API_KEY') || msg?.includes('INVALID_KEY');
    const rate  = msg?.includes('RATE_LIMIT');
    const body  = rate ? 'Rate limit reached — try again shortly.'
                : noKey ? 'Set up the API key in service-worker.js to enable deep analysis.'
                : 'Analysis unavailable — scores are AI-generated from card data.';
    sec.innerHTML = `<div class="js-ai-hdr">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
    </div>
    <div class="js-ai-prompt js-ai-prompt--muted">${body}</div>`;
  }

  function getOrCreate(panel) {
    let sec = panel.querySelector('.js-ai-section');
    if (!sec) {
      sec = document.createElement('div');
      sec.className = 'js-ai-section';
      const criteria = panel.querySelector('.js-criteria');
      criteria ? panel.insertBefore(sec, criteria) : panel.appendChild(sec);
    }
    return sec;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.analyzeJobDeep = analyzeJobDeep;

}());
