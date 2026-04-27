// JobSift Injector v2.7.0
// v2.7.0: persistent count cache — survives LinkedIn's virtual scroll DOM mutations.
//         Amber filter fixed to show only amber jobs (not green+amber).

(function () {
  'use strict';
  if (window._jsInjector) return;
  window._jsInjector = true;

  let _filter    = 'all';
  let _filterBar = null;

  // ── Persistent score result cache ──────────────────────────────────────────
  // Keyed by jobId (or a stable title|company fallback).
  // Survives LinkedIn's virtual DOM mutations — scored jobs remain counted even
  // after LinkedIn removes their <li> elements from the viewport. Only cleared
  // on navigation (URL change) or reprocessAll (profile update).
  const _jobResults = new Map();

  function _jobKey(jobData, li) {
    return jobData?.jobId
      || li?.dataset?.occludableJobId
      || li?.dataset?.jobId
      || (jobData?.title ? `${jobData.title}|${jobData.company || ''}` : null);
  }

  // ── Loading badge ──────────────────────────────────────────────────────────
  function createLoadingBadge() {
    const badge = document.createElement('span');
    badge.className = 'js-badge js-badge--loading';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'JobSift: scoring…');
    const dot  = document.createElement('span'); dot.className = 'js-dot';
    const dots = document.createElement('span'); dots.className = 'js-badge-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';
    badge.append(dot, dots);
    return badge;
  }

  // ── Find right-side actions column ────────────────────────────────────────
  function findActionsContainer(card, li) {
    const selectors = [
      '.job-card-list__actions-container',
      '[class*="job-card-list__actions"]',
      '[class*="actions-container"]',
    ];
    for (const sel of selectors) {
      const el = card.querySelector(sel) || li.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── Inject loading badge ───────────────────────────────────────────────────
  function injectLoadingBadge(card) {
    const li = card.closest('li') || card;
    if (li.dataset.jsDone || li.dataset.jsProcessing) return;
    if (li.querySelector('.js-badge')) return;

    li.dataset.jsProcessing  = 'true';
    card.dataset.jsProcessing = 'true';

    const badge   = createLoadingBadge();
    const actions = findActionsContainer(card, li);

    if (actions) {
      const slot = document.createElement('div');
      slot.className = 'js-badge-slot';
      slot.appendChild(badge);
      actions.insertBefore(slot, actions.firstChild);
    } else {
      li.style.position = 'relative';
      badge.className += ' js-badge--abs';
      li.appendChild(badge);
    }

    li.dataset.jsDone = 'true';
    delete li.dataset.jsProcessing;
    delete card.dataset.jsProcessing;
  }

  // ── Replace loading badge with scored badge ────────────────────────────────
  function updateBadgeWithResult(li, result, jobData) {
    const old = li.querySelector('.js-badge');
    if (!old) return;

    const safeLabel = result.label || 'gray';
    const hasScore  = result.score !== null && result.score !== undefined;
    const scoreText = hasScore ? `${result.score}%` : '—';
    const ariaText  = hasScore
      ? `JobSift: ${result.score}% match — ${result.text || ''}`
      : `JobSift: ${result.text || 'Set up your profile to score jobs'}`;

    const badge = document.createElement('span');
    badge.className = `js-badge js-badge--${safeLabel}`;
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('aria-label', ariaText);
    badge.title = result.text || '';

    const dot     = document.createElement('span'); dot.className = 'js-dot';
    const scoreEl = document.createElement('span'); scoreEl.className = 'js-badge-score';
    scoreEl.textContent = scoreText;
    badge.append(dot, scoreEl);

    badge.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      window.togglePanel(badge, li, result, jobData);
    });
    badge.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.togglePanel(badge, li, result, jobData);
      }
    });

    old.replaceWith(badge);

    // Persist the result so it survives DOM mutations.
    // Uses jobId as key — stable across virtual scroll recycling.
    const key = _jobKey(jobData, li);
    if (key) _jobResults.set(key, safeLabel);

    _applyFilterToCard(li, _filter);
    clearTimeout(window._jsRefreshTimer);
    window._jsRefreshTimer = setTimeout(refreshFilterBar, 200);
  }

  // ── Filter bar ─────────────────────────────────────────────────────────────
  function injectFilterBar() {
    if (_filterBar && document.contains(_filterBar)) return;
    const firstLi = document.querySelector('li[data-js-done]');
    if (!firstLi) return;
    const list = firstLi.parentElement;
    if (!list) return;
    const wrap = list.parentElement;
    if (!wrap || wrap === document.body || wrap.querySelector('#js-filter-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'js-filter-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Filter jobs by match score');

    const brand = document.createElement('div');
    brand.className = 'js-fb-brand';
    brand.innerHTML = `
      <div style="
        width:24px;height:24px;border-radius:6px;
        background:linear-gradient(135deg,#111e5c,#0a1438);
        display:flex;align-items:center;justify-content:center;flex-shrink:0;
        box-shadow:0 1px 4px rgba(10,20,56,0.3);
      ">
        <svg viewBox="0 0 16 18" fill="none" width="11" height="13">
          <rect x="1"   y="2"    width="14" height="2"   rx="1" fill="rgba(255,255,255,0.92)"/>
          <rect x="2"   y="6"    width="12" height="2"   rx="1" fill="rgba(255,255,255,0.55)"/>
          <rect x="3"   y="10"   width="10" height="2"   rx="1" fill="rgba(255,255,255,0.22)"/>
          <circle cx="8" cy="15.2" r="2"    fill="#3b82f6"/>
          <circle cx="8" cy="15.2" r=".85"  fill="white"/>
        </svg>
      </div>
      <span>JobSift</span>`;

    const divider = document.createElement('div');
    divider.className = 'js-fb-divider';

    const btns = document.createElement('div');
    btns.className = 'js-fb-btns';

    [
      { filter:'all',   label:'All',     cls:'',        id:'js-fn-all'   },
      { filter:'green', label:'Strong',  cls:'--green', id:'js-fn-green' },
      { filter:'amber', label:'Partial', cls:'--amber', id:'js-fn-amber' },
      { filter:'red',   label:'Skip',    cls:'--red',   id:'js-fn-red'   },
    ].forEach(({ filter, label, cls, id }) => {
      const btn      = document.createElement('button');
      const isActive = filter === _filter;
      btn.className  = `js-fb-btn${cls ? ' js-fb-btn'+cls : ''}${isActive ? ' js-fb-btn--active' : ''}`;
      btn.dataset.filter = filter;
      btn.innerHTML  = `${label} <span class="js-fb-n" id="${id}">—</span>`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _filter = filter;
        bar.querySelectorAll('.js-fb-btn').forEach(b => b.classList.remove('js-fb-btn--active'));
        btn.classList.add('js-fb-btn--active');
        applyJobFilter(filter);
      });
      btns.appendChild(btn);
    });

    const status = document.createElement('span');
    status.className = 'js-fb-status';
    status.id = 'js-fb-status';

    bar.append(brand, divider, btns, status);
    wrap.insertBefore(bar, list);
    _filterBar = bar;
  }

  // ── Refresh filter bar counts ──────────────────────────────────────────────
  // Uses _jobResults cache for scored jobs — reliable regardless of DOM state.
  // Loading badges (jobs being scored right now) are read from the live DOM
  // since they haven't been persisted yet.
  function refreshFilterBar() {
    if (!_filterBar || !document.contains(_filterBar)) { injectFilterBar(); return; }

    // Scored job counts from persistent cache
    const counts = { green:0, amber:0, red:0, total:0, loading:0 };
    _jobResults.forEach(label => {
      counts.total++;
      if      (label === 'green') counts.green++;
      else if (label === 'amber') counts.amber++;
      else if (label === 'red')   counts.red++;
      // 'gray' counts toward total only — not a named filter category
    });

    // Loading badges: currently being scored, not yet in cache
    // Read from DOM (they exist exactly while scoring is in flight)
    const loading = document.querySelectorAll('.js-badge--loading').length;
    counts.loading = loading;
    counts.total  += loading;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('js-fn-all',   counts.total || '—');
    set('js-fn-green', counts.green);
    set('js-fn-amber', counts.amber);
    set('js-fn-red',   counts.red);

    const s = document.getElementById('js-fb-status');
    if (s) s.textContent = loading > 0 ? `Scoring ${loading}…` : '';
  }

  // ── Apply filter to all current cards ─────────────────────────────────────
  function applyJobFilter(filter) {
    _filter = filter;
    document.querySelectorAll('li[data-js-done]').forEach(li => _applyFilterToCard(li, filter));
  }

  // ── Apply filter to a single card ─────────────────────────────────────────
  // Bug fix: amber filter previously showed green+amber, making the "Partial: 5"
  // count show 17 cards (12 green + 5 amber). Each filter now shows exactly
  // the jobs counted in its badge.
  function _applyFilterToCard(li, filter) {
    const badge = li.querySelector('.js-badge');
    // Always show loading cards — they have no label yet
    if (badge?.classList.contains('js-badge--loading') || filter === 'all') {
      li.style.display = '';
      return;
    }
    const lbl = badge?.classList.contains('js-badge--green') ? 'green'
              : badge?.classList.contains('js-badge--amber') ? 'amber'
              : badge?.classList.contains('js-badge--red')   ? 'red' : 'gray';
    const show = filter === 'green' ? lbl === 'green'
               : filter === 'amber' ? lbl === 'amber'   // Only amber — matches the count shown
               : filter === 'red'   ? lbl === 'red' : true;
    li.style.display = show ? '' : 'none';
  }

  // ── Filter reset ───────────────────────────────────────────────────────────
  // Called by content.js on URL navigation and reprocessAll.
  // Clears both the filter state and the scored job cache so the next page
  // starts fresh with accurate counts.
  function resetFilter() {
    _filter    = 'all';
    _filterBar = null;
    _jobResults.clear();
  }

  window.injectLoadingBadge    = injectLoadingBadge;
  window.updateBadgeWithResult = updateBadgeWithResult;
  window.injectFilterBar       = injectFilterBar;
  window.refreshFilterBar      = refreshFilterBar;
  window.applyJobFilter        = applyJobFilter;
  window.resetFilter           = resetFilter;

}());