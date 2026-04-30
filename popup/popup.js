// Rolevance Popup v5.0
// v2.6.0: manage billing section for Pro users
// v2.5.0: first-run onboarding screen for new users
// v2.4.0: email collection · deviceId storage bug fix · trial tier awareness

'use strict';

const MAX_CRITICAL = 4;
const tags = { roles:[], critical:[], primary:[], secondary:[], deal:[], avoid:[] };

const COMPLETENESS_FIELDS = [
  { key:'critical',  label:'Critical skills', pct:35, check:()=>tags.critical.length>0||tags.primary.length>0 },
  { key:'roles',     label:'Target roles',    pct:20, check:()=>tags.roles.length>0 },
  { key:'expYears',  label:'Experience',      pct:15, check:()=>parseInt(get('expYears'))>0 },
  { key:'workType',  label:'Work preference', pct:15, check:()=>['remote','hybrid','onsite'].some(t=>chk(`wt-${t}`)) },
  { key:'minSalary', label:'Salary',          pct:15, check:()=>parseInt(get('minSalary'))>0 },
];

document.addEventListener('DOMContentLoaded', async () => {
  setupAccordion();
  setupTagInputs();
  setupAutofill();

  const data = await load();
  if (data?.profile) applyProfile(data.profile);

  if (data?.email) {
    set('userEmail', data.email);
    showEmailSaved(true);
  }

  updateStatus();
  updateFooter();

  document.getElementById('saveBtn').addEventListener('click', save);
  document.querySelectorAll('input, select, textarea').forEach(el =>
    el.addEventListener('input', updateFooter)
  );

  setupUpgradeUI();
  initSubscriptionUI();
  setupTabs();
  loadTrackerTabCount();

  // ── First-run detection ─────────────────────────────────────────────────────
  // A new user has an empty profile: no skills, no roles, no current title,
  // no experience. The service worker sets DEFAULT_DATA on install so `data`
  // is not null — we detect "new" by checking for any meaningful profile content.
  // If they've partially filled the form in a previous session, we don't
  // interrupt them with the onboarding screen again.
  const isNewUser = !data?.profile?.currentTitle
    && !data?.profile?.mustHaveSkills?.length
    && !data?.profile?.primarySkills?.length
    && !data?.profile?.targetRoles?.length
    && !data?.profile?.experienceYears;

  if (isNewUser) showOnboarding();
});

// ── Onboarding ─────────────────────────────────────────────────────────────────
// Shown on first install. When dismissed the main content is revealed and the
// Profile accordion is opened so the user can start filling in their details.

function showOnboarding() {
  const onb  = document.getElementById('onboarding');
  const main = document.getElementById('mainContent');
  if (!onb || !main) return;

  onb.style.display  = 'flex';
  main.style.display = 'none';

  document.getElementById('onbStartBtn')?.addEventListener('click', dismissOnboarding);
  document.getElementById('onbSkipBtn')?.addEventListener('click',  dismissOnboarding);
}

function dismissOnboarding() {
  const onb  = document.getElementById('onboarding');
  const main = document.getElementById('mainContent');
  if (!onb || !main) return;

  onb.style.display  = 'none';
  main.style.display = 'contents'; // restores flex layout via CSS

  // Auto-open Profile accordion and focus the AI description field so the user
  // can start immediately — pasting their CV / LinkedIn bio is step 1.
  document.getElementById('acc-profile')?.classList.add('open');
  setTimeout(() => document.getElementById('desc')?.focus(), 100);
}

// ── Accordion ─────────────────────────────────────────────────────────────────
function setupAccordion() {
  document.querySelectorAll('.acc-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.acc-section').classList.toggle('open');
    });
  });
}

