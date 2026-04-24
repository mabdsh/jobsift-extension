// JobSift Panel v2.0.0
// Layout: score ring → verdict → AI section → criteria → tips

(function () {
  'use strict';
  if (window._jsPanel) return;
  window._jsPanel = true;

  let _panel  = null;
  let _badge  = null;
  let _escKey = null;

  // ── Panel ─────────────────────────────────────────────────────────────────
  function createPanel(result, jobData) {
    const label = result.label || 'gray';
    const panel = document.createElement('div');
    panel.className = `js-panel js-panel--${label}`;

    // ── Header: ring + verdict text + close ──────────────────────────────
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

    const closeBtn = document.createElement('button');
    closeBtn.className = 'js-close-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); hidePanel(); });

    hdr.append(ring, meta, closeBtn);
    panel.appendChild(hdr);

    // ── Verdict line ──────────────────────────────────────────────────────
    if (result.verdict) {
      const verdictEl = document.createElement('div');
      verdictEl.className = `js-verdict-line js-verdict-line--${label}`;
      verdictEl.textContent = result.verdict;
      panel.appendChild(verdictEl);
    }

    // ── Recommendation ────────────────────────────────────────────────────
    if (result.recommendation) {
      const rec = document.createElement('div');
      rec.className = `js-rec js-rec--${result.recommendation.level}`;
      rec.textContent = result.recommendation.text;
      panel.appendChild(rec);
    }

    // ── Missing critical skills nudge ─────────────────────────────────────
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

    // ── AI section placeholder (filled by ai-analyzer.js) ────────────────
    const aiSection = document.createElement('div');
    aiSection.className = 'js-ai-section';
    aiSection.innerHTML = `<div class="js-ai-hdr">
      <span class="js-ai-badge">AI</span>
      <span class="js-ai-title">Deep analysis</span>
      <span class="js-ai-loading">Will load when you open the full job…</span>
    </div>`;
    panel.appendChild(aiSection);

    // ── Criteria breakdown ────────────────────────────────────────────────
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

    // ── Resume tips ───────────────────────────────────────────────────────
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

    // ── Footer ────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'js-panel-footer';
    footer.innerHTML = '<strong>JobSift</strong> · Scoring from card data · AI analysis loads on click';
    panel.appendChild(footer);

    return panel;
  }

  // ── Criterion row ──────────────────────────────────────────────────────────
  function buildRow(c) {
    const row = document.createElement('div');
    row.className = `js-crit js-crit--${c.status}`;

    const bar  = document.createElement('div');
    bar.className = 'js-crit-bar';

    const icon = document.createElement('span');
    icon.className = 'js-crit-icon';
    icon.textContent = {pass:'✓',partial:'~',fail:'✗',unknown:'?'}[c.status]||'?';

    const body = document.createElement('div');
    body.className = 'js-crit-body';

    const nameRow = document.createElement('div');
    nameRow.className = 'js-crit-name-row';

    const name = document.createElement('span');
    name.className = 'js-crit-name';
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
    const panel = createPanel(result, jobData);
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
    if (_panel && typeof window._jobsiftOnPanelOpen === 'function') {
      window._jobsiftOnPanelOpen(jobData, _panel, li);
    }
  }

  function getOpenPanel() { return _panel; }

  // ── Exports ────────────────────────────────────────────────────────────────
  window.hidePanel     = hidePanel;
  window.togglePanel   = togglePanel;
  window.getOpenPanel  = getOpenPanel;

}());
