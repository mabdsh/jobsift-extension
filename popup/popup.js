// JobSift Popup v2.4.0
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

  // Pre-fill email field if the user saved one previously.
  // Email is stored in the same jobsift storage object alongside the profile.
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
});

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
// IMPORTANT: reads existing storage first and spreads it before saving.
// The previous version only saved { profile } which silently dropped deviceId
// and any other stored fields, breaking AI scoring after every profile save.
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
    // Read existing stored data so we preserve deviceId, email, and any other
    // fields that live alongside the profile in chrome.storage.local.
    const existing = await load() || {};
    await chrome.storage.local.set({ jobsift: { ...existing, profile } });

    const toast = document.getElementById('saveToast');
    if (toast) {
      toast.classList.remove('save-toast--hidden');
      setTimeout(() => toast.classList.add('save-toast--hidden'), 3000);
    }
  } catch (e) {
    showMsg('afMsg', '⚠ Save failed', 'error');
    return; // don't attempt email save if profile save failed
  }

  // ── Email: send to backend if filled and different from what's stored ───────
  // Runs after profile save so a failed email save doesn't block the profile.
  const emailVal = get('userEmail').toLowerCase();
  if (emailVal && emailVal.includes('@')) {
    const existing = await load() || {};
    if (emailVal !== existing.email) {
      chrome.runtime.sendMessage({ type: 'JS_SAVE_EMAIL', email: emailVal }, async (res) => {
        if (chrome.runtime.lastError) return; // service worker not ready — will retry on next save
        if (res?.ok) {
          // Merge email into local storage alongside the profile
          const current = await load() || {};
          await chrome.storage.local.set({ jobsift: { ...current, email: emailVal } });
          showEmailSaved(true);
        }
        // On failure we silently do nothing — the email field still shows the
        // value the user typed, so they can try again on the next save.
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
  if (p.primarySkills?.length)  { tags.primary   = [...p.primarySkills];   renderTags('primaryTags','primary',false); }
  if (p.secondarySkills?.length){ tags.secondary = [...p.secondarySkills];  renderTags('secondaryTags','secondary',false); }
  if (p.dealBreakers?.length)   { tags.deal      = [...p.dealBreakers];     renderTags('dealTags','deal',true); }
  if (p.avoidIndustries?.length){ tags.avoid     = [...p.avoidIndustries];  renderTags('avoidTags','avoid',true); }
  updateFooter();
}

// ── Status pill ───────────────────────────────────────────────────────────────
async function updateStatus() {
  const pill = document.getElementById('statusPill');
  if (!pill) return;
  try {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    const url = tab?.url || '';
    const on  = url.includes('linkedin.com/jobs') || url.includes('linkedin.com/search/results/jobs');
    pill.textContent = on ? '● Active on Jobs' : 'Open LinkedIn Jobs';
    pill.classList.toggle('status-pill--on', on);
  } catch (_) {
    pill.textContent = 'Open LinkedIn Jobs';
  }
}

// ── Footer progress ───────────────────────────────────────────────────────────
function updateFooter() {
  const af = document.getElementById('autoFillBtn');
  if (af) af.disabled = get('desc').trim().length < 20;

  const checks = [
    get('desc').length > 20,
    get('currentTitle').length > 0,
    parseInt(get('expYears')) > 0,
    tags.roles.length > 0,
    tags.critical.length > 0 || tags.primary.length > 0,
    ['remote','hybrid','onsite'].some(t=>chk(`wt-${t}`)),
    parseInt(get('minSalary')) > 0,
  ];
  const done = checks.filter(Boolean).length;
  const pct  = Math.round(done / checks.length * 100);

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

// Handles four tiers:
//   disabled → paywall off, show nothing
//   pro      → blue "PRO" badge, no upgrade banner
//   trial    → amber "TRIAL · Xd" badge, no upgrade banner (full access)
//   free     → no badge, show upgrade banner
function updateSubscriptionUI(status) {
  const upgradeSection = document.getElementById('upgradeSection');
  const proBadge       = document.getElementById('proBadge');
  if (!upgradeSection || !proBadge) return;

  if (!status || !status.subscriptions_enabled) {
    upgradeSection.style.display = 'none';
    proBadge.style.display       = 'none';
    return;
  }

  if (status.tier === 'pro') {
    upgradeSection.style.display = 'none';
    proBadge.textContent         = 'PRO';
    proBadge.className           = 'pro-badge';
    proBadge.style.display       = 'inline-flex';
    return;
  }

  if (status.tier === 'trial') {
    upgradeSection.style.display = 'none';
    const days                   = status.trial_days_left != null ? status.trial_days_left : '?';
    proBadge.textContent         = `TRIAL · ${days}d`;
    proBadge.className           = 'pro-badge pro-badge--trial';
    proBadge.style.display       = 'inline-flex';
    return;
  }

  // Free user with paywall active
  upgradeSection.style.display = 'flex';
  proBadge.style.display       = 'none';
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