// ── Tag inputs ────────────────────────────────────────────────────────────────
function setupTagInputs() {
  [
    ['rolesInp',     'rolesTags',     'roles',    false, 0           ],
    ['criticalInp',  'criticalTags',  'critical', false, MAX_CRITICAL],
    ['primaryInp',   'primaryTags',   'primary',  false, 0           ],
    ['secondaryInp', 'secondaryTags', 'secondary',false, 0           ],
    ['dealInp',      'dealTags',      'deal',     true,  0           ],
    ['avoidInp',     'avoidTags',     'avoid',    true,  0           ],
  ].forEach(([inp, list, key, danger, max]) => {
    const inpEl = document.getElementById(inp);
    if (!inpEl) return;

    const box = inpEl.closest('.tagbox');
    box?.addEventListener('click', () => inpEl.focus());

    inpEl.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',') && inpEl.value.trim()) {
        e.preventDefault();
        const val = inpEl.value.trim().replace(/,$/,'').trim();
        if (!val || val.length > 80) return;
        if (max && tags[key].length >= max) return;
        if (!tags[key].includes(val)) {
          tags[key].push(val);
          renderTags(list, key, danger);
          updateFooter();
        }
        inpEl.value = '';
      }
      if (e.key === 'Backspace' && !inpEl.value && tags[key].length) {
        tags[key].pop();
        renderTags(list, key, danger);
        updateFooter();
      }
    });
  });
}

function renderTags(listId, key, danger) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  const isCrit = key === 'critical';

  tags[key].forEach((t, i) => {
    const tag = document.createElement('span');
    tag.className = `tag${isCrit ? ' tag--critical' : danger ? ' tag--danger' : ''}`;

    const txt = document.createTextNode(t);
    const rm  = document.createElement('button');
    rm.className = 'tag-rm';
    rm.innerHTML = '×';
    rm.setAttribute('aria-label', `Remove ${t}`);
    rm.addEventListener('click', () => { tags[key].splice(i,1); renderTags(listId,key,danger); updateFooter(); });

    tag.append(txt, rm);
    list.appendChild(tag);
  });

  const skillCount = tags.critical.length + tags.primary.length + tags.secondary.length;
  const sc = document.getElementById('skills-count');
  if (sc) sc.textContent = skillCount > 0 ? skillCount : '';
  const fc = document.getElementById('filters-count');
  if (fc) fc.textContent = (tags.deal.length + tags.avoid.length) > 0
    ? (tags.deal.length + tags.avoid.length) : '';
}

function renderAll() {
  renderTags('rolesTags',    'roles',    false);
  renderTags('criticalTags', 'critical', false);
  renderTags('primaryTags',  'primary',  false);
  renderTags('secondaryTags','secondary',false);
  renderTags('dealTags',     'deal',     true);
  renderTags('avoidTags',    'avoid',    true);
}

// ── Load / apply ──────────────────────────────────────────────────────────────
async function load() {
  return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift || null)));
}

function applyProfile(p) {
  set('desc',         p.description     || '');
  set('currentTitle', p.currentTitle    || '');
  set('expYears',     p.experienceYears || 0);
  set('minSalary',    p.minSalary > 0 ? p.minSalary : '');
  set('careerGoal',   p.careerGoal      || '');

  setChk('wt-remote', (p.workTypes||[]).includes('remote'));
  setChk('wt-hybrid', (p.workTypes||[]).includes('hybrid'));
  setChk('wt-onsite', (p.workTypes||[]).includes('onsite'));

  tags.roles     = [...(p.targetRoles    ||[])];
  tags.critical  = [...(p.mustHaveSkills ||[])];
  tags.primary   = [...(p.primarySkills  ||[])];
  tags.secondary = [...(p.secondarySkills||[])];
  tags.deal      = [...(p.dealBreakers   ||[])];
  tags.avoid     = [...(p.avoidIndustries||[])];
  renderAll();

  const af = document.getElementById('autoFillBtn');
  if (af) af.disabled = get('desc').length < 20;
}

