// JobSift Injector v2.8.0
// v2.8.0: detail page banner — injectDetailBanner(), updateDetailBanner(),
//         removeDetailBanner(), getOrCreateDetailPanelRoot()
// v2.7.0: persistent count cache — survives LinkedIn's virtual scroll DOM mutations.
//         Amber filter fixed to show only amber jobs (not green+amber).

(function () {
  'use strict';
  if (window._jsInjector) return;
  window._jsInjector = true;

  let _filter    = 'all';
  let _filterBar = null;

  // ── Persistent score result cache ──────────────────────────────────────────
  const _jobResults = new Map();

  function _jobKey(jobData, li) {
    return jobData?.jobId
      || li?.dataset?.occludableJobId
      || li?.dataset?.jobId
      || (jobData?.title ? `${jobData.title}|${jobData.company || ''}` : null);
  }

  // ── Loading badge (search page cards) ─────────────────────────────────────
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

  function refreshFilterBar() {
    if (!_filterBar || !document.contains(_filterBar)) { injectFilterBar(); return; }

    const counts = { green:0, amber:0, red:0, total:0, loading:0 };
    _jobResults.forEach(label => {
      counts.total++;
      if      (label === 'green') counts.green++;
      else if (label === 'amber') counts.amber++;
      else if (label === 'red')   counts.red++;
    });

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

  function applyJobFilter(filter) {
    _filter = filter;
    document.querySelectorAll('li[data-js-done]').forEach(li => _applyFilterToCard(li, filter));
  }

  function _applyFilterToCard(li, filter) {
    const badge = li.querySelector('.js-badge');
    if (badge?.classList.contains('js-badge--loading') || filter === 'all') {
      li.style.display = '';
      return;
    }
    const lbl = badge?.classList.contains('js-badge--green') ? 'green'
              : badge?.classList.contains('js-badge--amber') ? 'amber'
              : badge?.classList.contains('js-badge--red')   ? 'red' : 'gray';
    const show = filter === 'green' ? lbl === 'green'
               : filter === 'amber' ? lbl === 'amber'
               : filter === 'red'   ? lbl === 'red' : true;
    li.style.display = show ? '' : 'none';
  }

  function resetFilter() {
    _filter    = 'all';
    _filterBar = null;
    _jobResults.clear();
  }

  // ── Detail page banner ─────────────────────────────────────────────────────
  // A full-width banner injected above the "About the job" section on detail
  // pages. Shows the JobSift score + a "View full analysis →" button that
  // opens the standard panel.
  //
  // Injection point: [data-sdui-component*="aboutTheJob"] parent — stable
  // data-sdui-component attribute that LinkedIn uses for its own component
  // identification and doesn't rename during visual refactors.

  let _detailBanner = null;

  function injectDetailBanner() {
    removeDetailBanner();

    // Inject as the very first child of the LazyColumn — this puts the banner
    // above the job title, company info, and all other detail page content.
    // data-component-type="LazyColumn" is a stable structural attribute that
    // LinkedIn uses for its own component system and doesn't rename casually.
    const lazyCol = document.querySelector('[data-component-type="LazyColumn"]');
    if (!lazyCol) return null;

    const banner = document.createElement('div');
    banner.id = 'js-detail-banner';
    banner.className = 'js-detail-banner js-detail-banner--loading';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', 'JobSift: scoring this job…');

    // Loading state — pulse dot + text
    banner.innerHTML = `
      <div class="js-db-inner">
        <div class="js-db-left">
          <div class="js-db-brand">
            <svg viewBox="0 0 16 18" fill="none" width="11" height="13" aria-hidden="true">
              <rect x="1" y="2" width="14" height="2" rx="1" fill="rgba(17,30,92,0.7)"/>
              <rect x="2" y="6" width="12" height="2" rx="1" fill="rgba(17,30,92,0.45)"/>
              <rect x="3" y="10" width="10" height="2" rx="1" fill="rgba(17,30,92,0.2)"/>
              <circle cx="8" cy="15.2" r="2" fill="#3b82f6"/>
              <circle cx="8" cy="15.2" r=".85" fill="white"/>
            </svg>
            <span class="js-db-brand-name">JobSift</span>
          </div>
          <span class="js-db-dot js-db-dot--loading"></span>
          <span class="js-db-loading-text">Scoring this job…</span>
        </div>
      </div>`;

    // insertBefore with firstChild puts it above everything — job title, company,
    // apply buttons, and the "About the job" section all appear below the banner.
    lazyCol.insertBefore(banner, lazyCol.firstChild);
    _detailBanner = banner;
    return banner;
  }

  function updateDetailBanner(result, jobData) {
    const banner = _detailBanner || document.getElementById('js-detail-banner');
    if (!banner) return;

    const label    = result.label || 'gray';
    const hasScore = result.score !== null && result.score !== undefined;
    const scoreText = hasScore ? `${result.score}%` : '—';
    const ariaLabel = hasScore
      ? `JobSift: ${result.score}% match — ${result.text || ''}`
      : 'JobSift: Complete your profile to score this job';

    banner.className = `js-detail-banner js-detail-banner--${label}`;
    banner.setAttribute('aria-label', ariaLabel);

    banner.innerHTML = `
      <div class="js-db-inner">
        <div class="js-db-left">
          <div class="js-db-brand">
            <svg viewBox="0 0 16 18" fill="none" width="11" height="13" aria-hidden="true">
              <rect x="1" y="2" width="14" height="2" rx="1" fill="rgba(17,30,92,0.7)"/>
              <rect x="2" y="6" width="12" height="2" rx="1" fill="rgba(17,30,92,0.45)"/>
              <rect x="3" y="10" width="10" height="2" rx="1" fill="rgba(17,30,92,0.2)"/>
              <circle cx="8" cy="15.2" r="2" fill="#3b82f6"/>
              <circle cx="8" cy="15.2" r=".85" fill="white"/>
            </svg>
            <span class="js-db-brand-name">JobSift</span>
          </div>
          <div class="js-db-score-wrap">
            <span class="js-db-dot js-db-dot--${label}"></span>
            <span class="js-db-score js-db-score--${label}">${scoreText}</span>
            <span class="js-db-match-text">${_escBanner(result.text || '')}</span>
          </div>
          ${result.verdict
            ? `<span class="js-db-verdict">${_escBanner(result.verdict)}</span>`
            : ''}
          <span class="js-db-basis">Based on full description</span>
        </div>
        <button class="js-db-analysis-btn" type="button">
          View full analysis →
        </button>
      </div>`;

    // Wire "View full analysis" button → opens the panel
    const btn = banner.querySelector('.js-db-analysis-btn');
    if (btn) {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        // One panel at a time — hidePanel() runs inside togglePanel() if needed.
        // Panel is anchored to the dedicated root div immediately below the banner.
        const panelRoot = getOrCreateDetailPanelRoot();
        if (panelRoot) {
          window.togglePanel(btn, panelRoot, result, jobData);
        }
      });
    }

    _detailBanner = banner;
  }

  // Creates (or returns) a dedicated anchor div for the panel on detail pages.
  // Sits immediately below the banner so the panel opens in context.
  function getOrCreateDetailPanelRoot() {
    let root = document.getElementById('js-detail-panel-root');
    if (root && document.contains(root)) return root;

    root = document.createElement('div');
    root.id = 'js-detail-panel-root';

    const banner = document.getElementById('js-detail-banner');
    if (banner?.parentNode) {
      banner.parentNode.insertBefore(root, banner.nextSibling);
    }
    return root;
  }

  function removeDetailBanner() {
    // Close any open panel first so it isn't left orphaned in the DOM
    window.hidePanel?.();

    const banner = document.getElementById('js-detail-banner');
    if (banner) banner.remove();

    const panelRoot = document.getElementById('js-detail-panel-root');
    if (panelRoot) panelRoot.remove();

    _detailBanner = null;
  }

  // Simple HTML escaper for banner text content (AI-generated strings)
  function _escBanner(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Indeed: badge injection ────────────────────────────────────────────────
  // Injects the badge as a floating pill in the bottom-right corner of the
  // cardOutline div. This gives the badge its own dedicated space — separate
  // from Indeed's ctaContainer (bookmark / dislike buttons) — so it never
  // competes for room with Indeed's own UI elements.
  // cardOutline already has position:relative from our CSS.

  function injectIndeedLoadingBadge(card) {
    if (card.dataset.jsDone || card.dataset.jsProcessing) return;
    if (card.querySelector('.js-badge')) return;

    card.dataset.jsProcessing = 'true';

    const badge = createLoadingBadge();
    badge.classList.add('js-badge--indeed-float');
    card.appendChild(badge);

    card.dataset.jsDone = 'true';
    delete card.dataset.jsProcessing;
  }

  function updateIndeedBadgeWithResult(card, result, jobData) {
    const old = card.querySelector('.js-badge');
    if (!old) return;

    const safeLabel = result.label || 'gray';
    const hasScore  = result.score !== null && result.score !== undefined;
    const scoreText = hasScore ? `${result.score}%` : '—';
    const ariaText  = hasScore
      ? `JobSift: ${result.score}% match — ${result.text || ''}`
      : `JobSift: ${result.text || 'Set up your profile to score jobs'}`;

    const badge = document.createElement('span');
    badge.className = `js-badge js-badge--${safeLabel} js-badge--indeed-float`;
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
      window.togglePanel(badge, card, result, jobData);
    });
    badge.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.togglePanel(badge, card, result, jobData);
      }
    });

    old.replaceWith(badge);

    const key = jobData?.jobId || (jobData?.title ? `${jobData.title}|${jobData.company || ''}` : null);
    if (key) _jobResults.set(key, safeLabel);

    clearTimeout(window._jsRefreshTimer);
    window._jsRefreshTimer = setTimeout(refreshIndeedFilterBar, 200);
  }

  // ── Indeed: filter bar ─────────────────────────────────────────────────────
  // Injects above Indeed's card list ul inside #mosaic-provider-jobcards.
  // Reuses the same _filterBar reference and counts from _jobResults.

  let _indeedFilterBar = null;

  function injectIndeedFilterBar() {
    if (_indeedFilterBar && document.contains(_indeedFilterBar)) return;

    // #mosaic-provider-jobcards is a stable ID — the ul inside is the card list
    const cardList = document.querySelector('#mosaic-provider-jobcards ul');
    if (!cardList) return;
    if (cardList.parentElement?.querySelector('#js-indeed-filter-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'js-indeed-filter-bar';
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
          <rect x="1" y="2" width="14" height="2" rx="1" fill="rgba(255,255,255,0.92)"/>
          <rect x="2" y="6" width="12" height="2" rx="1" fill="rgba(255,255,255,0.55)"/>
          <rect x="3" y="10" width="10" height="2" rx="1" fill="rgba(255,255,255,0.22)"/>
          <circle cx="8" cy="15.2" r="2" fill="#3b82f6"/>
          <circle cx="8" cy="15.2" r=".85" fill="white"/>
        </svg>
      </div>
      <span>JobSift</span>`;

    const divider = document.createElement('div');
    divider.className = 'js-fb-divider';

    const btns = document.createElement('div');
    btns.className = 'js-fb-btns';

    [
      { filter:'all',   label:'All',     cls:'',        id:'js-ifn-all'   },
      { filter:'green', label:'Strong',  cls:'--green', id:'js-ifn-green' },
      { filter:'amber', label:'Partial', cls:'--amber', id:'js-ifn-amber' },
      { filter:'red',   label:'Skip',    cls:'--red',   id:'js-ifn-red'   },
    ].forEach(({ filter, label, cls, id }) => {
      const btn     = document.createElement('button');
      const isActive = filter === _filter;
      btn.className  = `js-fb-btn${cls ? ' js-fb-btn'+cls : ''}${isActive ? ' js-fb-btn--active' : ''}`;
      btn.dataset.filter = filter;
      btn.innerHTML  = `${label} <span class="js-fb-n" id="${id}">—</span>`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _filter = filter;
        bar.querySelectorAll('.js-fb-btn').forEach(b => b.classList.remove('js-fb-btn--active'));
        btn.classList.add('js-fb-btn--active');
        applyIndeedJobFilter(filter);
      });
      btns.appendChild(btn);
    });

    const status = document.createElement('span');
    status.className = 'js-fb-status';
    status.id = 'js-ifb-status';

    bar.append(brand, divider, btns, status);
    cardList.parentElement.insertBefore(bar, cardList);
    _indeedFilterBar = bar;
  }

  function refreshIndeedFilterBar() {
    if (!_indeedFilterBar || !document.contains(_indeedFilterBar)) {
      injectIndeedFilterBar();
      return;
    }

    const counts = { green:0, amber:0, red:0, total:0, loading:0 };
    _jobResults.forEach(label => {
      counts.total++;
      if      (label === 'green') counts.green++;
      else if (label === 'amber') counts.amber++;
      else if (label === 'red')   counts.red++;
    });

    const loading = document.querySelectorAll('div.cardOutline .js-badge--loading').length;
    counts.loading = loading;
    counts.total  += loading;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('js-ifn-all',   counts.total || '—');
    set('js-ifn-green', counts.green);
    set('js-ifn-amber', counts.amber);
    set('js-ifn-red',   counts.red);

    const s = document.getElementById('js-ifb-status');
    if (s) s.textContent = loading > 0 ? `Scoring ${loading}…` : '';
  }

  function applyIndeedJobFilter(filter) {
    _filter = filter;
    document.querySelectorAll('div.cardOutline[data-js-done]').forEach(card => {
      const badge = card.querySelector('.js-badge');
      if (badge?.classList.contains('js-badge--loading') || filter === 'all') {
        card.closest('li').style.display = '';
        return;
      }
      const lbl = badge?.classList.contains('js-badge--green') ? 'green'
                : badge?.classList.contains('js-badge--amber') ? 'amber'
                : badge?.classList.contains('js-badge--red')   ? 'red' : 'gray';
      const show = filter === 'green' ? lbl === 'green'
                 : filter === 'amber' ? lbl === 'amber'
                 : filter === 'red'   ? lbl === 'red' : true;
      const li = card.closest('li');
      if (li) li.style.display = show ? '' : 'none';
    });
  }

  // ── Indeed: right-pane / direct-view banner ────────────────────────────────
  // Injects above div.jobsearch-HeaderContainer inside the right pane or
  // direct /viewjob page. Same visual design as the LinkedIn detail banner.

  let _indeedDetailBanner = null;

  // Shared banner HTML builder — used by both LinkedIn and Indeed
  function _buildBannerLoadingHTML() {
    return `
      <div class="js-db-inner">
        <div class="js-db-left">
          <div class="js-db-brand">
            <svg viewBox="0 0 16 18" fill="none" width="11" height="13" aria-hidden="true">
              <rect x="1" y="2" width="14" height="2" rx="1" fill="rgba(17,30,92,0.7)"/>
              <rect x="2" y="6" width="12" height="2" rx="1" fill="rgba(17,30,92,0.45)"/>
              <rect x="3" y="10" width="10" height="2" rx="1" fill="rgba(17,30,92,0.2)"/>
              <circle cx="8" cy="15.2" r="2" fill="#3b82f6"/>
              <circle cx="8" cy="15.2" r=".85" fill="white"/>
            </svg>
            <span class="js-db-brand-name">JobSift</span>
          </div>
          <span class="js-db-dot js-db-dot--loading"></span>
          <span class="js-db-loading-text">Scoring this job…</span>
        </div>
      </div>`;
  }

  function injectIndeedDetailBanner() {
    removeIndeedDetailBanner();

    // Inject before the header container — this puts the banner above the title,
    // company, salary, and apply buttons. Works for both the right pane on
    // search pages and direct /viewjob pages.
    const header = document.querySelector(
      '#jobsearch-ViewjobPaneWrapper div.jobsearch-HeaderContainer, ' +
      'div.jobsearch-JobComponent div.jobsearch-HeaderContainer'
    );
    if (!header?.parentElement) return null;

    const banner = document.createElement('div');
    banner.id = 'js-indeed-detail-banner';
    banner.className = 'js-detail-banner js-detail-banner--loading js-detail-banner--indeed';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', 'JobSift: scoring this job…');
    banner.innerHTML = _buildBannerLoadingHTML();

    header.parentElement.insertBefore(banner, header);
    _indeedDetailBanner = banner;
    return banner;
  }

  function updateIndeedDetailBanner(result, jobData) {
    const banner = _indeedDetailBanner || document.getElementById('js-indeed-detail-banner');
    if (!banner) return;

    const label    = result.label || 'gray';
    const hasScore = result.score !== null && result.score !== undefined;
    const scoreText = hasScore ? `${result.score}%` : '—';

    banner.className = `js-detail-banner js-detail-banner--${label} js-detail-banner--indeed`;
    banner.setAttribute('aria-label',
      hasScore ? `JobSift: ${result.score}% match — ${result.text || ''}` : 'JobSift: Complete your profile to score this job'
    );

    banner.innerHTML = `
      <div class="js-db-inner">
        <div class="js-db-left">
          <div class="js-db-brand">
            <svg viewBox="0 0 16 18" fill="none" width="11" height="13" aria-hidden="true">
              <rect x="1" y="2" width="14" height="2" rx="1" fill="rgba(17,30,92,0.7)"/>
              <rect x="2" y="6" width="12" height="2" rx="1" fill="rgba(17,30,92,0.45)"/>
              <rect x="3" y="10" width="10" height="2" rx="1" fill="rgba(17,30,92,0.2)"/>
              <circle cx="8" cy="15.2" r="2" fill="#3b82f6"/>
              <circle cx="8" cy="15.2" r=".85" fill="white"/>
            </svg>
            <span class="js-db-brand-name">JobSift</span>
          </div>
          <div class="js-db-score-wrap">
            <span class="js-db-dot js-db-dot--${label}"></span>
            <span class="js-db-score js-db-score--${label}">${scoreText}</span>
            <span class="js-db-match-text">${_escBanner(result.text || '')}</span>
          </div>
          ${result.verdict ? `<span class="js-db-verdict">${_escBanner(result.verdict)}</span>` : ''}
          <span class="js-db-basis">Based on full description</span>
        </div>
        <button class="js-db-analysis-btn" type="button">
          View full analysis →
        </button>
      </div>`;

    const btn = banner.querySelector('.js-db-analysis-btn');
    if (btn) {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const panelRoot = getOrCreateIndeedDetailPanelRoot();
        if (panelRoot) window.togglePanel(btn, panelRoot, result, jobData);
      });
    }

    _indeedDetailBanner = banner;
  }

  function getOrCreateIndeedDetailPanelRoot() {
    let root = document.getElementById('js-indeed-detail-panel-root');
    if (root && document.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'js-indeed-detail-panel-root';
    const banner = document.getElementById('js-indeed-detail-banner');
    if (banner?.parentNode) banner.parentNode.insertBefore(root, banner.nextSibling);
    return root;
  }

  function removeIndeedDetailBanner() {
    window.hidePanel?.();
    document.getElementById('js-indeed-detail-banner')?.remove();
    document.getElementById('js-indeed-detail-panel-root')?.remove();
    _indeedDetailBanner = null;
  }

  function resetIndeedFilter() {
    _filter          = 'all';
    _indeedFilterBar = null;
    _jobResults.clear();
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  window.injectLoadingBadge             = injectLoadingBadge;
  window.updateBadgeWithResult          = updateBadgeWithResult;
  window.injectFilterBar                = injectFilterBar;
  window.refreshFilterBar               = refreshFilterBar;
  window.applyJobFilter                 = applyJobFilter;
  window.resetFilter                    = resetFilter;
  window.injectDetailBanner             = injectDetailBanner;
  window.updateDetailBanner             = updateDetailBanner;
  window.removeDetailBanner             = removeDetailBanner;
  window.getOrCreateDetailPanelRoot     = getOrCreateDetailPanelRoot;
  // Indeed
  window.injectIndeedLoadingBadge       = injectIndeedLoadingBadge;
  window.updateIndeedBadgeWithResult    = updateIndeedBadgeWithResult;
  window.injectIndeedFilterBar          = injectIndeedFilterBar;
  window.refreshIndeedFilterBar         = refreshIndeedFilterBar;
  window.applyIndeedJobFilter           = applyIndeedJobFilter;
  window.injectIndeedDetailBanner       = injectIndeedDetailBanner;
  window.updateIndeedDetailBanner       = updateIndeedDetailBanner;
  window.removeIndeedDetailBanner       = removeIndeedDetailBanner;
  window.getOrCreateIndeedDetailPanelRoot = getOrCreateIndeedDetailPanelRoot;
  window.resetIndeedFilter              = resetIndeedFilter;

}());