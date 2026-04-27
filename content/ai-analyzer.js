// JobSift AI Analyzer v3.0.0
// Renders deep analysis inside the panel — decision → summary →
// key requirements → strengths → gaps → tips → insights

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

  async function analyzeJobDeep(jobData, panelEl, li, prefs) {
    const cacheKey = jobData.jobId || jobData.title;
    if (!cacheKey) return;

    if (_deepCache.has(cacheKey)) {
      renderDeepResult(panelEl, _deepCache.get(cacheKey));
      return;
    }

    renderLoading(panelEl);

    try {
      await sleep(300);
      const fullDesc = getFullDescription();

      const res = await chrome.runtime.sendMessage({
        type:            'JS_ANALYZE_JOB',
        profile:         prefs?.profile || {},
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
    // Structured skeleton that previews the actual content layout
    sec.innerHTML = `
      <div class="js-ai-hdr">
        <span class="js-ai-badge">AI</span>
        <span class="js-ai-title">Deep analysis</span>
        <span class="js-ai-loading">Reading full job description…</span>
      </div>
      <div class="js-shimmer">
        <div class="js-shimmer-ln js-shimmer-ln--lg"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
        <div class="js-shimmer-ln js-shimmer-ln--xs" style="margin-top:4px"></div>
        <div class="js-shimmer-ln js-shimmer-ln--sm"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
      </div>`;
  }

  function renderDeepResult(panel, r) {
    const sec = getOrCreate(panel);

    let html = `<div class="js-ai-hdr">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
    </div>`;

    // Decision — the most important output, shown first and prominently
    // This is the AI's direct verdict: "Apply — your Laravel stack matches their core"
    if (r.decision) {
      html += `<div class="js-ai-decision">${_esc(r.decision)}</div>`;
    }

    // Summary — 2 sentence overview of role fit
    if (r.summary) {
      html += `<div class="js-ai-summary">${_esc(r.summary)}</div>`;
    }

    // Key requirements — what this job actually needs (extracted from JD)
    // Helps users quickly see if they qualify before reading further
    if (r.keyRequirements?.length) {
      html += `<div class="js-ai-list">
        <div class="js-ai-list-ttl js-ai-list-ttl--req">Key requirements</div>`;
      r.keyRequirements.forEach(req => {
        html += `<div class="js-ai-list-item js-ai-list-item--req">${_esc(req)}</div>`;
      });
      html += `</div>`;
    }

    // Strengths — specific matching points for THIS role
    if (r.strengths?.length) {
      html += `<div class="js-ai-list">
        <div class="js-ai-list-ttl js-ai-list-ttl--strength">Your strengths</div>`;
      r.strengths.forEach(s => {
        html += `<div class="js-ai-list-item js-ai-list-item--strength">${_esc(s)}</div>`;
      });
      html += `</div>`;
    }

    // Gaps — real gaps with what to do about them
    if (r.gaps?.length) {
      html += `<div class="js-ai-list">
        <div class="js-ai-list-ttl js-ai-list-ttl--gap">Gaps to address</div>`;
      r.gaps.forEach(g => {
        html += `<div class="js-ai-list-item js-ai-list-item--gap">${_esc(g)}</div>`;
      });
      html += `</div>`;
    }

    // Application tips — specific to this role
    if (r.tips?.length) {
      html += `<div class="js-ai-list">
        <div class="js-ai-list-ttl js-ai-list-ttl--tip">Application tips</div>`;
      r.tips.forEach(t => {
        html += `<div class="js-ai-list-item js-ai-list-item--tip">${_esc(t)}</div>`;
      });
      html += `</div>`;
    }

    // Insight — one non-obvious observation
    if (r.insights) {
      html += `<div class="js-ai-insight">💡 ${_esc(r.insights)}</div>`;
    }

    sec.innerHTML = html;
  }

  function renderError(panel, msg) {
    const sec  = getOrCreate(panel);
    const rate = msg?.toLowerCase().includes('rate_limit') || msg?.includes('RATE_LIMIT')
              || msg?.toLowerCase().includes('groq_parse');

    if (rate) {
      sec.innerHTML = `
        <div class="js-ai-hdr">
          <span class="js-ai-badge">AI</span>
          <span class="js-ai-title">Deep analysis</span>
        </div>
        <div class="js-ai-limit">
          <div class="js-ai-limit-icon">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
            </svg>
          </div>
          <div class="js-ai-limit-title">Analysis temporarily unavailable</div>
          <div class="js-ai-limit-sub">The AI service is busy — badge scores are unaffected.<br>Try opening this panel again in a moment.</div>
        </div>`;
    } else {
      sec.innerHTML = `
        <div class="js-ai-hdr">
          <span class="js-ai-badge">AI</span>
          <span class="js-ai-title">Deep analysis</span>
        </div>
        <div class="js-ai-prompt js-ai-prompt--muted">Analysis temporarily unavailable — badge scores are unaffected.</div>`;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Escape HTML to prevent XSS from AI output being injected into innerHTML.
  // The AI output is trusted content but sanitization is good practice.
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getOrCreate(panel) {
    let sec = panel.querySelector('.js-ai-section');
    if (!sec) {
      sec = document.createElement('div');
      sec.className = 'js-ai-section';
      // Insert before criteria so AI stays above the breakdown
      const criteria = panel.querySelector('.js-criteria');
      criteria ? panel.insertBefore(sec, criteria) : panel.appendChild(sec);
    }
    return sec;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.analyzeJobDeep = analyzeJobDeep;

}());