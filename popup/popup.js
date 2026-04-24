// JobSift Popup v2.0.0

'use strict';

const MAX_TAG      = 80;
const MAX_CRITICAL = 4;

const tags = { roles:[], critical:[], primary:[], secondary:[], deal:[], avoid:[] };

// ── Completeness guidance: field → impact on score ────────────────────────
const COMPLETENESS_FIELDS = [
  { key:'critical',    label:'Critical skills',  pct:35, check:()=>tags.critical.length>0 },
  { key:'primary',     label:'Primary skills',   pct:35, check:()=>tags.primary.length>0  },
  { key:'roles',       label:'Target roles',     pct:20, check:()=>tags.roles.length>0    },
  { key:'expYears',    label:'Experience level', pct:15, check:()=>parseInt(getVal('expYears'))>0 },
  { key:'workType',    label:'Work preference',  pct:15, check:()=>['remote','hybrid','onsite'].some(t=>isChk(`wt-${t}`)) },
  { key:'minSalary',   label:'Minimum salary',   pct:15, check:()=>parseInt(getVal('minSalary'))>0 },
];

document.addEventListener('DOMContentLoaded', async () => {
  setupSegments();
  setupTagInputs();
  setupAutofill();

  const data = await loadData();
  if (data?.profile) applyProfileToUI(data.profile);

  updateStatusPill();
  updateProgress();

  document.getElementById('saveBtn').addEventListener('click', saveProfile);

  document.querySelectorAll('input, select, textarea').forEach(el =>
    el.addEventListener('input', updateProgress)
  );
});

// ── Segments ──────────────────────────────────────────────────────────────
function setupSegments() {
  document.querySelectorAll('.seg-hdr').forEach(btn => {
    btn.addEventListener('click', () => {
      const segId  = btn.dataset.seg;
      const suffix = segId.replace('seg-', '');
      const body   = document.getElementById(`body-${suffix}`);
      const chev   = document.getElementById(`chev-${suffix}`);
      const isOpen = !body.classList.contains('seg-body--closed');
      body.classList.toggle('seg-body--closed', isOpen);
      if (chev) chev.textContent = isOpen ? '▸' : '▾';
    });
  });
}

function openSeg(suffix) {
  const body = document.getElementById(`body-${suffix}`);
  const chev = document.getElementById(`chev-${suffix}`);
  if (body) body.classList.remove('seg-body--closed');
  if (chev) chev.textContent = '▾';
}

// ── Tag inputs ────────────────────────────────────────────────────────────
function setupTagInputs() {
  [
    ['rolesInp',    'rolesBox',    'rolesTags',    'roles',    false, 0        ],
    ['criticalInp', 'criticalBox', 'criticalTags', 'critical', false, MAX_CRITICAL],
    ['primaryInp',  'primaryBox',  'primaryTags',  'primary',  false, 0        ],
    ['secondaryInp','secondaryBox','secondaryTags','secondary',false, 0        ],
    ['dealInp',     'dealBox',     'dealTags',     'deal',     true,  0        ],
    ['avoidInp',    'avoidBox',    'avoidTags',    'avoid',    true,  0        ],
  ].forEach(([inp, box, list, key, danger, max]) => setupTagInput(inp, box, list, key, danger, max));
}

function setupTagInput(inpId, boxId, listId, key, danger, maxCount) {
  const inp = document.getElementById(inpId);
  const box = document.getElementById(boxId);
  if (!inp || !box) return;

  box.addEventListener('click', () => inp.focus());

  inp.addEventListener('keydown', e => {
    if ((e.key==='Enter'||e.key===',') && inp.value.trim()) {
      e.preventDefault();
      const val = inp.value.trim().replace(/,$/,'').trim();
      if (!val || val.length > MAX_TAG) return;
      if (maxCount && tags[key].length >= maxCount) return;
      if (!tags[key].includes(val)) {
        tags[key].push(val);
        renderTags(listId, key, danger);
        updateProgress();
      }
      inp.value = '';
    }
    if (e.key==='Backspace' && !inp.value && tags[key].length) {
      tags[key].pop();
      renderTags(listId, key, danger);
      updateProgress();
    }
  });
}