// ── Save ──────────────────────────────────────────────────────────────────────
// CRITICAL FIX: reads existing storage first and spreads it before saving.
// The previous version did `chrome.storage.local.set({ jobsift: { profile } })`
// which silently dropped deviceId on every save, breaking AI scoring.
async function save() {
  const profile = {
    description:      get('desc'),
    currentTitle:     get('currentTitle'),
    experienceYears:  parseInt(get('expYears')) || 0,
    targetRoles:      [...tags.roles],
    mustHaveSkills:   [...tags.critical],
    primarySkills:    [...tags.primary],
    secondarySkills:  [...tags.secondary],
    workTypes:        ['remote','hybrid','onsite'].filter(t => chk(`wt-${t}`)),
    jobTypes:         ['full-time'],
    minSalary:        parseInt(get('minSalary')) || 0,
    dealBreakers:     [...tags.deal],
    avoidIndustries:  [...tags.avoid],
    careerGoal:       get('careerGoal'),
  };

  try {
    const existing = await load() || {};

    // Dirty-check: skip the write entirely if the profile hasn't changed.
    // Saving an identical profile triggers storage.onChanged in every open
    // LinkedIn/Indeed tab, which calls _clearScoreCache() and reprocessAll()
    // — re-scoring all visible jobs from scratch for no reason.
    if (JSON.stringify(existing.profile) === JSON.stringify(profile)) {
      return;
    }

    await chrome.storage.local.set({ jobsift: { ...existing, profile } });

    const toast = document.getElementById('saveToast');
    if (toast) {
      toast.classList.remove('save-toast--hidden');
      setTimeout(() => toast.classList.add('save-toast--hidden'), 3000);
    }
  } catch (e) {
    showMsg('afMsg', '⚠ Save failed', 'error');
    return;
  }

  // ── Email: send to backend if filled and not already stored ───────────────
  const emailVal = get('userEmail').toLowerCase();
  if (emailVal && emailVal.includes('@')) {
    const existing = await load() || {};
    if (emailVal !== existing.email) {
      chrome.runtime.sendMessage({ type: 'JS_SAVE_EMAIL', email: emailVal }, async (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.ok) {
          const current = await load() || {};
          await chrome.storage.local.set({ jobsift: { ...current, email: emailVal } });
          showEmailSaved(true);
        }
      });
    }
  }
}

// ── Email field helpers ────────────────────────────────────────────────────────
function showEmailSaved(visible) {
  const mark = document.getElementById('emailSavedMark');
  if (mark) mark.style.display = visible ? 'inline-flex' : 'none';
}

// ── Auto-fill ─────────────────────────────────────────────────────────────────
function setupAutofill() {
  const desc = document.getElementById('desc');
  const btn  = document.getElementById('autoFillBtn');
  desc?.addEventListener('input', () => { if(btn) btn.disabled = desc.value.trim().length < 20; });
  btn?.addEventListener('click', runAutofill);
}

async function runAutofill() {
  const text = get('desc').trim();
  if (text.length < 20) return;

  const btn   = document.getElementById('autoFillBtn');
  const label = document.getElementById('afLabel');
  btn.disabled = true;
  label.textContent = 'Extracting…';

  try {
    const res = await chrome.runtime.sendMessage({ type:'JS_PARSE_PROFILE', text });
    if (!res?.ok) throw new Error(res?.error || 'failed');
    applyParsed(res.result);
    label.textContent = '✓ Fields updated — review and save';
    showMsg('afMsg', '✓ Profile extracted from your description', 'success');
    setTimeout(() => { label.textContent = 'Auto-fill from description'; btn.disabled = false; }, 3500);
  } catch (err) {
    label.textContent = 'Auto-fill from description';
    btn.disabled = false;
    showMsg('afMsg', '⚠ Could not extract — try again or fill manually', 'error');
  }
}

