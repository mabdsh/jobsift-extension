// JobSift Panel v2.1.0
// Layout: score ring → verdict → AI section → criteria → tips
// Limit panel: shown when daily AI limit is reached

(function () {
  'use strict';
  if (window._jsPanel) return;
  window._jsPanel = true;

  let _panel  = null;
  let _badge  = null;
  let _escKey = null;

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

  function makeCloseBtn() {
    const btn = document.createElement('button');
    btn.className = 'js-close-btn';
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', e => { e.stopPropagation(); hidePanel(); });
    return btn;
  }

  // ── Limit panel ────────────────────────────────────────────────────────────
  // Shown instead of the normal panel when the user's daily AI limit is hit.
  // Shows exactly what the limit was, when it resets, and a clear upgrade CTA.
  function createLimitPanel(result) {
    const resets = timeUntilReset(result.resetAt);

    const panel = document.createElement('div');
    panel.className = 'js-panel js-limit-panel';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'js-lp-hdr';
    hdr.innerHTML = `
      <div class="js-lp-icon">
        <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
          <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2"
                stroke-linecap="round"/>
          <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
        </svg>
      </div>
      <div class="js-lp-hdr-text">
        <div class="js-lp-title">Daily limit reached</div>
        <div class="js-lp-sub">You've used all your free AI scores for today</div>
      </div>`;
    hdr.appendChild(makeCloseBtn());
    panel.appendChild(hdr);

    // Reset timer
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

    // Current plan limits
    const plan = document.createElement('div');
    plan.className = 'js-lp-plan';
    plan.innerHTML = `
      <div class="js-lp-plan-label">Your free plan includes</div>
      <div class="js-lp-plan-limits">
        <div class="js-lp-limit-item js-lp-limit--used">
          <span class="js-lp-limit-num">30</span>
          <span class="js-lp-limit-name">AI scores / day</span>
        </div>
        <div class="js-lp-limit-item js-lp-limit--used">
          <span class="js-lp-limit-num">3</span>
          <span class="js-lp-limit-name">deep analyses / day</span>
        </div>
        <div class="js-lp-limit-item">
          <span class="js-lp-limit-num">5</span>
          <span class="js-lp-limit-name">profile parses / day</span>
        </div>
      </div>`;
    panel.appendChild(plan);

    // Divider
    const div = document.createElement('div');
    div.className = 'js-lp-divider';
    panel.appendChild(div);

    // Upgrade CTA
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
          <span><strong>300</strong> AI job scores per day</span>
        </div>
        <div class="js-lp-feature">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span><strong>30</strong> deep panel analyses per day</span>
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
      // Delegate to the service worker — it knows the backend URL
      chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' });
    });
    upgrade.appendChild(upgradeBtn);
    panel.appendChild(upgrade);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'js-panel-footer js-lp-footer';
    footer.textContent = 'JobSift · Free plan · Scores resume at midnight UTC';
    panel.appendChild(footer);

    return panel;
  }

  // ── Normal scoring panel ───────────────────────────────────────────────────
  function createPanel(result, jobData) {
    const label = result.label || 'gray';
    const panel = document.createElement('div');
    panel.className = `js-panel js-panel--${label}`;

    // Header: ring + verdict text + close
    const hdr = document.createElement('div');
    hdr.className = 'js-panel-hdr';

    const ring = document.createElement('div');
    ring.className = `js-ring js-ring--${label}`;
    const num = document.createElement('span'); num.className = 'js-ring-num';
    num.textContent = result.score !== null ? result.score : '—';
    const sub = document.createElement('span'); sub.className = 'js-ring-sub';
    sub.textContent = result.score !== null ? '/ 100' : 'no data';
    ring.append(num, sub);

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

    hdr.append(ring, meta, makeCloseBtn());
    panel.appendChild(hdr);

    // Verdict line
    if (result.verdict) {
      const verdictEl = document.createElement('div');
      verdictEl.className = `js-verdict-line js-verdict-line--${label}`;
      verdictEl.textContent = result.verdict;
      panel.appendChild(verdictEl);
    }

    // Recommendation
    if (result.recommendation) {
      const rec = document.createElement('div');
      rec.className = `js-rec js-rec--${result.recommendation.level}`;
      rec.textContent = result.recommendation.text;
      panel.appendChild(rec);
    }

    // Missing critical skills nudge
    if (result.missingCritical?.length) {
      const nudge = document.createElement('div');
      nudge.className = 'js-nudge js-nudge--danger';
      nudge.innerHTML = `<strong>⚡ Critical skills not found:</strong> ${result.missingCritical.join(', ')} — these are marked as must-haves`;
      panel.appendChild(nudge);
    } else if (result.score !== null && result.confidence < 0.4 && result.warnings?.length) {
      const nudge = document.createElement('div');
      nudge.className = 'js-nudge';
      nudge.innerHTML = `<strong>${Math.round((result.confidence||0)*100)}% profile coverage</strong> — add these for a complete score:`;
      const ul = document.createElement('ul');
      ul.className = 'js-nudge-list';
      result.warnings.slice(0,3).forEach(w => { const li=document.createElement('li'); li.textContent=w; ul.appendChild(li); });
      nudge.appendChild(ul);
      panel.appendChild(nudge);
    }

    // AI section placeholder (filled by ai-analyzer.js)
    const aiSection = document.createElement('div');
    aiSection.className = 'js-ai-section';
    aiSection.innerHTML = `<div class="js-ai-hdr">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
      <span class="js-ai-loading">Will load when you open the full job…</span>
    </div>`;
    panel.appendChild(aiSection);

    // Criteria breakdown
    if (result.criteria?.length) {
      const section = document.createElement('div');
      section.className = 'js-criteria';
      const lbl = document.createElement('div');
      lbl.className = 'js-section-lbl';
      lbl.textContent = 'Score breakdown';
      section.appendChild(lbl);
      result.criteria.filter(c=>c.weight>0).forEach(c => section.appendChild(buildRow(c)));
      panel.appendChild(section);
    }

    // Resume tips
    if (result.tips?.length) {
      const tips = document.createElement('div');
      tips.className = 'js-tips';
      const tipsLbl = document.createElement('div');
      tipsLbl.className = 'js-section-lbl';
      tipsLbl.textContent = 'Before you apply';
      tips.appendChild(tipsLbl);
      result.tips.forEach(tip => {
        const item = document.createElement('div');
        item.className = 'js-tip';
        const arrow = document.createElement('span');
        arrow.className = 'js-tip-arrow'; arrow.textContent = '→';
        const txt = document.createElement('span'); txt.textContent = tip;
        item.append(arrow, txt);
        tips.appendChild(item);
      });
      panel.appendChild(tips);
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'js-panel-footer';
    footer.innerHTML = '<strong>JobSift</strong> · Scoring from card data · AI analysis loads on click';
    panel.appendChild(footer);

    return panel;
  }

  // ── Criterion row ──────────────────────────────────────────────────────────
  function buildRow(c) {
    const row  = document.createElement('div');
    row.className = `js-crit js-crit--${c.status}`;
    const bar  = document.createElement('div'); bar.className = 'js-crit-bar';
    const icon = document.createElement('span'); icon.className = 'js-crit-icon';
    icon.textContent = {pass:'✓',partial:'~',fail:'✗',unknown:'?'}[c.status]||'?';
    const body = document.createElement('div'); body.className = 'js-crit-body';
    const nameRow = document.createElement('div'); nameRow.className = 'js-crit-name-row';
    const name = document.createElement('span'); name.className = 'js-crit-name';
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
      (c.matched||[]).forEach(m => {
        const chip = document.createElement('span');
        chip.className = `js-chip ${m.inTitle ? 'js-chip--title' : 'js-chip--match'}`;
        chip.textContent = m.kw||m;
        chip.title = m.inTitle ? 'Found in job title — strong signal' : m.via ? `Matched via "${m.via}"` : 'Found in listing';
        chips.appendChild(chip);
      });
      (c.missing||[]).forEach(kw => {
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

  // ── Show / hide ────────────────────────────────────────────────────────────
  function showPanel(li, result, jobData) {
    hidePanel();
    // Route to limit panel when daily AI scoring limit is hit
    const panel = result.limitReached
      ? createLimitPanel(result)
      : createPanel(result, jobData);
    li.appendChild(panel);
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('js-panel--visible')));
    _panel = panel;
    _escKey = e => { if (e.key==='Escape') hidePanel(); };
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

  function togglePanel(badge, li, result, jobData) {
    if (_panel && _badge === badge) { hidePanel(); return; }
    if (_badge) _badge.classList.remove('js-badge--active');
    _badge = badge;
    badge.classList.add('js-badge--active');
    showPanel(li, result, jobData);
    // Only fire deep analysis hook when NOT in limit state
    if (_panel && !result.limitReached && typeof window._jobsiftOnPanelOpen === 'function') {
      window._jobsiftOnPanelOpen(jobData, _panel, li);
    }
  }

  function getOpenPanel() { return _panel; }

  window.hidePanel     = hidePanel;
  window.togglePanel   = togglePanel;
  window.getOpenPanel  = getOpenPanel;

}());