function renderTags(listId, key, danger) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  const isCritical = key === 'critical';

  tags[key].forEach((t, i) => {
    const tag = document.createElement('span');
    tag.className = `tag${danger ? ' tag--danger' : isCritical ? ' tag--critical' : ''}`;
    if (isCritical) tag.title = 'Critical skill — score tanks if absent from job';
    tag.appendChild(document.createTextNode(t));
    const rm = document.createElement('button');
    rm.className = 'tag-rm';
    rm.innerHTML = '&times;';
    rm.setAttribute('aria-label', `Remove ${t}`);
    rm.addEventListener('click', () => {
      tags[key].splice(i, 1);
      renderTags(listId, key, danger);
      updateProgress();
    });
    tag.appendChild(rm);
    list.appendChild(tag);
  });

  // Skills count badge
  if (['critical','primary','secondary'].includes(key)) {
    const total = tags.critical.length + tags.primary.length + tags.secondary.length;
    const el = document.getElementById('skills-count');
    if (el) el.textContent = total > 0 ? `${total}` : '';
    const dot = document.getElementById('dot-skills');
    if (dot) {
      dot.className = tags.critical.length > 0
        ? 'seg-dot seg-dot--critical'
        : tags.primary.length > 0 ? 'seg-dot seg-dot--blue' : 'seg-dot';
    }
  }
}

function renderAllTags() {
  renderTags('rolesTags',    'roles',    false);
  renderTags('criticalTags', 'critical', false);
  renderTags('primaryTags',  'primary',  false);
  renderTags('secondaryTags','secondary',false);
  renderTags('dealTags',     'deal',     true);
  renderTags('avoidTags',    'avoid',    true);
}

// ── Load / apply ──────────────────────────────────────────────────────────
async function loadData() {
  return new Promise(r => chrome.storage.local.get('jobsift', d => r(d.jobsift||null)));
}

function applyProfileToUI(p) {
  setVal('desc',         p.description     || '');
  setVal('currentTitle', p.currentTitle    || '');
  setVal('expYears',     p.experienceYears || 0);
  setVal('minSalary',    p.minSalary > 0 ? p.minSalary : '');
  setVal('careerGoal',   p.careerGoal      || '');

  setChk('wt-remote',   (p.workTypes||[]).includes('remote'));
  setChk('wt-hybrid',   (p.workTypes||[]).includes('hybrid'));
  setChk('wt-onsite',   (p.workTypes||[]).includes('onsite'));
  setChk('jt-full',     (p.jobTypes||[]).includes('full-time'));
  setChk('jt-contract', (p.jobTypes||[]).includes('contract'));
  setChk('jt-part',     (p.jobTypes||[]).includes('part-time'));

  tags.roles     = [...(p.targetRoles     || [])];
  tags.critical  = [...(p.mustHaveSkills  || [])];
  tags.primary   = [...(p.primarySkills   || [])];
  tags.secondary = [...(p.secondarySkills || [])];
  tags.deal      = [...(p.dealBreakers    || [])];
  tags.avoid     = [...(p.avoidIndustries || [])];
  renderAllTags();

  const af = document.getElementById('autoFillBtn');
  if (af) af.disabled = getVal('desc').length < 20;

  if (p.description)                             openSeg('about');
  if (p.currentTitle || tags.roles.length)       openSeg('bg');
  if (tags.critical.length || tags.primary.length) openSeg('skills');
  if (p.workTypes?.length || p.minSalary)        openSeg('prefs');
  if (tags.deal.length || tags.avoid.length)     openSeg('filters');
}