function applyParsed(p) {
  if (!p) return;
  if (p.currentTitle)    set('currentTitle', p.currentTitle);
  if (p.experienceYears) set('expYears', p.experienceYears);
  if (p.minSalary > 0)   set('minSalary', p.minSalary);
  if (p.careerGoal)      set('careerGoal', p.careerGoal);
  if (p.workTypes?.length) {
    setChk('wt-remote', p.workTypes.includes('remote'));
    setChk('wt-hybrid', p.workTypes.includes('hybrid'));
    setChk('wt-onsite', p.workTypes.includes('onsite'));
  }
  if (p.targetRoles?.length) {
    tags.roles = [...p.targetRoles];
    renderTags('rolesTags','roles',false);
    document.getElementById('acc-profile')?.classList.add('open');
  }
  if (p.mustHaveSkills?.length) {
    tags.critical = [...p.mustHaveSkills.slice(0, MAX_CRITICAL)];
    renderTags('criticalTags','critical',false);
    document.getElementById('acc-skills')?.classList.add('open');
  }
  if (p.primarySkills?.length) {
    tags.primary = [...p.primarySkills];
    renderTags('primaryTags','primary',false);
    document.getElementById('acc-skills')?.classList.add('open');
  }
  if (p.secondarySkills?.length) {
    tags.secondary = [...p.secondarySkills];
    renderTags('secondaryTags','secondary',false);
  }
  if (p.dealBreakers?.length) {
    tags.deal = [...p.dealBreakers];
    renderTags('dealTags','deal',true);
    document.getElementById('acc-filters')?.classList.add('open');
  }
  updateFooter();
}

// ── Status pill ───────────────────────────────────────────────────────────────
function updateStatus() {
  const pill = document.getElementById('statusPill');
  if (!pill) return;
  chrome.tabs.query({ active:true, currentWindow:true }, tabs => {
    const url = tabs[0]?.url || '';
    const onLinkedIn = url.includes('linkedin.com/jobs');
    pill.textContent = onLinkedIn ? 'Scoring jobs…' : 'Open LinkedIn Jobs';
    pill.className   = `status-pill${onLinkedIn ? ' status-pill--active' : ''}`;
  });
}

