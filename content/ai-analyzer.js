// Rolevance AI Analyzer v5.4
// v5.4: Pricing strings now read from panel-check response (pcr.pricing) — single
//       source of truth lives in backend config/limits.ts. Trial analyze limit
//       count derives from pcr.trial_limits.analyze rather than being hardcoded.
// v5.3: Trial analysis count, AI header labels, circular lock icons replace emoji,
//       data-js-score attribute for score reading, "AI coaching" badge throughout,
//       coaching insight shows without header chrome.

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
    const pcr = panelCheckResult || {};
    // NOTE: We deliberately do NOT short-circuit free users to the upgrade
    // teaser here. Free tier gets 3 AI analyses/day per the limits config;
    // the backend's rate-limit middleware enforces this and returns a 429
    // with error:'rate_limit_exceeded' once the cap is hit. renderError
    // catches that and shows the upgrade teaser. Single source of truth.

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
      renderError(panelEl, err.message, pcr, result);
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
  // Pricing strings come from the panel-check response (pcr.pricing) — every
  // open of this teaser reflects the latest config/limits.ts values from the
  // backend. PR1: pricing consolidation. PR2 will rewrite this teaser to be
  // trial-first when pcr.trial_available is true.
  function renderUpgradeTeaser(panel, result, pcr) {
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

    // Pricing — backend-driven via panel-check response.
    // Falls back to the canonical config/limits.ts values to stay correct
    // even if the backend serves a stale/older shape.
    const pr = pcr?.pricing || {
      monthly_usd: 9, yearly_usd: 84,
      yearly_savings_label: '2+ months free',
    };
    const yearlyPrice     = `$${pr.yearly_usd}`;
    const monthlyPrice    = `$${pr.monthly_usd}`;
    const yearlyMonthlyEq = `$${Math.round(pr.yearly_usd / 12)}`;
    const savingsLabel    = pr.yearly_savings_label || '2+ months free';

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
          Unlock full coaching — ${yearlyPrice}/year
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="js-ai-upgrade-sub">${yearlyMonthlyEq}/mo · ${savingsLabel} · Cancel anytime</div>
      </div>`;

    sec.querySelector('.js-ai-upgrade-btn')
      ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE', plan: 'annual' }));
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
      // SVG checkmark — replaces &#10003; for cross-platform consistency.
      const checkSvg = `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true"><path d="M2.5 6.5l2.5 2.5L9.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      html += `<div class="js-ai-section-block js-ai-block--strength ${s()}">
        <div class="js-ai-block-ttl">Strengths</div>`;
      r.strengths.forEach(str => {
        html += `<div class="js-ai-match-row">
          <span class="js-ai-match-icon">${checkSvg}</span>
          <span>${_esc(str)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (r.gaps?.length) {
      // SVG icons — replace plain "!" and &#8594; arrow with consistent visuals.
      const gapSvg = `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.5v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="9" r=".7" fill="currentColor"/></svg>`;
      const arrowSvg = `<svg viewBox="0 0 12 12" fill="none" width="9" height="9" aria-hidden="true"><path d="M2.5 6h7M7 3.5L9.5 6 7 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      html += `<div class="js-ai-section-block js-ai-block--gap ${s()}">
        <div class="js-ai-block-ttl">Gaps</div>`;
      r.gaps.forEach(g => {
        const sepIdx = g.indexOf(' — ');
        if (sepIdx !== -1) {
          const gapPart    = g.slice(0, sepIdx);
          const actionPart = g.slice(sepIdx + 3);
          html += `<div class="js-ai-gap-row">
            <span class="js-ai-gap-icon">${gapSvg}</span>
            <div class="js-ai-gap-body">
              <div class="js-ai-gap-issue">${_esc(gapPart)}</div>
              <div class="js-ai-gap-action"><span class="js-ai-gap-action-arrow">${arrowSvg}</span> ${_esc(actionPart)}</div>
            </div>
          </div>`;
        } else {
          html += `<div class="js-ai-gap-row">
            <span class="js-ai-gap-icon">${gapSvg}</span>
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

    // Insight — elevated treatment in CSS (PR3 polish): tinted bg + accent
    // border + small lightbulb icon. The non-obvious observation is the
    // killer feature of paid coaching; this should feel like a discovery.
    if (r.insights) {
      const bulbSvg = `<svg class="js-ai-insight-bulb" viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
        <path d="M4 7.5C3 6.5 3 5 4 4s3-1 4 0 1 2.5 0 3.5l-.5.5h-3l-.5-.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M5 9h2M5.2 10.5h1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>`;
      html += `<div class="js-ai-insight ${s()}">
        <div class="js-ai-insight-lbl">${bulbSvg}<span>Coach's take</span></div>
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

  // Errors flowing into here:
  //   'trial_daily_limit'   — trial user hit 10/day cap. Pitch paid Pro.
  //   'rate_limit_exceeded' — free user hit 3/day cap. THIS is the upgrade
  //                           moment — show the same teaser a fresh free
  //                           panel would have shown, with the same
  //                           personalized "you're a strong candidate" copy.
  //   anything else         — Groq overload, parse errors, transient network.
  //                           Don't conflate with user-facing limit messaging.
  function renderError(panel, msg, pcr, result) {
    const sec = getOrCreate(panel);

    // Pricing — backend-driven. Fallbacks match config/limits.ts canonical values
    // so the surface stays correct if the backend serves a stale/older shape.
    const pr = pcr?.pricing || {
      monthly_usd: 9, yearly_usd: 84,
      yearly_savings_label: '2+ months free',
    };
    const yearlyPrice  = `$${pr.yearly_usd}`;
    const monthlyPrice = `$${pr.monthly_usd}`;
    const savingsLabel = pr.yearly_savings_label || '2+ months free';
    const trialAnalyzeLimit = pcr?.trial_limits?.analyze ?? 10;

    // Free user hit daily cap → render the upgrade teaser.
    // String-match on the exact error code from rateLimit.ts. Don't use a
    // looser includes('rate_limit') here — that would also match Groq's
    // RATE_LIMIT (different condition entirely, see below).
    if (msg === 'rate_limit_exceeded') {
      renderUpgradeTeaser(panel, result, pcr);
      return;
    }

    if (msg?.includes('trial_daily_limit')) {
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
            You've used today's ${trialAnalyzeLimit} trial analyses. Resets at midnight UTC — or upgrade for unlimited.
          </div>
          <button class="js-ai-upgrade-btn js-ai-trial-up-btn" type="button" style="margin-top:10px">
            Get Pro — ${yearlyPrice}/year (${savingsLabel})
          </button>
          <div class="js-ai-upgrade-sub" style="margin-top:5px">Or ${monthlyPrice}/month · Cancel anytime</div>
        </div>`;
      sec.querySelector('.js-ai-trial-up-btn')
        ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE', plan: 'annual' }));
      return;
    }

    // Groq overload / transient backend issues — distinct from user limits.
    // These shouldn't be conflated: telling a free user "service busy" when
    // they actually hit their cap is misleading.
    const transient = msg?.includes('GROQ_RATE_LIMIT')
                   || msg?.includes('GROQ_PARSE_ERROR')
                   || msg?.includes('SERVER_ERROR')
                   || msg?.toLowerCase().includes('groq_');

    if (transient) {
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