// ── Save ──────────────────────────────────────────────────────────────────
async function saveProfile() {
  const profile = {
    description:      getVal('desc'),
    currentTitle:     getVal('currentTitle'),
    experienceYears:  parseInt(getVal('expYears')) || 0,
    targetRoles:      [...tags.roles],
    mustHaveSkills:   [...tags.critical],
    primarySkills:    [...tags.primary],
    secondarySkills:  [...tags.secondary],
    workTypes:        ['remote','hybrid','onsite'].filter(t => isChk(`wt-${t}`)),
    jobTypes:         [['full','full-time'],['contract','contract'],['part','part-time']]
                        .filter(([id]) => isChk(`jt-${id}`)).map(([,v])=>v),
    minSalary:        parseInt(getVal('minSalary')) || 0,
    dealBreakers:     [...tags.deal],
    avoidIndustries:  [...tags.avoid],
    careerGoal:       getVal('careerGoal'),
  };

  const ok = await storageSet({ jobsift: { profile } });
  if (ok) {
    const toast = document.getElementById('saveToast');
    if (toast) { toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'), 3000); }
  } else {
    showMsg('afMsg', '⚠ Save failed — try removing some tags', 'error');
  }
}

// ── Autofill ─────────────────────────────────────────────────────────────
function setupAutofill() {
  const desc = document.getElementById('desc');
  const btn  = document.getElementById('autoFillBtn');
  desc?.addEventListener('input', () => { if (btn) btn.disabled = desc.value.trim().length < 20; });
  btn?.addEventListener('click', runAutofill);
}

async function runAutofill() {
  const text = getVal('desc').trim();
  if (text.length < 20) return;

  const btn   = document.getElementById('autoFillBtn');
  const icon  = document.getElementById('afIcon');
  const label = document.getElementById('afLabel');

  btn.disabled = true;
  icon.textContent  = '⏳';
  label.textContent = 'Extracting…';

  try {
    const res = await chrome.runtime.sendMessage({ type:'JS_PARSE_PROFILE', text });
    if (!res?.ok) throw new Error(res?.error || 'Parse failed');
    applyParsed(res.result);
    icon.textContent  = '✓';
    label.textContent = 'Fields updated — review and save';
    showMsg('afMsg', '✓ Profile extracted — review each section then save', 'success');
    setTimeout(() => { icon.textContent='✨'; label.textContent='Auto-fill from description'; btn.disabled=false; }, 3500);
  } catch (err) {
    const noKey = err.message?.includes('NO_API_KEY') || err.message?.includes('INVALID_KEY');
    icon.textContent  = '✗';
    label.textContent = 'Failed — try again';
    showMsg('afMsg',
      noKey ? 'Add your Groq API key in AI Settings to enable auto-fill' : 'Extraction failed — add more detail to your description',
      'error');
    setTimeout(() => { icon.textContent='✨'; label.textContent='Auto-fill from description'; btn.disabled=false; }, 4000);
  }
}

function applyParsed(p) {
  if (!p) return;
  if (p.currentTitle)    { flash('currentTitle'); setVal('currentTitle', p.currentTitle); }
  if (p.experienceYears) { flash('expYears');     setVal('expYears', p.experienceYears); }
  if (p.minSalary > 0)   { flash('minSalary');    setVal('minSalary', p.minSalary); }
  if (p.careerGoal)      { flash('careerGoal');   setVal('careerGoal', p.careerGoal); }

  if (p.workTypes?.length)  { ['remote','hybrid','onsite'].forEach(t=>setChk(`wt-${t}`,p.workTypes.includes(t))); }
  if (p.jobTypes?.length)   { setChk('jt-full',p.jobTypes.includes('full-time')); setChk('jt-contract',p.jobTypes.includes('contract')); setChk('jt-part',p.jobTypes.includes('part-time')); }
  if (p.targetRoles?.length)    { tags.roles    = [...p.targetRoles];    renderTags('rolesTags','roles',false);    openSeg('bg'); }
  if (p.mustHaveSkills?.length) { tags.critical = [...p.mustHaveSkills.slice(0,MAX_CRITICAL)]; renderTags('criticalTags','critical',false); openSeg('skills'); }
  if (p.primarySkills?.length)  { tags.primary  = [...p.primarySkills];  renderTags('primaryTags','primary',false); openSeg('skills'); }
  if (p.secondarySkills?.length){ tags.secondary= [...p.secondarySkills]; renderTags('secondaryTags','secondary',false); }
  if (p.dealBreakers?.length)   { tags.deal     = [...p.dealBreakers];   renderTags('dealTags','deal',true);        openSeg('filters'); }
  if (p.avoidIndustries?.length){ tags.avoid    = [...p.avoidIndustries];renderTags('avoidTags','avoid',true); }
  if (p.workTypes?.length || p.minSalary) openSeg('prefs');
  updateProgress();
}


// ── Status pill ───────────────────────────────────────────────────────────
async function updateStatusPill() {
  try {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    const url = tab?.url || '';
    const on  = url.includes('linkedin.com/jobs') || url.includes('linkedin.com/search/results/jobs');
    const pill = document.getElementById('statusPill');
    if (!pill) return;
    pill.textContent = on ? '● Active on Jobs' : 'Open LinkedIn Jobs';
    pill.className   = `status-pill status-pill--${on?'active':'idle'}`;
  } catch (_) {}
}

// ── Progress + completeness guidance ─────────────────────────────────────
function updateProgress() {
  const af = document.getElementById('autoFillBtn');
  if (af) af.disabled = getVal('desc').trim().length < 20;

  const checks = [
    getVal('desc').length > 30,
    getVal('currentTitle').length > 0,
    parseInt(getVal('expYears')) > 0,
    tags.roles.length > 0,
    tags.critical.length > 0 || tags.primary.length > 0,
    ['remote','hybrid','onsite'].some(t=>isChk(`wt-${t}`)),
    parseInt(getVal('minSalary')) > 0,
  ];

  const done = checks.filter(Boolean).length;
  const pct  = Math.round((done / checks.length) * 100);
  const fill = document.getElementById('progressFill');
  const lbl  = document.getElementById('progressLbl');
  if (fill) fill.style.width = pct + '%';
  if (lbl) {
    lbl.textContent = pct === 100
      ? 'Profile complete ✓ — all scoring criteria active'
      : `${pct}% complete`;
    lbl.style.color = pct===100 ? '#16a34a' : pct>=60 ? '#d97706' : '';
  }

  // Completeness guidance: list what's missing + its scoring impact
  const guide  = document.getElementById('completenessGuide');
  if (guide) {
    const missing = COMPLETENESS_FIELDS.filter(f => !f.check());
    if (missing.length === 0 || pct === 100) {
      guide.classList.add('hidden');
    } else {
      guide.classList.remove('hidden');
      const topMissing = missing.slice(0,3);
      const items = topMissing.map(f =>
        `<span class="guide-item"><span class="guide-field">${f.label}</span><span class="guide-pct">${f.pct}%</span></span>`
      ).join('');
      const more = missing.length > 3 ? `<span class="guide-more">+${missing.length-3} more</span>` : '';
      guide.innerHTML = `<span class="guide-prefix">Unscored:</span>${items}${more}`;
    }
  }

  // Segment dot indicators
  const dotBg     = document.getElementById('dot-bg');
  const dotPrefs  = document.getElementById('dot-prefs');
  const dotFilter = document.getElementById('dot-filters');
  if (dotBg)     dotBg.className    = `seg-dot${(getVal('currentTitle')||tags.roles.length) ? ' seg-dot--blue' : ''}`;
  if (dotPrefs)  dotPrefs.className = `seg-dot${(['remote','hybrid','onsite'].some(t=>isChk(`wt-${t}`))||getVal('minSalary')) ? ' seg-dot--blue' : ''}`;
  if (dotFilter) dotFilter.className = `seg-dot${(tags.deal.length||tags.avoid.length) ? ' seg-dot--red' : ''}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function storageSet(obj) {
  try { await chrome.storage.local.set(obj); return true; }
  catch (e) { console.error('[JobSift] storage:', e); return false; }
}

function getVal(id)    { return document.getElementById(id)?.value?.trim() || ''; }
function setVal(id, v) { const el=document.getElementById(id); if(el) el.value=v; }
function isChk(id)     { return document.getElementById(id)?.checked || false; }
function setChk(id, v) { const el=document.getElementById(id); if(el) el.checked=!!v; }

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('field-flash');
  void el.offsetWidth;
  el.classList.add('field-flash');
  setTimeout(() => el.classList.remove('field-flash'), 1200);
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `af-msg af-msg--${type}`;
  setTimeout(() => { el.className='af-msg af-msg--hidden'; el.textContent=''; }, 5000);
}