// ── Footer — profile completeness ─────────────────────────────────────────────
function updateFooter() {
  const checks = COMPLETENESS_FIELDS;
  const done   = checks.filter(f => f.check()).length;
  const pct    = Math.round(done / checks.length * 100);

  const fill = document.getElementById('progressFill');
  const lbl  = document.getElementById('progressLbl');
  if (fill) fill.style.width = pct + '%';
  if (lbl) {
    if (pct === 100) {
      lbl.textContent = 'Profile complete ✓';
      lbl.className = 'progress-lbl progress-lbl--done';
    } else {
      lbl.textContent = `${pct}% complete`;
      lbl.className = 'progress-lbl';
    }
  }

  const guide = document.getElementById('completenessGuide');
  if (guide) {
    const missing = COMPLETENESS_FIELDS.filter(f => !f.check()).slice(0,3);
    if (missing.length === 0) { guide.innerHTML = ''; return; }
    const items = missing.map(f =>
      `<span class="guide-item"><span class="guide-field">${f.label}</span><span class="guide-pct">${f.pct}%</span></span>`
    ).join('');
    guide.innerHTML = `<span class="guide-prefix">Missing:</span>${items}`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function get(id)    { return document.getElementById(id)?.value?.trim() || ''; }
function set(id, v) { const el=document.getElementById(id); if(el) el.value=v; }
function chk(id)    { return document.getElementById(id)?.checked || false; }
function setChk(id,v){ const el=document.getElementById(id); if(el) el.checked=!!v; }

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `msg msg--${type}`;
  setTimeout(() => { el.className = 'msg msg--hidden'; el.textContent = ''; }, 5000);
}

// ── Subscription UI ───────────────────────────────────────────────────────────
async function loadSubscriptionStatus() {
  return new Promise(resolve => {
    chrome.storage.local.get('jobsift_sub', d => resolve(d.jobsift_sub || null));
  });
}

// Three sections controlled by tier:
//
//   upgradeSection       — shown for free tier (paywall on)
//   manageBillingSection — shown for pro tier
//   proBadge             — shown for pro and trial tiers
//   upgradeSection       — hidden for pro and trial
//
// When subscriptions are disabled globally (soft launch mode), none of these
// sections are shown — everyone has Pro access silently.
function updateSubscriptionUI(status) {
  const upgradeSection       = document.getElementById('upgradeSection');
  const manageBillingSection = document.getElementById('manageBillingSection');
  const proBadge             = document.getElementById('proBadge');

  if (!upgradeSection || !manageBillingSection || !proBadge) return;

  // Subscriptions disabled or no status cached → hide everything
  if (!status || !status.subscriptions_enabled) {
    upgradeSection.style.display       = 'none';
    manageBillingSection.style.display = 'none';
    proBadge.style.display             = 'none';
    return;
  }

  if (status.tier === 'pro') {
    upgradeSection.style.display       = 'none';
    manageBillingSection.style.display = 'flex';

    proBadge.className   = 'pro-badge';
    proBadge.textContent = 'Pro';
    proBadge.style.display = 'inline-flex';
    return;
  }

  if (status.tier === 'trial') {
    upgradeSection.style.display       = 'none';
    manageBillingSection.style.display = 'none';

    const days = status.trial_days_left != null ? status.trial_days_left : 7;
    const ring = `<span class="badge-ring"><span class="badge-ring-dot"></span></span>`;

    if (days <= 1) {
      proBadge.className = 'pro-badge pro-badge--trial pro-badge--trial-warn pro-badge--trial-urgent';
      proBadge.innerHTML = `${ring}<span class="badge-text"><strong>Last</strong> day of trial</span>`;
    } else if (days <= 3) {
      proBadge.className = 'pro-badge pro-badge--trial pro-badge--trial-warn';
      proBadge.innerHTML = `${ring}<span class="badge-text">Trial <strong>${days}</strong>d left</span>`;
    } else {
      proBadge.className = 'pro-badge pro-badge--trial';
      proBadge.innerHTML = `${ring}<span class="badge-text">Trial <strong>${days}</strong>d left</span>`;
    }

    proBadge.style.display = 'inline-flex';
    return;
  }

  // Free tier — show upgrade section
  upgradeSection.style.display       = 'flex';
  manageBillingSection.style.display = 'none';
  proBadge.style.display             = 'none';
}

async function initSubscriptionUI() {
  const cached = await loadSubscriptionStatus();
  updateSubscriptionUI(cached);

  chrome.runtime.sendMessage({ type: 'JS_REFRESH_SUB_STATUS' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.data) updateSubscriptionUI(res.data);
  });
}

function setupUpgradeUI() {
  const upgradeBtn    = document.getElementById('upgradeBtn');
  const restoreToggle = document.getElementById('restoreToggleBtn');
  const restoreForm   = document.getElementById('restoreForm');
  const restoreBtn    = document.getElementById('restoreBtn');
  const restoreEmail  = document.getElementById('restoreEmail');

  upgradeBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE' });
  });

  restoreToggle?.addEventListener('click', () => {
    if (!restoreForm) return;
    const isVisible = restoreForm.style.display !== 'none';
    restoreForm.style.display = isVisible ? 'none' : 'block';
    if (restoreToggle) {
      restoreToggle.textContent = isVisible
        ? 'Already subscribed? Restore access'
        : 'Hide restore form';
    }
  });

  restoreBtn?.addEventListener('click', async () => {
    const email = restoreEmail?.value.trim();
    if (!email || !email.includes('@')) {
      showMsg('restoreMsg', 'Enter a valid email address.', 'error');
      return;
    }

    if (restoreBtn) { restoreBtn.disabled = true; restoreBtn.textContent = 'Restoring…'; }

    chrome.runtime.sendMessage({ type: 'JS_RESTORE_SUBSCRIPTION', email }, (res) => {
      if (chrome.runtime.lastError || !res) {
        showMsg('restoreMsg', 'Service unavailable — try again shortly.', 'error');
        if (restoreBtn) { restoreBtn.disabled = false; restoreBtn.textContent = 'Restore'; }
        return;
      }

      if (res.ok) {
        showMsg('restoreMsg', '✓ Subscription restored successfully!', 'success');
        updateSubscriptionUI(res.status);
        if (restoreForm) restoreForm.style.display = 'none';
        if (restoreToggle) restoreToggle.textContent = 'Already subscribed? Restore access';
      } else {
        showMsg('restoreMsg', res.message || 'No active subscription found for this email.', 'error');
      }

      if (restoreBtn) { restoreBtn.disabled = false; restoreBtn.textContent = 'Restore'; }
    });
  });
}

