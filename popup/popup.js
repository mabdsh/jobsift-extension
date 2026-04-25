// JobSift Popup v2.2.1

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

  updateStatus();
  updateFooter();

  document.getElementById('saveBtn').addEventListener('click', save);
  document.querySelectorAll('input, select, textarea').forEach(el =>
    el.addEventListener('input', updateFooter)
  );
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

  // Tab badge counts
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
  return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift||null)));
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
    await chrome.storage.local.set({ jobsift: { profile } });
    const toast = document.getElementById('saveToast');
    if (toast) { toast.classList.remove('save-toast--hidden'); setTimeout(() => toast.classList.add('save-toast--hidden'), 3000); }
  } catch (e) {
    showMsg('afMsg', '⚠ Save failed', 'error');
  }
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
    showMsg('afMsg', 'Service temporarily unavailable — try again shortly', 'error');
    btn.disabled = false;
  }
}

function applyParsed(p) {
  if (!p) return;
  if (p.currentTitle)    { flash('currentTitle'); set('currentTitle', p.currentTitle); }
  if (p.experienceYears) { flash('expYears');     set('expYears', p.experienceYears); }
  if (p.minSalary > 0)   { flash('minSalary');    set('minSalary', p.minSalary); }
  if (p.careerGoal)      { flash('careerGoal');   set('careerGoal', p.careerGoal); }
  if (p.workTypes?.length)     { ['remote','hybrid','onsite'].forEach(t=>setChk(`wt-${t}`,p.workTypes.includes(t))); }
  if (p.targetRoles?.length)   { tags.roles    = [...p.targetRoles];   renderTags('rolesTags','roles',false); }
  if (p.mustHaveSkills?.length){ tags.critical = [...p.mustHaveSkills.slice(0,MAX_CRITICAL)]; renderTags('criticalTags','critical',false);
    document.getElementById('acc-skills')?.classList.add('open');
  }
  if (p.primarySkills?.length)  { tags.primary  = [...p.primarySkills];  renderTags('primaryTags','primary',false); }
  if (p.secondarySkills?.length){ tags.secondary= [...p.secondarySkills]; renderTags('secondaryTags','secondary',false); }
  if (p.dealBreakers?.length)   { tags.deal     = [...p.dealBreakers];   renderTags('dealTags','deal',true); }
  if (p.avoidIndustries?.length){ tags.avoid    = [...p.avoidIndustries];renderTags('avoidTags','avoid',true); }
  updateFooter();
}

// ── Status pill ───────────────────────────────────────────────────────────────
// Fix #11: catch block previously did nothing, leaving the pill in its default
// "Not on Jobs" text permanently even when the real cause was a permissions
// error or the tab query failing. Now it shows a neutral fallback so the user
// can at least see the pill reached a resolved state.
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

// ── Footer progress + completeness guide ──────────────────────────────────────
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

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1100);
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `msg msg--${type}`;
  setTimeout(() => { el.className = 'msg msg--hidden'; el.textContent = ''; }, 5000);
}