// Rolevance Panel v5.3
// v5.3: Unified verdict+score pill, SVG quick-fact icons, premium limit panel,
//       actions column (close top / save below), data-js-score for ai-analyzer.

(function () {
  'use strict';
  if (window._jsPanel) return;
  window._jsPanel = true;

  let _panel    = null;
  let _badge    = null;
  let _escKey   = null;
  let _checking = false;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function timeUntilReset(resetAt) {
    if (!resetAt) return 'midnight UTC';
    const diff = new Date(resetAt).getTime() - Date.now();
    if (diff <= 0) return 'shortly';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ── SVG icon strings for quick facts ──────────────────────────────────────
  // Small, clean, consistent across all OS. No emoji.
  const _svg = {
    remote:  `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M2 7.5L7 3l5 4.5" stroke="#059669" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 7v4.5h6V7" stroke="#059669" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    hybrid:  `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><rect x="2" y="3" width="10" height="9" rx="1.5" stroke="#059669" stroke-width="1.3"/><path d="M2 7h10M7 3v9" stroke="#059669" stroke-width="1" stroke-dasharray="2 1.5"/></svg>`,
    onsite:  `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><rect x="2" y="4" width="10" height="8" rx="1" stroke="#059669" stroke-width="1.3"/><path d="M5 12V9.5h4V12M5 6.5h1M8 6.5h1M5 8.5h1M8 8.5h1" stroke="#059669" stroke-width="1.1" stroke-linecap="round"/></svg>`,
    salary:  `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><circle cx="7" cy="7" r="5" stroke="#059669" stroke-width="1.3"/><path d="M7 4.5v5M5.5 5.5h2a1 1 0 010 2H6a1 1 0 000 2h2.5" stroke="#059669" stroke-width="1.1" stroke-linecap="round"/></svg>`,
    clock:   `<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><circle cx="7" cy="7" r="5" stroke="#059669" stroke-width="1.3"/><path d="M7 4.5v2.8l1.8 1.8" stroke="#059669" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    location:`<svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M7 2C5.3 2 4 3.3 4 5c0 2.7 3 7 3 7s3-4.3 3-7c0-1.7-1.3-3-3-3z" stroke="#059669" stroke-width="1.3"/><circle cx="7" cy="5" r="1" fill="#059669"/></svg>`,
  };

  // ── Save button ────────────────────────────────────────────────────────────
  function makeSaveBtn(jobData, result) {
    const btn = document.createElement('button');
    btn.className = 'js-save-btn';
    btn.setAttribute('aria-label', 'Save to tracker');
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="11" height="11">
      <path d="M12 2H4a1 1 0 00-1 1v11l5-2.5L13 14V3a1 1 0 00-1-1z"
            stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <span>Save</span>`;

    if (jobData.jobId && window.jsTracker) {
      window.jsTracker.isJobSaved(jobData.jobId).then(saved => {
        if (saved) _markSaveBtnSaved(btn);
      }).catch(() => {});
    }

    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.classList.contains('js-save-btn--saved')) return;
      btn.disabled = true;
      try {
        await window.jsTracker?.saveJob(jobData, result);
        _markSaveBtnSaved(btn);
      } catch (_) { btn.disabled = false; }
    });
    return btn;
  }

  function _markSaveBtnSaved(btn) {
    btn.classList.add('js-save-btn--saved');
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="11" height="11">
      <path d="M12 2H4a1 1 0 00-1 1v11l5-2.5L13 14V3a1 1 0 00-1-1z"
            fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </svg><span>Saved</span>`;
  }

  function makeCloseBtn() {
    const btn = document.createElement('button');
    btn.className = 'js-close-btn';
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', e => { e.stopPropagation(); hidePanel(); });
    return btn;
  }

  function fmtK(n) {
    if (!n && n !== 0) return '?';
    return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
  }

  // ── Quick-facts bar ────────────────────────────────────────────────────────
  // SVG icon + label + value tiles. No emoji — consistent across all platforms.
  function buildQuickFacts(jobData, result) {
    const facts = [];

    const wtLabels = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
    const wtSvgs   = { remote: _svg.remote, hybrid: _svg.hybrid, onsite: _svg.onsite };

    if (jobData.workType) {
      facts.push({
        svg:   wtSvgs[jobData.workType]   || _svg.location,
        label: 'Work type',
        val:   wtLabels[jobData.workType] || jobData.workType,
      });
    }

    if (jobData.salary?.low != null) {
      facts.push({
        svg:   _svg.salary,
        label: 'Salary',
        val:   `${fmtK(jobData.salary.low)}–${fmtK(jobData.salary.high)}`,
      });
    }

    const expCrit = result.criteria?.find(c => c.name === 'Experience fit');
    if (expCrit && expCrit.status !== 'unknown' && expCrit.note) {
      const match = expCrit.note.match(/\(([^)]+yrs?)\)/i)
                 || expCrit.note.match(/(\d+[–\-–]+\d+\s*yrs?)/i);
      if (match) {
        facts.push({ svg: _svg.clock, label: 'Experience', val: match[1] });
      }
    }

    if (!facts.length) return null;

    const bar = document.createElement('div');
    bar.className = 'js-quick-facts';
    facts.forEach(f => {
      const item = document.createElement('div');
      item.className = 'js-quick-fact';
      item.innerHTML = `
        <div class="js-qf-ico-wrap">${f.svg}</div>
        <div class="js-qf-body">
          <div class="js-qf-lbl">${f.label}</div>
          <div class="js-qf-val">${f.val}</div>
        </div>`;
      bar.appendChild(item);
    });
    return bar;
  }

  // ── Criterion row ──────────────────────────────────────────────────────────
  function buildRow(c) {
    const row  = document.createElement('div');
    row.className = `js-crit js-crit--${c.status}`;
    const icon = document.createElement('span');
    icon.className = 'js-crit-icon';
    icon.textContent = { pass: '✓', partial: '~', fail: '✗', unknown: '·' }[c.status] || '·';
    const body = document.createElement('div');
    body.className = 'js-crit-body';
    const name = document.createElement('div');
    name.className = 'js-crit-name';
    name.textContent = c.name;
    body.appendChild(name);
    if (c.note) {
      const note = document.createElement('div');
      note.className = 'js-crit-note';
      note.textContent = c.note;
      body.appendChild(note);
    }
    if (c.matched?.length || c.missing?.length) {
      const chips = document.createElement('div');
      chips.className = 'js-chips';
      (c.matched || []).forEach(m => {
        const chip = document.createElement('span');
        chip.className = `js-chip ${m.inTitle ? 'js-chip--title' : 'js-chip--match'}`;
        chip.textContent = m.kw || m;
        chips.appendChild(chip);
      });
      (c.missing || []).forEach(kw => {
        const chip = document.createElement('span');
        chip.className = 'js-chip js-chip--miss';
        chip.textContent = kw;
        chips.appendChild(chip);
      });
      body.appendChild(chips);
    }
    row.append(icon, body);
    return row;
  }

  // ── Footer text ────────────────────────────────────────────────────────────
  function _buildFooterHTML(pcr) {
    const brand = '<strong>Rolevance</strong>';
    if (!pcr || pcr.limit === null) return `${brand} · <span class="js-panel-footer-tier">Pro · unlimited</span>`;
    if (pcr.trial && pcr.trialDaysLeft != null) {
      return `${brand} · <span class="js-panel-footer-tier">Trial · ${pcr.trialDaysLeft}d left</span>`;
    }
    if (pcr.trial) return `${brand} · <span class="js-panel-footer-tier">Trial</span>`;
    if (typeof pcr.limit === 'number') {
      const remaining = Math.max(0, pcr.limit - (pcr.usedToday || 0));
      return `${brand} · <span class="js-panel-footer-tier">${remaining} panel${remaining !== 1 ? 's' : ''} left today</span>`;
    }
    return `${brand} · <span class="js-panel-footer-tier">Pro</span>`;
  }

  // ── Limit panel ────────────────────────────────────────────────────────────
  // Amber light header — consistent with the panel's visual language.
  // Green upgrade button — on-brand.
  function createLimitPanel(result) {
    const resets  = timeUntilReset(result.resetAt);
    const limit   = result.limit || (result.trial ? 10 : 3);
    const isTrial = !!result.trial;

    const panel = document.createElement('div');
    panel.className = 'js-panel js-limit-panel';

    // Amber header (not dark navy)
    const hdr = document.createElement('div');
    hdr.className = 'js-lp-hdr';
    hdr.innerHTML = `
      <div class="js-lp-icon">
        <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
          <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
        </svg>
      </div>
      <div class="js-lp-hdr-text">
        <div class="js-lp-title">Daily limit reached</div>
        <div class="js-lp-sub">${
          isTrial
            ? `You've reached today's trial panel limit (${limit}/day)`
            : `You've used all ${limit} of your free panels today`
        }</div>
      </div>`;
    hdr.appendChild(makeCloseBtn());
    panel.appendChild(hdr);

    const timer = document.createElement('div');
    timer.className = 'js-lp-timer';
    timer.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
        <polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Resets in <strong>${resets}</strong> at midnight UTC</span>`;
    panel.appendChild(timer);

    const planDiv = document.createElement('div');
    planDiv.className = 'js-lp-plan';
    if (isTrial) {
      // Fix: 10 analyses (not 5)
      planDiv.innerHTML = `
        <div class="js-lp-plan-label">Your trial includes</div>
        <div class="js-lp-plan-limits">
          <div class="js-lp-limit-item js-lp-limit--used">
            <span class="js-lp-limit-num">${limit}</span>
            <span class="js-lp-limit-name">panels / day</span>
          </div>
          <div class="js-lp-limit-item">
            <span class="js-lp-limit-num">10</span>
            <span class="js-lp-limit-name">AI analyses / day</span>
          </div>
          <div class="js-lp-limit-item">
            <span class="js-lp-limit-num">${result.trialDaysLeft ?? '—'}</span>
            <span class="js-lp-limit-name">days remaining</span>
          </div>
        </div>`;
    } else {
      planDiv.innerHTML = `
        <div class="js-lp-plan-label">Your free plan includes</div>
        <div class="js-lp-plan-limits">
          <div class="js-lp-limit-item js-lp-limit--used">
            <span class="js-lp-limit-num">${limit}</span>
            <span class="js-lp-limit-name">panels / day</span>
          </div>
          <div class="js-lp-limit-item">
            <span class="js-lp-limit-num">3</span>
            <span class="js-lp-limit-name">AI analyses / day</span>
          </div>
          <div class="js-lp-limit-item">
            <span class="js-lp-limit-num">7</span>
            <span class="js-lp-limit-name">day free trial</span>
          </div>
        </div>`;
    }
    panel.appendChild(planDiv);

    const divider = document.createElement('div');
    divider.className = 'js-lp-divider';
    panel.appendChild(divider);

    const upgrade = document.createElement('div');
    upgrade.className = 'js-lp-upgrade';
    upgrade.innerHTML = `
      <div class="js-lp-upgrade-hdr">
        <div class="js-lp-upgrade-title">Rolevance Pro</div>
        <div class="js-lp-upgrade-price">$7<span>/month</span></div>
      </div>
      <div class="js-lp-features">
        <div class="js-lp-feature">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span><strong>Unlimited</strong> job panels per day</span>
        </div>
        <div class="js-lp-feature">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span><strong>Unlimited</strong> AI coaching per panel</span>
        </div>
        <div class="js-lp-feature">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Cancel anytime · no commitment</span>
        </div>
      </div>`;

    // Green upgrade button — fixes the blue gradient that was wrong
    const upgradeBtn = document.createElement('button');
    upgradeBtn.className = 'js-lp-upgrade-btn';
    upgradeBtn.textContent = isTrial
      ? 'Upgrade to Pro — keep unlimited access'
      : 'Upgrade to Pro — $7/month';
    upgradeBtn.addEventListener('click', e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' });
    });
    upgrade.appendChild(upgradeBtn);
    panel.appendChild(upgrade);

    const footer = document.createElement('div');
    footer.className = 'js-panel-footer js-lp-footer';
    footer.innerHTML = `<strong>Rolevance</strong> <span class="js-panel-footer-tier">· ${isTrial ? 'Trial' : 'Free plan'}</span>`;
    panel.appendChild(footer);

    return panel;
  }

  // ── Normal scoring panel ───────────────────────────────────────────────────
  function createPanel(result, jobData, panelCheckResult) {
    const label    = result.label || 'gray';
    const score    = result.score;
    const hasScore = score !== null && score !== undefined;

    const panel = document.createElement('div');
    panel.className = `js-panel js-panel--${label}`;

    // Store score as data attribute for ai-analyzer.js to read
    // (replaces the .js-verdict-chip-num that was in the old chip)
    if (hasScore) panel.dataset.jsScore = String(score);

    // ── Verdict card ────────────────────────────────────────────────────────
    const verdictCard = document.createElement('div');
    verdictCard.className = `js-verdict-card js-verdict-card--${label}`;

    // Verdict text — brief, direct
    let decisionText;
    if (!hasScore)        decisionText = 'Complete your profile to score';
    else if (score >= 80) decisionText = 'Apply with confidence';
    else if (score >= 70) decisionText = 'Strong match — worth applying';
    else if (score >= 55) decisionText = 'Worth applying';
    else if (score >= 40) decisionText = 'Stretch role — if compelling';
    else                  decisionText = 'Likely not a match';

    // Match label text from scorer
    const mTxt = result.text || '';

    // Left: verdict text + score pill stacked
    const vcDecision = document.createElement('div');
    vcDecision.className = 'js-verdict-decision';

    const vcText = document.createElement('div');
    vcText.className = `js-verdict-text js-verdict-text--${label}`;
    vcText.dataset.jsDecisionLead = '1';
    vcText.textContent = decisionText;

    // Score pill — "Exceptional match · 87/100"
    if (hasScore || mTxt) {
      const vcPill = document.createElement('div');
      vcPill.className = `js-verdict-pill js-verdict-pill--${label}`;
      const dot = document.createElement('span');
      dot.className = 'js-verdict-pill-dot';
      vcPill.appendChild(dot);
      const pillText = [mTxt, hasScore ? `${score}/100` : ''].filter(Boolean).join(' · ');
      vcPill.appendChild(document.createTextNode(pillText));
      vcDecision.append(vcText, vcPill);
    } else {
      vcDecision.appendChild(vcText);
    }

    // Right: close button on top, save button below
    const vcActions = document.createElement('div');
    vcActions.className = 'js-verdict-actions';
    vcActions.append(makeCloseBtn(), makeSaveBtn(jobData, result));

    // Main row
    const vcMain = document.createElement('div');
    vcMain.className = 'js-verdict-main';
    vcMain.append(vcDecision, vcActions);
    verdictCard.appendChild(vcMain);

    // Meta row: company · title · location
    const vcMeta = document.createElement('div');
    vcMeta.className = 'js-verdict-meta';
    const metaParts = [jobData.company, jobData.title, jobData.location].filter(Boolean);
    vcMeta.innerHTML = metaParts.map(p => `<span>${p}</span>`).join('<span class="js-verdict-sep">·</span>');
    verdictCard.appendChild(vcMeta);

    panel.appendChild(verdictCard);

    // ── Quick-facts bar ──────────────────────────────────────────────────────
    const qf = buildQuickFacts(jobData, result);
    if (qf) panel.appendChild(qf);

    // ── AI section placeholder ───────────────────────────────────────────────
    // Shows shimmer immediately. ai-analyzer.js replaces this with real content.
    const aiSection = document.createElement('div');
    aiSection.className = 'js-ai-section';
    aiSection.innerHTML = `
      <div class="js-ai-hdr">
        <span class="js-ai-badge">AI coaching</span>
        <span class="js-ai-model">Loading analysis…</span>
      </div>
      <div class="js-shimmer">
        <div class="js-shimmer-ln js-shimmer-ln--lg"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
        <div class="js-shimmer-ln js-shimmer-ln--xs" style="margin-top:4px"></div>
        <div class="js-shimmer-ln js-shimmer-ln--sm"></div>
        <div class="js-shimmer-ln js-shimmer-ln--md"></div>
      </div>`;
    panel.appendChild(aiSection);

    // ── Criteria breakdown — collapsible ─────────────────────────────────────
    if (result.criteria?.length) {
      const weighted = result.criteria.filter(c => c.weight > 0);
      const metCount = weighted.filter(c => c.status === 'pass').length;
      const total    = weighted.length;

      const section = document.createElement('div');
      section.className = 'js-criteria';

      const toggle = document.createElement('button');
      toggle.className = 'js-criteria-toggle';
      toggle.type = 'button';
      toggle.innerHTML =
        `<span class="js-criteria-toggle-lbl">Score breakdown</span>` +
        `<span class="js-criteria-meta">${metCount} of ${total} criteria met</span>` +
        `<svg class="js-criteria-chevron" viewBox="0 0 16 16" fill="none" width="12" height="12">` +
          `<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
        `</svg>`;

      const body = document.createElement('div');
      body.className = 'js-criteria-body';

      toggle.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = toggle.classList.contains('js-criteria-toggle--open');
        toggle.classList.toggle('js-criteria-toggle--open', !isOpen);
        body.style.display = isOpen ? 'none' : 'block';
      });

      weighted.forEach(c => body.appendChild(buildRow(c)));
      section.append(toggle, body);
      panel.appendChild(section);
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'js-panel-footer';
    footer.innerHTML = _buildFooterHTML(panelCheckResult);
    panel.appendChild(footer);

    return panel;
  }

  // ── Show / hide ────────────────────────────────────────────────────────────
  function showPanel(anchor, result, jobData, panelCheckResult) {
    hidePanel();
    const panel = result.limitReached
      ? createLimitPanel(result)
      : createPanel(result, jobData, panelCheckResult);
    anchor.appendChild(panel);
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('js-panel--visible')));
    _panel  = panel;
    _escKey = e => { if (e.key === 'Escape') hidePanel(); };
    document.addEventListener('keydown', _escKey);
  }

  function hidePanel() {
    if (_escKey) { document.removeEventListener('keydown', _escKey); _escKey = null; }
    if (!_panel) return;
    _panel.classList.remove('js-panel--visible');
    const p = _panel;
    setTimeout(() => { if (p.parentNode) p.remove(); }, 280);
    _panel = null;
    if (_badge) { _badge.classList.remove('js-badge--active'); _badge = null; }
  }

  // ── Toggle — check-first flow ──────────────────────────────────────────────
  async function togglePanel(badge, anchor, result, jobData) {
    if (_panel && _badge === badge) { hidePanel(); return; }
    if (_checking) return;
    _checking = true;

    if (_badge) _badge.classList.remove('js-badge--active');

    const scoreEl       = badge.querySelector?.('.js-badge-score') ?? null;
    const originalScore = scoreEl ? scoreEl.textContent : null;
    if (scoreEl) scoreEl.textContent = '…';

    let panelCheckResult = { allowed: true };
    try {
      panelCheckResult = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'JS_PANEL_OPEN', jobId: jobData.jobId || '' },
          response => resolve(
            response && typeof response.allowed === 'boolean'
              ? response
              : { allowed: true }
          )
        );
      });
    } catch (_) {
      panelCheckResult = { allowed: true };
    } finally {
      if (scoreEl && originalScore !== null) scoreEl.textContent = originalScore;
      _checking = false;
    }

    _badge = badge;
    badge.classList.add('js-badge--active');

    if (!panelCheckResult.allowed) {
      showPanel(anchor, {
        ...result,
        limitReached:  true,
        resetAt:       panelCheckResult.resetAt       || null,
        usedToday:     panelCheckResult.usedToday      || 0,
        limit:         panelCheckResult.limit          || 3,
        trial:         panelCheckResult.trial          || false,
        trialDaysLeft: panelCheckResult.trialDaysLeft  || null,
      }, jobData, panelCheckResult);
      return;
    }

    showPanel(anchor, result, jobData, panelCheckResult);

    if (_panel && typeof window._rolevanceOnPanelOpen === 'function') {
      window._rolevanceOnPanelOpen(jobData, _panel, anchor, panelCheckResult, result);
    }
  }

  function getOpenPanel() { return _panel; }

  window.hidePanel    = hidePanel;
  window.togglePanel  = togglePanel;
  window.getOpenPanel = getOpenPanel;

}());