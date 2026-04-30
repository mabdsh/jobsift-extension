// Rolevance AI Analyzer v5.2
// v5.2: Visual differentiation per section, stagger reveal animation, pull-quote insight
// v3.1.0: getFullDescription() updated to use data-testid="expandable-text-box" —
//         the previous class-based selectors are dead on LinkedIn's new obfuscated DOM.
//         Renders deep analysis inside the panel: decision → summary →
//         key requirements → strengths → gaps → tips → insights

(function () {
  'use strict';
  if (window._jsAI) return;
  window._jsAI = true;

  const _deepCache = new Map();

  // ── Job description selectors ──────────────────────────────────────────────
  // Priority order:
  //   1. data-testid="expandable-text-box" — stable across LinkedIn DOM refactors (PRIMARY)
  //   2. #jobDescriptionText — stable Indeed ID (PRIMARY for Indeed)
  //   3. Legacy LinkedIn class selectors — fallbacks for older layouts
  const JD_SELECTORS = [
    '[data-testid="expandable-text-box"]',
    '#jobDescriptionText',
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

  // analyzeJobDeep — called from content.js after panel opens.
  // panelCheckResult carries the tier so we know whether to show the AI
  // analysis or the upgrade wall without making any API call.
  async function analyzeJobDeep(jobData, panelEl, li, prefs, panelCheckResult, result) {
    // Free tier: AI is completely locked — show upgrade teaser, no API call made.
    // Detection: trial===false AND limit is a finite number (Pro/Trial have limit:null).
    const pcr    = panelCheckResult || {};
    const isFree = !pcr.trial && pcr.limit !== null && pcr.limit !== undefined;
    if (isFree) { renderUpgradeTeaser(panelEl, result); return; }

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

  // Upgrade wall — shown to free users instead of calling the AI API.
  // Shows exactly what's locked so users know what they're missing.

  function renderUpgradeTeaser(panel, result) {
    const sec   = getOrCreate(panel);
    const score = result?.score;
    const label = result?.label || 'gray';

    let msg;
    if (score >= 70) {
      msg = "You're a strong candidate for this role. Unlock your coaching to see exactly why — and how to make your application stand out from other strong applicants.";
    } else if (score >= 50) {
      msg = "This role has real potential for you. Unlock your coaching to see the specific gaps and exactly how to address them before you apply.";
    } else {
      msg = "Unlock your coaching analysis to see the full picture — what this role actually needs, where you stand, and whether it's worth your time.";
    }

    sec.innerHTML = `
      <div class="js-ai-hdr">
        <span class="js-ai-badge">AI</span>
        <span class="js-ai-title">Deep analysis</span>
      </div>
      <div class="js-ai-upgrade">
        <p class="js-ai-upgrade-msg">${_esc(msg)}</p>
        <div class="js-ai-upgrade-features">
          <div class="js-ai-upgrade-feat">
            <span class="js-ai-upgrade-lock">🔒</span>
            <div>
              <span class="js-ai-upgrade-feat-name">Why you're a strong candidate</span>
              <span class="js-ai-upgrade-feat-hint"> — 2–3 specific reasons for this role</span>
            </div>
          </div>
          <div class="js-ai-upgrade-feat">
            <span class="js-ai-upgrade-lock">🔒</span>
            <div>
              <span class="js-ai-upgrade-feat-name">Close the gap</span>
              <span class="js-ai-upgrade-feat-hint"> — actionable steps for each gap</span>
            </div>
          </div>
          <div class="js-ai-upgrade-feat">
            <span class="js-ai-upgrade-lock">🔒</span>
            <div>
              <span class="js-ai-upgrade-feat-name">Your application game plan</span>
              <span class="js-ai-upgrade-feat-hint"> — cover letter angle, CV tip, interview prep</span>
            </div>
          </div>
          <div class="js-ai-upgrade-feat">
            <span class="js-ai-upgrade-lock">🔒</span>
            <div>
              <span class="js-ai-upgrade-feat-name">Coach's take</span>
              <span class="js-ai-upgrade-feat-hint"> — the non-obvious observation about this role</span>
            </div>
          </div>
        </div>
        <button class="js-ai-upgrade-btn"
          onclick="chrome.runtime.sendMessage({type:'JS_OPEN_UPGRADE'})">
          Unlock full analysis — $9/month
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="js-ai-upgrade-sub">5-day free trial · Cancel anytime</div>
      </div>`;
  }

  function renderDeepResult(panel, r) {
    const sec = getOrCreate(panel);

    // Stagger index — each section reveals 80ms after the previous
    let si = 0;
    const s = () => `js-ai-stagger js-ai-stagger-${++si}`;

    let html = `<div class="js-ai-hdr ${s()}">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
    </div>`;

    // Decision — full-width verdict in the AI section header area
    if (r.decision) {
      html += `<div class="js-ai-decision ${s()}">${_esc(r.decision)}</div>`;
    }

    // Summary — editorial prose, no label
    if (r.summary) {
      html += `<div class="js-ai-summary ${s()}">${_esc(r.summary)}</div>`;
    }

    // Key requirements — neutral chips (what the job needs)
    if (r.keyRequirements?.length) {
      html += `<div class="js-ai-section-block js-ai-block--req ${s()}">
        <div class="js-ai-block-ttl">What this role needs</div>
        <div class="js-ai-chips">`;
      r.keyRequirements.forEach(req => {
        html += `<span class="js-ai-chip js-ai-chip--req">${_esc(req)}</span>`;
      });
      html += `</div></div>`;
    }

    // Strengths — emerald-tinted rows with checkmark
    if (r.strengths?.length) {
      html += `<div class="js-ai-section-block js-ai-block--strength ${s()}">
        <div class="js-ai-block-ttl">Why you're a strong candidate</div>`;
      r.strengths.forEach(str => {
        html += `<div class="js-ai-match-row">
          <span class="js-ai-match-icon">✓</span>
          <span>${_esc(str)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // Gaps — amber-tinted rows with action arrow
    if (r.gaps?.length) {
      html += `<div class="js-ai-section-block js-ai-block--gap ${s()}">
        <div class="js-ai-block-ttl">Close the gap</div>`;
      r.gaps.forEach(g => {
        // Split "Gap description — specific action to take" format
        const sepIdx = g.indexOf(' — ');
        if (sepIdx !== -1) {
          const gapPart    = g.slice(0, sepIdx);
          const actionPart = g.slice(sepIdx + 3);
          html += `<div class="js-ai-gap-row">
            <span class="js-ai-gap-icon">!</span>
            <div class="js-ai-gap-body">
              <div class="js-ai-gap-issue">${_esc(gapPart)}</div>
              <div class="js-ai-gap-action"><span class="js-ai-gap-action-arrow">→</span> ${_esc(actionPart)}</div>
            </div>
          </div>`;
        } else {
          html += `<div class="js-ai-gap-row">
            <span class="js-ai-gap-icon">!</span>
            <div class="js-ai-gap-body"><div class="js-ai-gap-issue">${_esc(g)}</div></div>
          </div>`;
        }
      });
      html += `</div>`;
    }

    // Tips — numbered, editorial
    if (r.tips?.length) {
      html += `<div class="js-ai-section-block js-ai-block--tip ${s()}">
        <div class="js-ai-block-ttl">Your application game plan</div>`;
      r.tips.forEach((t, i) => {
        html += `<div class="js-ai-tip-row">
          <span class="js-ai-tip-num">${i + 1}</span>
          <span>${_esc(t)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // Insight — pull-quote with accent border
    if (r.insights) {
      html += `<div class="js-ai-insight ${s()}">
        <div class="js-ai-insight-hdr">
          <span class="js-ai-insight-icon">💡</span>
          <span class="js-ai-insight-lbl">Coach's take</span>
        </div>
        <div class="js-ai-insight-body">${_esc(r.insights)}</div>
      </div>`;
    }

    sec.innerHTML = html;

    // Update the panel header decision text now that we have the full picture.
    // The initial header was based on card data only (limited snippet).
    // The AI has read the complete job description — its verdict is authoritative.
    // We update the header quietly so the user sees one consistent message.
    _updateHeaderDecision(panel, r);
  }

  function _updateHeaderDecision(panel, r) {
    const lead = panel.querySelector('[data-js-decision-lead]');
    if (!lead) return;

    // Read the score directly from the verdict chip that was rendered at panel-open time.
    // This is the rule-based score — the only number we can trust as a hard gate.
    // The AI can refine the verdict WITHIN a score range but must NEVER promote
    // a poor match to a positive verdict, regardless of what it finds in gaps/strengths.
    const chipEl = panel.querySelector('.js-verdict-chip-num');
    const score  = chipEl ? parseInt(chipEl.textContent, 10) : null;

    // Hard gate: below 50 the rule-based verdict is already correct.
    // The AI body sections still show all gaps and strengths — users get the full picture.
    // We just don't let a "2 strengths, 1 gap" count override a 25/100 score.
    if (score !== null && score < 50) return;

    const gapCount      = r.gaps?.length      || 0;
    const strengthCount = r.strengths?.length  || 0;

    // Derive AI verdict capped by score range so the header never contradicts the number.
    let verdict;
    if (score >= 80) {
      // High score: let AI distinguish confident vs qualified apply
      if (gapCount === 0) verdict = 'Apply with confidence — strong match';
      else                verdict = 'Apply — review one gap below';
    } else if (score >= 70) {
      // Good score: positive but measured
      if (gapCount === 0 && strengthCount > 0) verdict = 'Strong match — worth applying';
      else                                     verdict = 'Worth applying — review gaps below';
    } else if (score >= 55) {
      // Moderate score: always qualified, not enthusiastic
      if (gapCount <= 1) verdict = 'Worth applying — one gap to address';
      else               verdict = 'Review carefully before applying';
    } else {
      // 50–54: stretch territory — don't upgrade, let the initial verdict stand
      return;
    }

    // Smooth swap — 250ms fade so it doesn't feel like a flash
    lead.style.transition = 'opacity 0.25s';
    lead.style.opacity    = '0';
    setTimeout(() => {
      lead.textContent  = verdict;
      lead.style.opacity = '1';
    }, 250);
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
      const criteria = panel.querySelector('.js-criteria');
      criteria ? panel.insertBefore(sec, criteria) : panel.appendChild(sec);
    }
    return sec;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.analyzeJobDeep = analyzeJobDeep;

}());