// ── Job Tracker ────────────────────────────────────────────────────────────────
// All tracker state lives in chrome.storage.local under 'jobsift_tracker'.
// popup.js reads/writes storage directly — no content script bridge needed
// since the popup runs in its own isolated extension page context.

const TRACKER_KEY    = 'jobsift_tracker';
let   _trackerFilter = 'all';

// ── Storage helpers ────────────────────────────────────────────────────────────
function loadTrackerData() {
  return new Promise(r =>
    chrome.storage.local.get(TRACKER_KEY, d => r(d[TRACKER_KEY] || {}))
  );
}

function saveTrackerData(data) {
  return new Promise(r =>
    chrome.storage.local.set({ [TRACKER_KEY]: data }, r)
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────────
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      tabBtns.forEach(b => {
        b.classList.remove('tab-btn--active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('tab-btn--active');
      btn.setAttribute('aria-selected', 'true');

      const tab         = btn.dataset.tab;
      const mainContent = document.getElementById('mainContent');
      const onboarding  = document.getElementById('onboarding');
      const trackerPane = document.getElementById('trackerPane');

      if (tab === 'tracker') {
        if (mainContent) mainContent.style.display = 'none';
        if (onboarding && onboarding.style.display !== 'none') onboarding.style.display = 'none';
        if (trackerPane) trackerPane.style.display = 'flex';
        await renderTracker();
      } else {
        if (trackerPane) trackerPane.style.display = 'none';
        // Restore whichever view was active before
        const wasOnboarding = document.getElementById('onboarding')?.dataset.wasActive === 'true';
        if (mainContent) mainContent.style.display = 'contents';
      }
    });
  });

  // Filter pill clicks
  document.getElementById('tkFilters')?.addEventListener('click', async e => {
    const btn = e.target.closest('.tk-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.tk-filter-btn').forEach(b => b.classList.remove('tk-filter--active'));
    btn.classList.add('tk-filter--active');
    _trackerFilter = btn.dataset.filter;
    await renderTracker();
  });

  // Close portal dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#tk-dropdown-portal') && !e.target.closest('.tk-status-pill')) {
      closePortalDropdown();
    }
  });
}

// ── Portal dropdown ────────────────────────────────────────────────────────────
// Rendered at document.body with position:fixed — escapes both overflow:hidden
// on .tk-card and overflow-y:auto on .tk-list which would clip inline dropdowns.

let _portalJobId     = null;
let _portalCurStatus = null;

function getOrCreatePortalDropdown() {
  let dd = document.getElementById('tk-dropdown-portal');
  if (!dd) {
    dd = document.createElement('div');
    dd.id        = 'tk-dropdown-portal';
    dd.className = 'tk-status-dropdown';
    dd.style.cssText = 'display:none; position:fixed; z-index:9999;';
    document.body.appendChild(dd);

    // Delegated listener — one handler for all option clicks
    dd.addEventListener('click', async e => {
      const opt = e.target.closest('.tk-status-opt');
      if (!opt) return;
      const newStatus = opt.dataset.value;
      const jobId     = _portalJobId;
      closePortalDropdown();
      if (!jobId || !newStatus) return;
      const data = await loadTrackerData();
      if (data[jobId]) {
        data[jobId].status    = newStatus;
        data[jobId].updatedAt = Date.now();
        await saveTrackerData(data);
      }
      await renderTracker();
    });
  }
  return dd;
}

