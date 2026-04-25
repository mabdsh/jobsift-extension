// JobSift Injector v2.2.1
// Badge injected into the actions-container column (right side, always consistent)

(function () {
  'use strict';
  if (window._jsInjector) return;
  window._jsInjector = true;

  let _filter    = 'all';
  let _filterBar = null;

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

  // ── Find the right-side actions column ────────────────────────────────────
  // This container sits at the far right of every card regardless of title length.
  // Injecting here gives us a consistent position on all cards.
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
      // Absolute fallback — rare after looksLikeJobCard fix
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

    // Fix #2: result may have score:null when profile is incomplete or AI fails.
    // Guard every field so we never render "null%", "undefined%", or
    // `js-badge--undefined` class — all of which silently break the UI.
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

    // Badge is always clickable — opens the panel which explains the score
    // (or explains why the profile needs completing when score is null)
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
    brand.innerHTML = `<svg viewBox="0 0 14 14" fill="none" width="12" height="12">
      <circle cx="7" cy="7" r="6.5" fill="#2563eb"/>
      <path d="M3.5 7l2.2 2.2 4.8-4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg><span>JobSift</span>`;

    const btns = document.createElement('div');
    btns.className = 'js-fb-btns';
    [
      { filter:'all',   label:'All',     cls:'',        id:'js-fn-all'   },
      { filter:'green', label:'Strong',  cls:'--green', id:'js-fn-green' },
      { filter:'amber', label:'Partial', cls:'--amber', id:'js-fn-amber' },
      { filter:'red',   label:'Skip',    cls:'--red',   id:'js-fn-red'   },
    ].forEach(({ filter, label, cls, id }) => {
      const btn = document.createElement('button');
      btn.className = `js-fb-btn${cls ? ' js-fb-btn'+cls : ''}${filter==='all' ? ' js-fb-btn--active' : ''}`;
      btn.dataset.filter = filter;
      btn.innerHTML = `${label} <span class="js-fb-n" id="${id}">—</span>`;
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

    bar.append(brand, btns, status);
    wrap.insertBefore(bar, list);
    _filterBar = bar;
  }

  function refreshFilterBar() {
    if (!_filterBar || !document.contains(_filterBar)) { injectFilterBar(); return; }
    const seen   = new Set();
    const counts = { green:0, amber:0, red:0, total:0, loading:0 };
    document.querySelectorAll('li[data-js-done]').forEach(li => {
      const jobId = li.dataset.occludableJobId || li.dataset.jobId;
      if (jobId) { if (seen.has(jobId)) return; seen.add(jobId); }
      const badge = li.querySelector('.js-badge');
      if (!badge) return;
      if (badge.classList.contains('js-badge--loading')) { counts.loading++; counts.total++; return; }
      counts.total++;
      if      (badge.classList.contains('js-badge--green')) counts.green++;
      else if (badge.classList.contains('js-badge--amber')) counts.amber++;
      else if (badge.classList.contains('js-badge--red'))   counts.red++;
    });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('js-fn-all',   counts.total || '—');
    set('js-fn-green', counts.green);
    set('js-fn-amber', counts.amber);
    set('js-fn-red',   counts.red);
    const s = document.getElementById('js-fb-status');
    if (s) s.textContent = counts.loading > 0 ? `Scoring ${counts.loading}…` : '';
  }

  function applyJobFilter(filter) {
    _filter = filter;
    document.querySelectorAll('li[data-js-done]').forEach(li => _applyFilterToCard(li, filter));
  }

  function _applyFilterToCard(li, filter) {
    const badge = li.querySelector('.js-badge');
    if (badge?.classList.contains('js-badge--loading') || filter === 'all') { li.style.display = ''; return; }
    const lbl = badge?.classList.contains('js-badge--green') ? 'green'
              : badge?.classList.contains('js-badge--amber') ? 'amber'
              : badge?.classList.contains('js-badge--red')   ? 'red' : 'gray';
    const show = filter==='green' ? lbl==='green'
               : filter==='amber' ? (lbl==='green'||lbl==='amber')
               : filter==='red'   ? lbl==='red' : true;
    li.style.display = show ? '' : 'none';
  }

  window.injectLoadingBadge    = injectLoadingBadge;
  window.updateBadgeWithResult = updateBadgeWithResult;
  window.injectFilterBar       = injectFilterBar;
  window.refreshFilterBar      = refreshFilterBar;
  window.applyJobFilter        = applyJobFilter;

}());