// JobSift Panel v3.2.0
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

  const CIRC = 163.36;

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
  function buildRing(label, score) {
    const hasScore = score !== null && score !== undefined;
    const offset   = hasScore ? CIRC * (1 - score / 100) : CIRC;

    const wrap = document.createElement('div');
    wrap.className = 'js-ring-wrap';
    wrap.innerHTML = `
      <svg class="js-ring-svg" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle class="js-ring-track" cx="32" cy="32" r="26"/>
        <circle class="js-ring-arc js-ring-arc--${label}" cx="32" cy="32" r="26"
          stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}"/>
      </svg>
      <div class="js-ring-inner">
        <span class="js-ring-num js-ring-num--${label}">${hasScore ? score : '—'}</span>
        <span class="js-ring-sub">${hasScore ? '/100' : 'no data'}</span>
      </div>`;
    return wrap;
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
      item.innerHTML = `
        <span class="js-qf-icon">${f.icon}</span>
        <div class="js-qf-info">
          <span class="js-qf-label">${f.label}</span>
          <span class="js-qf-val">${f.val}</span>
        </div>`;
      bar.appendChild(item);
    });

    return bar;
  }

  // ── Criterion row ──────────────────────────────────────────────────────────
  function buildRow(c) {
    const row  = document.createElement('div');
    row.className = `js-crit js-crit--${c.status}`;
    const bar  = document.createElement('div'); bar.className = 'js-crit-bar';
    const icon = document.createElement('span'); icon.className = 'js-crit-icon';
    icon.textContent = { pass:'✓', partial:'~', fail:'✗', unknown:'?' }[c.status] || '?';
    const body = document.createElement('div'); body.className = 'js-crit-body';
    const nameRow = document.createElement('div'); nameRow.className = 'js-crit-name-row';
    const name    = document.createElement('span'); name.className = 'js-crit-name';
    name.textContent = c.name;
    nameRow.appendChild(name);
    if (c.verdict) {
      const v = document.createElement('span');
      v.className = `js-verdict js-verdict--${c.status}`;
      v.textContent = c.verdict;
      nameRow.appendChild(v);
    }
    body.appendChild(nameRow);
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
        chip.title = m.inTitle ? 'Found in job title — strong signal'
          : m.via ? `Matched via "${m.via}"` : 'Found in listing';
        chips.appendChild(chip);
      });
      (c.missing || []).forEach(kw => {
        const chip = document.createElement('span');
        chip.className = 'js-chip js-chip--miss';
        chip.textContent = kw;
        chip.title = 'Not mentioned in listing';
        chips.appendChild(chip);
      });
      body.appendChild(chips);
    }
    row.append(bar, icon, body);
    return row;
  }

  // ── Footer text ────────────────────────────────────────────────────────────
  function _buildFooterHTML(pcr) {
    if (!pcr) return '<strong>JobSift</strong> · AI analysis loads when you open the full job';
    if (pcr.trial && pcr.trialDaysLeft !== null) {
      return `<strong>JobSift</strong> · Trial · ${pcr.trialDaysLeft} day${pcr.trialDaysLeft !== 1 ? 's' : ''} remaining`;
    }
    if (!pcr.trial && pcr.limit !== null) {
      const remaining = pcr.limit - (pcr.usedToday || 0);
      return `<strong>JobSift</strong> · ${pcr.usedToday || 0} of ${pcr.limit} panels used today · ${remaining} remaining`;
    }
    return '<strong>JobSift</strong> · AI analysis loads when you open the full job';
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
        <div class="js-lp-sub">You've opened all ${limit} of your free panels today</div>
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
          <span class="js-lp-limit-num">7</span>
          <span class="js-lp-limit-name">day free trial</span>
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
        <div class="js-lp-upgrade-title">JobSift Pro</div>
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
    upgradeBtn.textContent = 'Upgrade to Pro — $7/month';
    upgradeBtn.addEventListener('click', e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' });
    });
    upgrade.appendChild(upgradeBtn);
    panel.appendChild(upgrade);

    const footer = document.createElement('div');
    footer.className = 'js-panel-footer js-lp-footer';
    footer.textContent = 'JobSift · Free plan · Panels reset at midnight UTC';
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

    // 1. Header
    const hdr = document.createElement('div');
    hdr.className = 'js-panel-hdr';

    const ring = buildRing(label, score);

    const meta = document.createElement('div');
    meta.className = 'js-panel-meta';

    const matchTxt = document.createElement('div');
    matchTxt.className = `js-match-txt js-txt--${label}`;
    matchTxt.textContent = result.text || '—';

    const detail = document.createElement('div');
    detail.className = 'js-match-detail';
    detail.textContent = result.total > 0
      ? `${result.metCount} of ${result.total} criteria met · ${Math.round((result.confidence||0)*100)}% data coverage`
      : 'Complete your profile for a full score';
    meta.append(matchTxt, detail);

    hdr.append(ring, meta, makeSaveBtn(jobData, result), makeCloseBtn());
    panel.appendChild(hdr);

    // 2. Verdict line
    if (result.verdict) {
      const verdictEl = document.createElement('div');
      verdictEl.className = `js-verdict-line js-verdict-line--${label}`;
      verdictEl.textContent = result.verdict;
      panel.appendChild(verdictEl);
    }

    // 3. Decision block
    panel.appendChild(buildDecision(result));

    // 4. Quick-facts bar
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

    // 6. Criteria breakdown
    if (result.criteria?.length) {
      const section = document.createElement('div');
      section.className = 'js-criteria';
      const lbl = document.createElement('div');
      lbl.className = 'js-section-lbl';
      lbl.textContent = 'Score breakdown';
      section.appendChild(lbl);
      result.criteria.filter(c => c.weight > 0).forEach(c => section.appendChild(buildRow(c)));
      panel.appendChild(section);
    }

    // 7. Resume tips
    if (result.tips?.length) {
      const tips = document.createElement('div');
      tips.className = 'js-tips';
      const tipsLbl = document.createElement('div');
      tipsLbl.className = 'js-section-lbl';
      tipsLbl.textContent = 'Before you apply';
      tips.appendChild(tipsLbl);
      result.tips.forEach(tip => {
        const item  = document.createElement('div');
        item.className = 'js-tip';
        const arrow = document.createElement('span');
        arrow.className = 'js-tip-arrow'; arrow.textContent = '→';
        const txt   = document.createElement('span'); txt.textContent = tip;
        item.append(arrow, txt);
        tips.appendChild(item);
      });
      panel.appendChild(tips);
    }

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

    if (_panel && typeof window._jobsiftOnPanelOpen === 'function') {
      window._jobsiftOnPanelOpen(jobData, _panel, anchor);
    }
  }

  function getOpenPanel() { return _panel; }

  window.hidePanel    = hidePanel;
  window.togglePanel  = togglePanel;
  window.getOpenPanel = getOpenPanel;

}());