function openPortalDropdown(pill, jobId, currentStatus) {
  const dd = getOrCreatePortalDropdown();

  // Toggle: click same pill again to close
  if (_portalJobId === jobId && dd.style.display !== 'none') {
    closePortalDropdown();
    return;
  }

  _portalJobId     = jobId;
  _portalCurStatus = currentStatus;

  // Populate with all statuses except the current one
  dd.innerHTML = Object.entries(STATUS_META)
    .filter(([val]) => val !== currentStatus)
    .map(([val, m]) =>
      `<button class="tk-status-opt" data-value="${val}" type="button">
         ${m.icon} ${m.label}
       </button>`
    ).join('');

  // Position below (or above if near the bottom of the viewport)
  const rect        = pill.getBoundingClientRect();
  dd.style.left     = `${Math.round(rect.left)}px`;
  dd.style.minWidth = `${Math.round(rect.width)}px`;

  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 150) {
    dd.style.top    = 'auto';
    dd.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
  } else {
    dd.style.bottom = 'auto';
    dd.style.top    = `${Math.round(rect.bottom + 4)}px`;
  }

  dd.style.display = 'block';
}

function closePortalDropdown() {
  const dd = document.getElementById('tk-dropdown-portal');
  if (dd) dd.style.display = 'none';
  _portalJobId     = null;
  _portalCurStatus = null;
}

// ── Tracker count in tab label ─────────────────────────────────────────────────
async function loadTrackerTabCount() {
  const data    = await loadTrackerData();
  const count   = Object.keys(data).length;
  const countEl = document.getElementById('trackerTabCount');
  if (countEl) countEl.textContent = count > 0 ? count : '';
}

// ── Main render ────────────────────────────────────────────────────────────────
async function renderTracker() {
  const data    = await loadTrackerData();
  const entries = Object.values(data).sort((a, b) => b.savedAt - a.savedAt);

  // Counts per status
  const counts = { all: entries.length, saved: 0, applied: 0, interview: 0, rejected: 0 };
  entries.forEach(e => { if (counts[e.status] !== undefined) counts[e.status]++; });

  // Update filter pill counts
  ['all','saved','applied','interview','rejected'].forEach(k => {
    const el = document.getElementById(`tkc-${k}`);
    if (el) el.textContent = counts[k];
  });

  // Update tab badge
  const tabCount = document.getElementById('trackerTabCount');
  if (tabCount) tabCount.textContent = counts.all > 0 ? counts.all : '';

  // Filter
  const filtered = _trackerFilter === 'all'
    ? entries
    : entries.filter(e => e.status === _trackerFilter);

  const list = document.getElementById('tkList');
  if (!list) return;

  if (filtered.length === 0) {
    list.innerHTML = _emptyStateHTML(counts.all === 0);
    return;
  }

  list.innerHTML = '';
  filtered.forEach(entry => list.appendChild(buildTrackerCard(entry)));
}

// ── Card builder ───────────────────────────────────────────────────────────────
const STATUS_META = {
  saved:     { label: 'Saved',     icon: '📌', cls: 'tk-status--saved'     },
  applied:   { label: 'Applied',   icon: '📤', cls: 'tk-status--applied'   },
  interview: { label: 'Interview', icon: '🎯', cls: 'tk-status--interview' },
  rejected:  { label: 'Rejected',  icon: '✕',  cls: 'tk-status--rejected'  },
};

