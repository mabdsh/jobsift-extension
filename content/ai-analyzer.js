// Rolevance AI Analyzer v5.3
// v5.3: Fixed prices ($7), fixed trial analysis count (10), updated AI header labels,
//       circular lock icons replace emoji, data-js-score attribute for score reading,
//       "AI coaching" badge throughout, coaching insight shows without header chrome.

(function () {
  'use strict';
  if (window._jsAI) return;
  window._jsAI = true;

  const _deepCache = new Map();

  // ── Job description selectors ──────────────────────────────────────────────
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

  async function analyzeJobDeep(jobData, panelEl, li, prefs, panelCheckResult, result) {
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
      <div class="js-ai-hdr js-ai-stagger js-ai-stagger-1">
        <span class="js-ai-badge">AI coaching</span>
        <span class="js-ai-model">Analysing full job description…</span>
      </div>
      <div class="js-shimmer">
        <div class="js-shimmer-ln js-shimmer-ln--lg"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
        <div class="js-shimmer-ln js-shimmer-ln--xs" style="margin-top:4px"></div>
        <div class="js-shimmer-ln js-shimmer-ln--sm"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
      </div>`;
  }

  // Upgrade teaser — shown to free users. Lock icon uses CSS class, not emoji.
  function renderUpgradeTeaser(panel, result) {
    const sec   = getOrCreate(panel);
    const score = result?.score;

    let msg;
    if (score >= 70) {
      msg = "You're a strong candidate for this role. Unlock your coaching to see exactly why — and how to make your application stand out from other strong applicants.";
    } else if (score >= 50) {
      msg = "This role has real potential for you. Unlock your coaching to see the specific gaps and exactly how to address them before you apply.";
    } else {
      msg = "Unlock your coaching analysis to see the full picture — what this role actually needs, where you stand, and whether it's worth your time.";
    }

    // Lock icon: CSS circle, not emoji (consistent rendering)
    const lockIcon = `<span class="js-ai-upgrade-lock">
      <svg viewBox="0 0 10 10" fill="none" width="9" height="9">
        <rect x="2" y="4.5" width="6" height="5" rx="1" stroke="currentColor" stroke-width="1.1"/>
        <path d="M3.5 4.5V3a1.5 1.5 0 013 0v1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      </svg>
    </span>`;

    sec.innerHTML = `
      <div class="js-ai-hdr js-ai-stagger js-ai-stagger-1">
        <span class="js-ai-badge">AI coaching</span>
      </div>
      <div class="js-ai-upgrade">
        <p class="js-ai-upgrade-msg">${_esc(msg)}</p>
        <div class="js-ai-upgrade-features">
          <div class="js-ai-upgrade-feat">
            ${lockIcon}
            <div>
              <span class="js-ai-upgrade-feat-name">Why you're a strong candidate</span>
              <span class="js-ai-upgrade-feat-hint"> — 2–3 specific reasons for this role</span>
            </div>
          </div>
          <div class="js-ai-upgrade-feat">
            ${lockIcon}
            <div>
              <span class="js-ai-upgrade-feat-name">Close the gap</span>
              <span class="js-ai-upgrade-feat-hint"> — actionable steps for each gap</span>
            </div>
          </div>
          <div class="js-ai-upgrade-feat">
            ${lockIcon}
            <div>
              <span class="js-ai-upgrade-feat-name">Your application game plan</span>
              <span class="js-ai-upgrade-feat-hint"> — cover letter angle, CV tip, interview prep</span>
            </div>
          </div>
          <div class="js-ai-upgrade-feat">
            ${lockIcon}
            <div>
              <span class="js-ai-upgrade-feat-name">Coach's take</span>
              <span class="js-ai-upgrade-feat-hint"> — the non-obvious observation about this role</span>
            </div>
          </div>
        </div>
        <button class="js-ai-upgrade-btn">
          Unlock full coaching — $7/month
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="js-ai-upgrade-sub">Start 7-day free trial · Cancel anytime</div>
      </div>`;

    sec.querySelector('.js-ai-upgrade-btn')
      ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' }));
  }

  function renderDeepResult(panel, r) {
    const sec = getOrCreate(panel);
    let si = 0;
    const s = () => `js-ai-stagger js-ai-stagger-${++si}`;

    let html = `<div class="js-ai-hdr ${s()}">
      <span class="js-ai-badge">AI coaching</span>
      <span class="js-ai-model">Full description analysed</span>
    </div>`;

    if (r.decision) {
      html += `<div class="js-ai-decision ${s()}">${_esc(r.decision)}</div>`;
    }

    if (r.summary) {
      html += `<div class="js-ai-summary ${s()}">${_esc(r.summary)}</div>`;
    }

    if (r.keyRequirements?.length) {
      html += `<div class="js-ai-section-block js-ai-block--req ${s()}">
        <div class="js-ai-block-ttl">What this role needs</div>
        <div class="js-ai-chips">`;
      r.keyRequirements.forEach(req => {
        html += `<span class="js-ai-chip js-ai-chip--req">${_esc(req)}</span>`;
      });
      html += `</div></div>`;
    }

    if (r.strengths?.length) {
      html += `<div class="js-ai-section-block js-ai-block--strength ${s()}">
        <div class="js-ai-block-ttl">Strengths</div>`;
      r.strengths.forEach(str => {
        html += `<div class="js-ai-match-row">
          <span class="js-ai-match-icon">&#10003;</span>
          <span>${_esc(str)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (r.gaps?.length) {
      html += `<div class="js-ai-section-block js-ai-block--gap ${s()}">
        <div class="js-ai-block-ttl">Gaps</div>`;
      r.gaps.forEach(g => {
        const sepIdx = g.indexOf(' — ');
        if (sepIdx !== -1) {
          const gapPart    = g.slice(0, sepIdx);
          const actionPart = g.slice(sepIdx + 3);
          html += `<div class="js-ai-gap-row">
            <span class="js-ai-gap-icon">!</span>
            <div class="js-ai-gap-body">
              <div class="js-ai-gap-issue">${_esc(gapPart)}</div>
              <div class="js-ai-gap-action"><span class="js-ai-gap-action-arrow">&#8594;</span> ${_esc(actionPart)}</div>
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

    // Insight — simplified in CSS (left border + plain text, no gradient or icon chrome)
    if (r.insights) {
      html += `<div class="js-ai-insight ${s()}">
        <div class="js-ai-insight-lbl">Coach's take</div>
        <div class="js-ai-insight-body">${_esc(r.insights)}</div>
      </div>`;
    }

    sec.innerHTML = html;
    _updateHeaderDecision(panel, r);
  }

  // Reads score from panel's data attribute (set by panel.js createPanel).
  // Replaces the old .js-verdict-chip-num querySelector approach.
  function _updateHeaderDecision(panel, r) {
    const lead = panel.querySelector('[data-js-decision-lead]');
    if (!lead) return;

    const scoreStr = panel.dataset.jsScore;
    const score    = scoreStr ? parseInt(scoreStr, 10) : null;

    // Hard gate: rule-based verdict is correct below 50
    if (score !== null && score < 50) return;

    const gapCount      = r.gaps?.length      || 0;
    const strengthCount = r.strengths?.length  || 0;

    let verdict;
    if (score >= 80) {
      verdict = gapCount === 0 ? 'Apply with confidence — strong match' : 'Apply — review one gap below';
    } else if (score >= 70) {
      verdict = (gapCount === 0 && strengthCount > 0) ? 'Strong match — worth applying' : 'Worth applying — review gaps below';
    } else if (score >= 55) {
      verdict = gapCount <= 1 ? 'Worth applying — one gap to address' : 'Review carefully before applying';
    } else {
      return;
    }

    lead.style.transition = 'opacity 0.25s';
    lead.style.opacity    = '0';
    setTimeout(() => { lead.textContent = verdict; lead.style.opacity = '1'; }, 250);
  }

  function renderError(panel, msg) {
    const sec = getOrCreate(panel);

    if (msg?.includes('trial_daily_limit')) {
      // Fix: 10 analyses (not 5), $7 (not $9)
      sec.innerHTML = `
        <div class="js-ai-hdr">
          <span class="js-ai-badge">AI coaching</span>
        </div>
        <div class="js-ai-limit">
          <div class="js-ai-limit-icon">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
            </svg>
          </div>
          <div class="js-ai-limit-title">Daily trial limit reached</div>
          <div class="js-ai-limit-sub">
            You've used today's 10 trial analyses. Resets at midnight UTC — or upgrade for unlimited.
          </div>
          <button class="js-ai-upgrade-btn js-ai-trial-up-btn" type="button" style="margin-top:10px">
            Upgrade for unlimited — $7/month
          </button>
        </div>`;
      sec.querySelector('.js-ai-trial-up-btn')
        ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' }));
      return;
    }

    const rate = msg?.toLowerCase().includes('rate_limit') || msg?.includes('RATE_LIMIT')
              || msg?.toLowerCase().includes('groq_parse');

    if (rate) {
      sec.innerHTML = `
        <div class="js-ai-hdr">
          <span class="js-ai-badge">AI coaching</span>
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
          <span class="js-ai-badge">AI coaching</span>
        </div>
        <div class="js-ai-prompt js-ai-prompt--muted">Analysis temporarily unavailable — badge scores are unaffected.</div>`;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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