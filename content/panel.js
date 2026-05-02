// Rolevance Panel v5.2
// v5.2: Full panel redesign — decision leads header, simplified criteria,
//       collapsible breakdown, visual AI section differentiation, pull-quote insight
// v3.2.0: anchor parameter replaces li — panel now works on any container element,
//         enabling detail page support where the anchor is a dedicated panel-root div.
// Layout: SVG arc ring → verdict → decision block → quick-facts →
//         AI analysis → criteria breakdown → tips → footer

(function () {
  'use strict';
  if (window._jsPanel) return;
  window._jsPanel = true;

  let _panel    = null;
  let _badge    = null;
  let _escKey   = null;
  let _checking = false;

  // CIRC removed — circular ring replaced by buildScoreTile()

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

  // ── Save-to-tracker button ─────────────────────────────────────────────────
  // Created once per panel open. Async-checks if the job is already saved and
  // updates the button state. Sits in the panel header next to the close button.
  function makeSaveBtn(jobData, result) {
    const btn = document.createElement('button');
    btn.className = 'js-save-btn';
    btn.setAttribute('aria-label', 'Save to tracker');
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
        <path d="M12 2H4a1 1 0 00-1 1v11l5-2.5L13 14V3a1 1 0 00-1-1z"
              stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
      <span>Save</span>`;

    // Async check — update to "Saved" state if job already in tracker
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
      } catch (_) {
        btn.disabled = false;
      }
    });

    return btn;
  }

  function _markSaveBtnSaved(btn) {
    btn.classList.add('js-save-btn--saved');
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
        <path d="M12 2H4a1 1 0 00-1 1v11l5-2.5L13 14V3a1 1 0 00-1-1z"
              fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
      <span>Saved</span>`;
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

  // ── SVG arc ring ───────────────────────────────────────────────────────────
  // Score tile — 48×48 rounded square, consistent with tracker card design system.
  // Replaces the circular ring which was visually inconsistent and too small
  // to carry meaning at 52px once demoted from hero to supporting role.
  function buildScoreTile(label, score) {
    const hasScore = score !== null && score !== undefined;
    const tile = document.createElement('div');
    tile.className = `js-score-tile js-score-tile--${label}`;
    tile.innerHTML =
      `<span class="js-score-tile-num">${hasScore ? score : '—'}</span>` +
      `<span class="js-score-tile-sub">${hasScore ? '/100' : ''}</span>`;
    return tile;
  }

  // ── Decision block ─────────────────────────────────────────────────────────
  function buildDecision(result) {
    const score    = result.score;
    const hasScore = score !== null && score !== undefined;
    const label    = result.label || 'gray';
    const missing  = result.missingCritical || [];

    let icon, text, sub = null;

    if (!hasScore) {
      icon = 'ℹ';
      text = 'Complete your profile to get a match decision';
    } else if (missing.length) {
      icon = '⚡';
      text = `Missing critical: ${missing.slice(0, 3).join(', ')}`;
      sub  = 'These must-have skills were not found in this listing';
    } else if (score >= 80) {
      icon = '✓';
      text = 'Apply with confidence — strong overall match';
    } else if (score >= 65) {
      icon = '→';
      text = 'Worth applying — review any gaps in the AI analysis below';
    } else if (score >= 45) {
      icon = '⚠';
      text = 'Stretch application — significant gaps present';
      sub  = 'Apply only if the role is particularly compelling';
    } else {
      icon = '✗';
      text = 'Skip — poor match with your current profile';
      sub  = 'Better-matched roles are available in your feed';
    }

    const block = document.createElement('div');
    block.className = `js-decision js-decision--${label}`;
    block.innerHTML = `
      <span class="js-decision-icon">${icon}</span>
      <div class="js-decision-body">
        <div class="js-decision-text">${text}</div>
        ${sub ? `<div class="js-decision-sub">${sub}</div>` : ''}
      </div>`;
    return block;
  }

  // ── Quick-facts bar ────────────────────────────────────────────────────────
  function buildQuickFacts(jobData, result) {
    const facts = [];

    const wtIcons  = { remote: '🏠', hybrid: '🔄', onsite: '🏢' };
    const wtLabels = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
    if (jobData.workType) {
      facts.push({
        icon:  wtIcons[jobData.workType]  || '📍',
        label: 'Work type',
        val:   wtLabels[jobData.workType] || jobData.workType,
      });
    }

    if (jobData.salary?.low != null) {
      facts.push({
        icon:  '💰',
        label: 'Salary',
        val:   `${fmtK(jobData.salary.low)}–${fmtK(jobData.salary.high)}`,
      });
    }

    const expCrit = result.criteria?.find(c => c.name === 'Experience fit');
    if (expCrit && expCrit.status !== 'unknown' && expCrit.note) {
      const match = expCrit.note.match(/\(([^)]+yrs?)\)/i)
                 || expCrit.note.match(/(\d+[–\-–]+\d+\s*yrs?)/i);
      if (match) {
        facts.push({ icon: '📅', label: 'Experience', val: match[1] });
      }
    }

    if (!facts.length) return null;

    const bar = document.createElement('div');
    bar.className = 'js-quick-facts';

    facts.forEach(f => {
      const item = document.createElement('div');
      item.className = 'js-quick-fact';
      item.innerHTML =
        `<span class="js-qf-icon">${f.icon}</span>` +
        `<span class="js-qf-val">${f.val}</span>`;
      bar.appendChild(item);
    });

    return bar;
  }

  // ── Criterion row ──────────────────────────────────────────────────────────
  function buildRow(c) {
    // Simplified: background conveys status, no redundant bar or verdict pill
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
    if (!pcr || !pcr.trial && pcr.limit === null) {
      return '<strong>Rolevance</strong> · Pro';
    }
    if (pcr.trial && pcr.trialDaysLeft !== null) {
      return `<strong>Rolevance</strong> · Trial · ${pcr.trialDaysLeft}d remaining`;
    }
    if (pcr.limit !== null) {
      const remaining = Math.max(0, pcr.limit - (pcr.usedToday || 0));
      return `<strong>Rolevance</strong> · ${remaining} panel${remaining !== 1 ? 's' : ''} left today`;
    }
    return '<strong>Rolevance</strong> · Pro';
  }

  // ── Limit panel ────────────────────────────────────────────────────────────
  function createLimitPanel(result) {
    const resets = timeUntilReset(result.resetAt);
    const limit  = result.limit || 5;

    const panel = document.createElement('div');
    panel.className = 'js-panel js-limit-panel';

    const hdr = document.createElement('div');
    hdr.className = 'js-lp-hdr';
    hdr.innerHTML = `
      <div class="js-lp-icon">
        <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
          <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
        </svg>
      </div>
      <div class="js-lp-hdr-text">
        <div class="js-lp-title">Daily limit reached</div>
        <div class="js-lp-sub">You've used both of your free panels today</div>
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

    const plan = document.createElement('div');
    plan.className = 'js-lp-plan';
    plan.innerHTML = `
      <div class="js-lp-plan-label">Your free plan includes</div>
      <div class="js-lp-plan-limits">
        <div class="js-lp-limit-item js-lp-limit--used">
          <span class="js-lp-limit-num">${limit}</span>
          <span class="js-lp-limit-name">job panels / day</span>
        </div>
        <div class="js-lp-limit-item">
          <span class="js-lp-limit-num">3</span>
          <span class="js-lp-limit-name">profile parses / day</span>
        </div>
        <div class="js-lp-limit-item">
          <span class="js-lp-limit-num">5</span>
          <span class="js-lp-limit-name">day free trial included</span>
        </div>
      </div>`;
    panel.appendChild(plan);

    const div = document.createElement('div');
    div.className = 'js-lp-divider';
    panel.appendChild(div);

    const upgrade = document.createElement('div');
    upgrade.className = 'js-lp-upgrade';
    upgrade.innerHTML = `
      <div class="js-lp-upgrade-hdr">
        <div class="js-lp-upgrade-title">Rolevance Pro</div>
        <div class="js-lp-upgrade-price">$9<span>/month</span></div>
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
          <span><strong>Unlimited</strong> AI deep analysis per panel</span>
        </div>
        <div class="js-lp-feature">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Cancel anytime · no commitment</span>
        </div>
      </div>`;

    const upgradeBtn = document.createElement('button');
    upgradeBtn.className = 'js-lp-upgrade-btn';
    upgradeBtn.textContent = 'Upgrade to Pro — $9/month';
    upgradeBtn.addEventListener('click', e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' });
    });
    upgrade.appendChild(upgradeBtn);
    panel.appendChild(upgrade);

    const footer = document.createElement('div');
    footer.className = 'js-panel-footer js-lp-footer';
    footer.textContent = 'Rolevance · Free plan';
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

    // ── Verdict card — light, readable, structured layout ───────────────────
    // Layout: [verdict text (flex:1)] [right column: chip / save+close]
    // No absolute positioning — everything in normal flow so nothing overlaps.
    const verdictCard = document.createElement('div');
    verdictCard.className = `js-verdict-card js-verdict-card--${label}`;

    // Verdict text — score-only, no specific skill claims (AI updates later)
    let decisionText;
    if (!hasScore)        decisionText = 'Complete your profile to score';
    else if (score >= 80) decisionText = 'Apply with confidence';
    else if (score >= 70) decisionText = 'Strong match — worth applying';
    else if (score >= 55) decisionText = 'Worth applying';
    else if (score >= 40) decisionText = 'Stretch role — if compelling';
    else                  decisionText = 'Likely not a match';

    const vcText = document.createElement('div');
    vcText.className = `js-verdict-text js-verdict-text--${label}`;
    vcText.dataset.jsDecisionLead = '1';
    vcText.textContent = decisionText;

    // Right column: score chip above, buttons below — stacked, no overlap
    const vcRight = document.createElement('div');
    vcRight.className = 'js-verdict-right';

    // Score chip with /100 context
    const vcChip = document.createElement('div');
    vcChip.className = `js-verdict-chip js-verdict-chip--${label}`;
    vcChip.innerHTML =
      `<span class="js-verdict-chip-num">${hasScore ? score : '—'}</span>` +
      (hasScore ? `<span class="js-verdict-chip-sub">/100</span>` : '');

    // Save + close as a button row
    const vcBtns = document.createElement('div');
    vcBtns.className = 'js-verdict-btns';
    vcBtns.append(makeSaveBtn(jobData, result), makeCloseBtn());

    vcRight.append(vcChip, vcBtns);

    // Main row: text + right column
    const vcMain = document.createElement('div');
    vcMain.className = 'js-verdict-main';
    vcMain.append(vcText, vcRight);
    verdictCard.appendChild(vcMain);

    // Meta row: job title · company · match label
    const vcMeta = document.createElement('div');
    vcMeta.className = 'js-verdict-meta';
    const ctxParts = [jobData.title, jobData.company].filter(Boolean);
    const mTxt     = result.text || '';
    vcMeta.innerHTML =
      (ctxParts.length ? `<span class="js-verdict-job">${ctxParts.join(' · ')}</span>` : '') +
      (ctxParts.length && mTxt ? `<span class="js-verdict-sep"> · </span>` : '') +
      (mTxt ? `<span class="js-verdict-lbl">${mTxt}</span>` : '');
    verdictCard.appendChild(vcMeta);

    panel.appendChild(verdictCard);

    // 2. Quick-facts bar (moved up — first body element)
    const qf = buildQuickFacts(jobData, result);
    if (qf) panel.appendChild(qf);

    // 5. AI section placeholder (ai-analyzer fills this async)
    const aiSection = document.createElement('div');
    aiSection.className = 'js-ai-section';
    aiSection.innerHTML = `<div class="js-ai-hdr">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
      <span class="js-ai-loading">Will load when you open the full job…</span>
    </div>`;
    panel.appendChild(aiSection);

    // 4. Criteria — collapsible, collapsed by default
    if (result.criteria?.length) {
      const weighted  = result.criteria.filter(c => c.weight > 0);
      const metCount  = weighted.filter(c => c.status === 'pass').length;
      const total     = weighted.length;

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

    // (Rule-based tips suppressed from panel body — AI analysis provides richer tips)

    // 8. Footer
    const footer = document.createElement('div');
    footer.className = 'js-panel-footer';
    footer.innerHTML = _buildFooterHTML(panelCheckResult);
    panel.appendChild(footer);

    return panel;
  }

  // ── Show / hide ────────────────────────────────────────────────────────────
  // anchor: any DOM element — li on search page, #js-detail-panel-root on detail page.
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
  // badge:  the clicked element (js-badge on search page, .js-db-analysis-btn on detail)
  // anchor: where to append the panel (li on search, #js-detail-panel-root on detail)
  async function togglePanel(badge, anchor, result, jobData) {
    // Same badge clicked again → close the panel
    if (_panel && _badge === badge) { hidePanel(); return; }
    if (_checking) return;
    _checking = true;

    if (_badge) _badge.classList.remove('js-badge--active');

    // Show a loading indicator in the trigger element while the gate checks
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
        limitReached: true,
        resetAt:   panelCheckResult.resetAt  || null,
        usedToday: panelCheckResult.usedToday || 0,
        limit:     panelCheckResult.limit    || 5,
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