function buildTrackerCard(entry) {
  const card = document.createElement('div');
  card.className = 'tk-card';
  card.dataset.jobId = entry.jobId;

  const meta      = STATUS_META[entry.status] || STATUS_META.saved;
  const hasScore  = entry.score !== null && entry.score !== undefined;
  const scoreText = hasScore ? `${entry.score}%` : '—';
  const platform  = entry.platform === 'indeed'
    ? `<span class="tk-platform tk-platform--indeed">IN</span>`
    : `<span class="tk-platform tk-platform--linkedin">Li</span>`;

  card.innerHTML = `
    <div class="tk-card-top">
      <span class="tk-score-dot tk-score-dot--${entry.label}">${scoreText}</span>
      <div class="tk-card-info">
        <div class="tk-card-title">${_esc(entry.title)}</div>
        <div class="tk-card-meta">
          ${platform}
          ${_esc(entry.company)}${entry.location ? ' · ' + _esc(entry.location) : ''}
          <span class="tk-card-time">· ${_timeAgo(entry.savedAt)}</span>
        </div>
      </div>
      <div class="tk-card-actions">
        ${entry.url
          ? `<a class="tk-icon-btn" href="${entry.url}" target="_blank"
               rel="noopener" title="Open original posting" tabindex="0">↗</a>`
          : ''}
        <button class="tk-icon-btn tk-delete-btn" title="Remove" type="button">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M3 4h10M6 4V2h4v2M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="tk-card-bottom">
      <div class="tk-status-wrap">
        <button class="tk-status-pill ${meta.cls}" type="button">
          ${meta.icon} ${meta.label} <span class="tk-chevron">▾</span>
        </button>
      </div>
    </div>`;

  // Status pill → opens portal dropdown (position:fixed, appended to body)
  const pill = card.querySelector('.tk-status-pill');
  pill.addEventListener('click', e => {
    e.stopPropagation();
    openPortalDropdown(pill, entry.jobId, entry.status);
  });

  // Delete — inline confirmation
  card.querySelector('.tk-delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    closePortalDropdown();
    showDeleteConfirm(card, entry.jobId);
  });

  return card;
}

// ── Inline delete confirmation ─────────────────────────────────────────────────
function showDeleteConfirm(card, jobId) {
  const savedHTML = card.innerHTML;

  card.innerHTML = `
    <div class="tk-confirm">
      <span class="tk-confirm-msg">Remove this job from your tracker?</span>
      <div class="tk-confirm-btns">
        <button class="tk-confirm-yes" type="button">Remove</button>
        <button class="tk-confirm-no"  type="button">Cancel</button>
      </div>
    </div>`;

  card.querySelector('.tk-confirm-yes').addEventListener('click', async () => {
    card.classList.add('tk-card--removing');
    const data = await loadTrackerData();
    delete data[jobId];
    await saveTrackerData(data);
    setTimeout(async () => {
      card.remove();
      await renderTracker();
    }, 220);
  });

  card.querySelector('.tk-confirm-no').addEventListener('click', async () => {
    card.innerHTML = savedHTML;
    await renderTracker(); // easiest way to restore all event listeners
  });
}

// ── Empty state ────────────────────────────────────────────────────────────────
function _emptyStateHTML(noJobsAtAll) {
  return `
    <div class="tk-empty">
      <div class="tk-empty-icon">📋</div>
      <div class="tk-empty-title">
        ${noJobsAtAll ? 'No jobs tracked yet' : 'No jobs in this stage'}
      </div>
      <div class="tk-empty-sub">
        ${noJobsAtAll
          ? 'Score jobs on LinkedIn or Indeed, then click <strong>Save</strong> in the analysis panel.'
          : 'Change the filter above to see jobs in other stages.'}
      </div>
      ${noJobsAtAll ? `
        <a class="tk-empty-cta" href="https://www.linkedin.com/jobs/" target="_blank" rel="noopener">
          Go to LinkedIn Jobs →
        </a>` : ''}
    </div>`;
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function _timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)                  return 'just now';
  if (s < 3600)                return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)               return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30)          return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365)         return `${Math.floor(s / (86400 * 30))}mo ago`;
  return `${Math.floor(s / (86400 * 365))}yr ago`;
}

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}