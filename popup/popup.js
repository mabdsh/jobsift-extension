// Rolevance Popup v8.0
// Complete redesign: inline trial activation, usage bars dashboard, no separate trial screen.
'use strict';

// ── Pricing — derived from backend ────────────────────────────────────────────
// All price strings come from /api/subscription/status, which serves
// config/limits.ts as the single source of truth. We never hardcode
// prices in the extension UI — change the price on the server and every
// open popup reflects it on next load.
//
// _getPricing() returns a stable shape consumed by upgrade UI helpers.
// It tolerates missing _subStatus (first paint, network failure) by
// falling back to the last-known correct values; the backend is
// authoritative the moment status arrives.
const _PRICING_FALLBACK = {
  monthly_usd: 9, yearly_usd: 84,
  monthly_label:        '$9/month',
  yearly_label:         '$84/year',
  yearly_equivalent:    '$7/month, billed annually',
  yearly_savings_label: 'Save 22% · 2+ months free',
};

function _getPricing() {
  const p = (_subStatus && _subStatus.pricing) || _PRICING_FALLBACK;
  // Compute the equivalent monthly figure for the annual plan once,
  // so the toggle UI can show "$7/mo" under the Annual button.
  const yearlyMonthlyEq = `$${Math.round(p.yearly_usd / 12)}`;
  return {
    monthly: {
      amount:  p.monthly_usd,
      display: `$${p.monthly_usd}`,
      period:  '/mo',
      label:   'Monthly',
      detail:  'Billed monthly',
    },
    annual: {
      amount:  p.yearly_usd,
      display: `$${p.yearly_usd}`,
      period:  '/yr',
      label:   'Annual',
      detail:  p.yearly_savings_label,
      perMonth: yearlyMonthlyEq,
      saving:   p.yearly_savings_label,
    },
  };
}

// Currently selected plan in upgrade UI — 'monthly' | 'annual'
// Persists across dashboard re-renders within the session.
let _selectedPlan = 'annual'; // default to annual (better LTV, usually pre-selected in SaaS)

// Reusable check SVG for the upgrade-feat pills. Inline (no shared file)
// because popup.js is the single content surface for the popup; centralising
// here avoids 4 separate copies in the dashboard render code.
const _CHECK_SVG = '<svg viewBox="0 0 10 10" fill="none" width="9" height="9" aria-hidden="true"><path d="M2 5l2 2 4-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const MAX_CRITICAL = 4;
const tags = { roles:[], critical:[], primary:[], secondary:[], deal:[], avoid:[] };

let _subStatus     = null;
let _dashboardMode = false;
let _dailyStats    = null;
let _saveTimer     = null;
let _isNewUser     = false;

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
  setupOnboarding();

  const [data, cachedStatus] = await Promise.all([load(), loadSubscriptionStatus()]);

  if (data?.profile) applyProfile(data.profile);
  if (data?.email) {
    set('userEmail', data.email);
    showEmailSaved(true);
  }

  updateStatus();
  updateFooter();

  document.querySelectorAll('input, select, textarea').forEach(el =>
    el.addEventListener('input', () => { updateFooter(); scheduleSave(); })
  );
  document.querySelectorAll('input[type="checkbox"]').forEach(el =>
    el.addEventListener('change', () => { updateFooter(); scheduleSave(); })
  );

  setupTabs();
  loadTrackerTabCount();

  _subStatus = cachedStatus;

  // First-run detection
  _isNewUser = !data?.profile?.currentTitle
    && !data?.profile?.mustHaveSkills?.length
    && !data?.profile?.primarySkills?.length
    && !data?.profile?.targetRoles?.length
    && !data?.profile?.experienceYears;

  if (_isNewUser) {
    showOnboarding();
  } else {
    showMainContent();
    showDashboard();
  }

  // Background refresh
  chrome.runtime.sendMessage({ type: 'JS_REFRESH_SUB_STATUS' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.data) {
      _subStatus = res.data;
      updateSubscriptionUI(res.data);
      if (_dashboardMode) renderDashboard(res.data);
    }
  });
});

// ── Onboarding ─────────────────────────────────────────────────────────────────
// Shows the product hero screen with inline trial email activation.
// No separate trial screen — email goes here, then straight to form/dashboard.

function _onbTrialBtnText() {
  const days = _subStatus?.trial_duration_days ?? 7;
  return `Start ${days}-day trial & set up profile →`;
}

function setupOnboarding() {
  const trialBtn = document.getElementById('onbTrialBtn');
  const skipBtn  = document.getElementById('onbSkipBtn');

  trialBtn?.addEventListener('click', handleOnbTrialActivate);
  skipBtn?.addEventListener('click', () => dismissOnboarding(true));

  // Apply the dynamic onboarding copy from _subStatus.trial_duration_days.
  // All three strings (CTA title, button text, legal pill) trace to TRIAL_DAYS
  // in config/limits.ts via /api/subscription/status. Falls back to "7" when
  // status hasn't loaded yet — matches the canonical value.
  const days = _subStatus?.trial_duration_days ?? 7;

  const ctaTitle = document.getElementById('onbCtaTitle');
  if (ctaTitle) ctaTitle.textContent = `Start your free ${days}-day trial`;

  const legalDays = document.getElementById('onbLegalDays');
  if (legalDays) legalDays.textContent = `${days} days free`;

  if (trialBtn) trialBtn.textContent = _onbTrialBtnText();

  // Enable button only when email field has content
  const emailInp = document.getElementById('onbEmail');
  emailInp?.addEventListener('input', () => {
    if (trialBtn) trialBtn.disabled = !emailInp.value.trim();
  });
  if (trialBtn) trialBtn.disabled = true;
}

async function handleOnbTrialActivate() {
  const emailInp = document.getElementById('onbEmail');
  const btn      = document.getElementById('onbTrialBtn');
  const msg      = document.getElementById('onbTrialMsg');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const email    = emailInp?.value?.trim().toLowerCase() || '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    showMsgEl(msg, 'Enter a valid email address.', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Activating…';

  chrome.runtime.sendMessage({ type: 'JS_TRIAL_ACTIVATE', email }, async (res) => {
    if (chrome.runtime.lastError || !res) {
      showMsgEl(msg, 'Service unavailable — try again shortly.', 'error');
      btn.disabled    = false;
      btn.textContent = _onbTrialBtnText();
      return;
    }

    if (res.ok) {
      _subStatus = res.status;
      // Store email in local storage for display in profile form
      const existing = await load() || {};
      await chrome.storage.local.set({ rolevance: { ...existing, email } });
      set('userEmail', email);
      showEmailSaved(true);
      dismissOnboarding(false);
    } else if (res.error === 'TRIAL_USED') {
      // Email already used — silently proceed as free user, don't block
      showMsgEl(msg, 'A trial has already been used with this email. Continuing with free plan.', 'error');
      setTimeout(() => dismissOnboarding(true), 2500);
    } else {
      showMsgEl(msg, res.message || 'Could not activate trial — try again.', 'error');
      btn.disabled    = false;
      btn.textContent = _onbTrialBtnText();
    }
  });
}

function showOnboarding() {
  const onb = document.getElementById('onboarding');
  if (onb) onb.style.display = 'flex';
  hideMainContent();
}

function dismissOnboarding(skipTrial = false) {
  const onb = document.getElementById('onboarding');
  if (onb) onb.style.display = 'none';
  showMainContent();

  // After trial activation: new users → profile form to fill in.
  // Returning users (already have profile) → dashboard.
  // Skipped trial → always profile form (they haven't set anything up yet).
  if (!skipTrial && _subStatus && !_isNewUser) {
    showDashboard();
  } else {
    // Go to profile form — the core action for any new or skip user
    hideDashboard(); // ensure dashboard is hidden, form is visible
    document.getElementById('acc-profile')?.classList.add('open');
    setTimeout(() => document.getElementById('desc')?.focus(), 80);
  }
}

// ── Main content visibility ────────────────────────────────────────────────────
function showMainContent() {
  const mc = document.getElementById('mainContent');
  if (mc) { mc.style.display = 'flex'; mc.style.flexDirection = 'column'; }
  // Tab bar belongs with main content — any code path that reveals
  // mainContent should reveal the tabs too. Previously this was only set
  // inside dismissOnboarding(), so returning users (who skip onboarding)
  // never saw the tab bar and couldn't reach the Tracker tab.
  const tb = document.getElementById('tabBar');
  if (tb) tb.style.display = 'flex';
}

function hideMainContent() {
  const mc = document.getElementById('mainContent');
  if (mc) mc.style.display = 'none';
  const tb = document.getElementById('tabBar');
  if (tb) tb.style.display = 'none';
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function showDashboard() {
  _dashboardMode = true;
  const db = document.getElementById('dashboard');
  const sa = document.getElementById('scrollArea');
  const ft = document.querySelector('.footer');
  if (db) db.style.display = 'flex';
  if (sa) sa.style.display = 'none';
  if (ft) ft.style.display = 'none';

  _dailyStats = await _loadDailyStats();
  renderDashboard(_subStatus);
  updateSubscriptionUI(_subStatus);
}

function hideDashboard() {
  _dashboardMode = false;
  const db = document.getElementById('dashboard');
  const sa = document.getElementById('scrollArea');
  const ft = document.querySelector('.footer');
  if (db) db.style.display = 'none';
  if (sa) sa.style.display = '';
  if (ft) ft.style.display = '';
  document.getElementById('acc-profile')?.classList.add('open');
}

function _loadDailyStats() {
  const today = new Date().toISOString().split('T')[0];
  return new Promise(resolve => {
    chrome.storage.local.get('rolevance_daily', d => {
      const s = d.rolevance_daily;
      resolve((s?.date === today) ? s : null);
    });
  });
}

// ── Dashboard render ───────────────────────────────────────────────────────────
// Structure: tier card → usage card → launch card → profile card → upgrade card
// No circular ring. Usage bars. Compact profile completeness. Single-column features.

function renderDashboard(status) {
  const db = document.getElementById('dashboard');
  if (!db) return;

  const tier  = status?.tier || 'free';
  const subsOn = status?.subscriptions_enabled ?? true;

  // Profile completeness
  const done = COMPLETENESS_FIELDS.filter(f => f.check()).length;
  const pct  = Math.round(done / COMPLETENESS_FIELDS.length * 100);
  const missing = COMPLETENESS_FIELDS.filter(f => !f.check()).map(f => f.label);

  // Usage counts
  const usage     = status?.usage_today || {};
  const panelUsed = usage.panel   ?? 0;
  const anlUsed   = usage.analyze ?? 0;
  const lims      = status?.limits || {};
  const panelLim  = lims.panel   ?? null;
  const anlLim    = lims.analyze ?? null;

  // Tier card
  const tierCard = _buildTierCard(tier, status, subsOn);

  // Usage card
  const usageCard = _buildUsageCard(panelUsed, panelLim, anlUsed, anlLim);

  // Launch card
  const launchCard = `
    <div class="dash-launch-card">
      <span class="dash-launch-lbl">Browse jobs now</span>
      <a class="dash-launch-btn" href="https://www.linkedin.com/jobs/" target="_blank" rel="noopener">
        <div class="dash-launch-ico dash-launch-ico--li">Li</div>
        <div class="dash-launch-txt">
          <div class="dash-launch-name">LinkedIn Jobs</div>
          <div class="dash-launch-hint">Scores appear on every card instantly</div>
        </div>
        <span class="dash-launch-arr"><svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </a>
      <a class="dash-launch-btn" href="https://www.indeed.com/jobs" target="_blank" rel="noopener">
        <div class="dash-launch-ico dash-launch-ico--in">in</div>
        <div class="dash-launch-txt">
          <div class="dash-launch-name">Indeed Jobs</div>
          <div class="dash-launch-hint">Full AI analysis on every listing</div>
        </div>
        <span class="dash-launch-arr"><svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </a>
    </div>`;

  // Profile completeness card
  const hintText = pct === 100
    ? `<span class="dash-profile-ok">Fully calibrated — ready to score</span>`
    : `<span class="dash-profile-hint">Add ${missing[0]?.toLowerCase() ?? 'more details'} to improve scoring</span>`;
  const profileCard = `
    <div class="dash-profile-card">
      <div class="dash-profile-hdr">
        <span class="dash-profile-lbl">Profile completeness</span>
        <span class="dash-profile-pct">${pct}%</span>
      </div>
      <div class="dash-profile-bar">
        <div class="dash-profile-fill" style="width:${pct}%"></div>
      </div>
      <div class="dash-profile-row">
        ${hintText}
        <button class="dash-profile-edit" id="dashEditBtn" type="button">Edit →</button>
      </div>
    </div>`;

  // Upgrade card — only for free and trial; nothing for pro
  const upgradeCard = (tier === 'free' || (tier === 'trial' && subsOn))
    ? _buildUpgradeCard(tier, status)
    : '';

  db.innerHTML = tierCard + usageCard + launchCard + profileCard + upgradeCard;

  // Wire up edit button
  document.getElementById('dashEditBtn')?.addEventListener('click', hideDashboard);

  // ── Plan toggle interaction ────────────────────────────────────────────────
  db.querySelector('#dashPlanToggle')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-plan]');
    if (!btn) return;
    const plan = btn.dataset.plan;
    if (plan === _selectedPlan) return;
    _selectedPlan = plan;

    // Update active button style
    db.querySelectorAll('.dash-plan-btn').forEach(b => {
      b.classList.toggle('dash-plan-btn--active', b.dataset.plan === plan);
    });

    // Update billing detail line under the toggle
    const detail = db.querySelector('#dashPlanDetail');
    if (detail) {
      const yr = _getPricing().annual;
      const mo = _getPricing().monthly;
      detail.innerHTML = plan === 'annual'
        ? `<span class="dash-plan-billed">Billed ${yr.display}/year</span>`
        : `<span class="dash-plan-billed">${mo.detail}</span>`;
    }

    // Update the CTA button text to reflect selected plan price
    const cta = db.querySelector('#dashUpgradeCta');
    if (cta) {
      const isTrial    = tier === 'trial';
      const trialUsed  = !!status?.trial_activated;
      const ctxContext = isTrial ? 'trial' : (!trialUsed ? 'subscribe' : 'default');
      cta.textContent  = _upgradeCTAText(plan, ctxContext);
    }
  });

  // ── Upgrade buttons — pass selected plan to service worker ────────────────
  db.querySelectorAll('[data-action="upgrade"]').forEach(btn =>
    btn.addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE', plan: _selectedPlan })
    )
  );

  // ── Wire up dashboard trial activation form (free users who skipped onboarding) ──
  const dashTrialBtn = db.querySelector('#dashTrialBtn');
  const dashTrialEmail = db.querySelector('#dashTrialEmail');
  const dashTrialMsg = db.querySelector('#dashTrialMsg');
  if (dashTrialBtn && dashTrialEmail) {
    dashTrialEmail.addEventListener('input', () => {
      dashTrialBtn.disabled = !dashTrialEmail.value.trim();
    });
    dashTrialBtn.disabled = true;
    dashTrialBtn.addEventListener('click', async () => {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const email = dashTrialEmail.value.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        showMsgEl(dashTrialMsg, 'Enter a valid email address.', 'error'); return;
      }
      dashTrialBtn.disabled = true;
      dashTrialBtn.textContent = '…';
      chrome.runtime.sendMessage({ type: 'JS_TRIAL_ACTIVATE', email }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          showMsgEl(dashTrialMsg, 'Service unavailable — try again.', 'error');
          dashTrialBtn.disabled = false; dashTrialBtn.textContent = 'Start trial'; return;
        }
        if (res.ok) {
          const days = res.status?.trial_duration_days ?? 7;
          showMsgEl(dashTrialMsg, `Trial activated — Pro features unlocked for ${days} days.`, 'success');
          _subStatus = res.status;
          setTimeout(() => { updateSubscriptionUI(res.status); renderDashboard(res.status); }, 1400);
        } else if (res.error === 'TRIAL_USED') {
          showMsgEl(dashTrialMsg, 'A trial was already used with this email.', 'error');
          dashTrialBtn.disabled = false; dashTrialBtn.textContent = 'Start trial';
        } else {
          showMsgEl(dashTrialMsg, res.message || 'Could not activate trial — try again.', 'error');
          dashTrialBtn.disabled = false; dashTrialBtn.textContent = 'Start trial';
        }
      });
    });
  }

  // Wire up restore toggle inside upgrade card
  const restoreToggle = db.querySelector('[data-action="restore-toggle"]');
  const restoreForm   = db.querySelector('#dashRestoreForm');
  restoreToggle?.addEventListener('click', () => {
    if (!restoreForm) return;
    const visible = restoreForm.style.display !== 'none';
    restoreForm.style.display = visible ? 'none' : 'block';
    restoreToggle.textContent = visible ? 'Already subscribed? Restore access' : 'Hide restore form';
  });

  const restoreBtn = db.querySelector('#dashRestoreBtn');
  const restoreInp = db.querySelector('#dashRestoreEmail');
  const restoreMsg = db.querySelector('#dashRestoreMsg');
  restoreBtn?.addEventListener('click', async () => {
    const email = restoreInp?.value?.trim();
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!email || !EMAIL_RE.test(email)) {
      showMsgEl(restoreMsg, 'Enter a valid email address.', 'error');
      return;
    }
    restoreBtn.disabled = true;
    restoreBtn.textContent = 'Restoring…';
    chrome.runtime.sendMessage({ type: 'JS_RESTORE_SUBSCRIPTION', email }, (res) => {
      if (chrome.runtime.lastError || !res) {
        showMsgEl(restoreMsg, 'Service unavailable — try again.', 'error');
        restoreBtn.disabled = false; restoreBtn.textContent = 'Restore';
        return;
      }
      if (res.ok) {
        showMsgEl(restoreMsg, 'Subscription restored!', 'success');
        _subStatus = res.status;
        updateSubscriptionUI(res.status);
        renderDashboard(res.status);
      } else {
        showMsgEl(restoreMsg, res.message || 'No active subscription found for this email.', 'error');
        restoreBtn.disabled = false; restoreBtn.textContent = 'Restore';
      }
    });
  });
}

function _buildTierCard(tier, status, subsOn) {
  if (!subsOn || tier === 'pro') {
    return `
      <div class="dash-tier-card dash-tier-card--pro">
        <div class="dash-tier-left">
          <div class="dash-tier-dot dash-tier-dot--green"></div>
          <div>
            <div class="dash-tier-name">Pro plan &nbsp;·&nbsp; active</div>
            <div class="dash-tier-sub">Unlimited access &nbsp;·&nbsp; all features enabled</div>
          </div>
        </div>
        <a href="https://YOUR_STORE.lemonsqueezy.com/billing" target="_blank" rel="noopener"
           class="dash-manage-link">Manage →</a>
      </div>`;
  }

  if (tier === 'trial') {
    const days     = status?.trial_days_left ?? 7;
    const isUrgent = days <= 2;
    const urgentSub = isUrgent ? `Last ${days === 1 ? 'day' : '2 days'} — upgrade to keep access` : `${days} days remaining`;
    return `
      <div class="dash-tier-card dash-tier-card--trial dash-tier-card--trial-info">
        <div class="dash-tier-left">
          <div class="dash-tier-dot dash-tier-dot--amber"></div>
          <div>
            <div class="dash-tier-name">Trial &nbsp;·&nbsp; ${days} day${days !== 1 ? 's' : ''} left</div>
            <div class="dash-tier-sub">${urgentSub}</div>
          </div>
        </div>
      </div>`;
  }

  // Free tier — informational only. The upgrade pathway lives in the bottom
  // upgrade card (one upgrade surface per the dashboard demotion plan).
  // Limits surface from status.limits (backend-driven via limits.ts);
  // score count is intentionally absent (unlimited for all tiers).
  const lim = status?.limits || {};
  const subParts = [];
  if (lim.panel   !== null && lim.panel   !== undefined) subParts.push(`${lim.panel} panels`);
  if (lim.analyze !== null && lim.analyze !== undefined) subParts.push(`${lim.analyze} analyses`);
  const subText = subParts.length
    ? `${subParts.join(' · ')} per day`
    : 'Score every job you see';   // fallback if limits missing

  return `
    <div class="dash-tier-card dash-tier-card--free-info">
      <div class="dash-tier-left">
        <div class="dash-tier-dot dash-tier-dot--green"></div>
        <div>
          <div class="dash-tier-name">Free plan</div>
          <div class="dash-tier-sub">${subText}</div>
        </div>
      </div>
    </div>`;
}

function _buildUsageCard(panelUsed, panelLim, anlUsed, anlLim) {
  function barRow(name, used, limit) {
    if (limit === null) {
      return `
        <div class="dash-usage-row">
          <span class="dash-usage-name">${name}</span>
          <div class="dash-usage-bar"><div class="dash-usage-fill" style="width:22%;opacity:.25"></div></div>
          <span class="dash-usage-unlimited">Unlimited</span>
        </div>`;
    }
    const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    return `
      <div class="dash-usage-row">
        <span class="dash-usage-name">${name}</span>
        <div class="dash-usage-bar"><div class="dash-usage-fill" style="width:${pct}%"></div></div>
        <span class="dash-usage-count">${used}/${limit}</span>
      </div>`;
  }

  const scoring = _dailyStats && _dailyStats.jobsScored > 0
    ? `<div class="dash-scoring-status"><div class="dash-scoring-dot"></div>Scored ${_dailyStats.jobsScored} jobs today</div>`
    : `<div class="dash-scoring-status"><div class="dash-scoring-dot"></div>Scoring active</div>`;

  return `
    <div class="dash-usage-card">
      <div class="dash-usage-hdr">
        <span class="dash-usage-label">Today's usage</span>
        ${scoring}
      </div>
      ${barRow('Panels', panelUsed, panelLim)}
      ${barRow('Analysis', anlUsed, anlLim)}
    </div>`;
}

// ── CTA text helper — always reflects the selected plan price ─────────────────
// Used by _buildUpgradeCard (initial render) and the toggle handler (on switch).
// Pricing comes from _subStatus.pricing on every call, so a status refresh
// after a price change is reflected immediately on the next render.
function _upgradeCTAText(plan, context) {
  const p = _getPricing()[plan];
  const price = plan === 'annual'
    ? `${p.display}/year`
    : `${p.display}${p.period}`;
  if (context === 'trial') return `Keep Pro — ${price} →`;
  if (context === 'subscribe') return `Subscribe to Pro — ${price} →`;
  return `Upgrade to Pro — ${price} →`;
}

// ── Plan toggle HTML helper ───────────────────────────────────────────────────
// Renders the monthly/annual toggle used in upgrade cards.
// selected = 'monthly' | 'annual'
function _buildPlanToggle(selected) {
  const pr = _getPricing();
  const mo = pr.monthly;
  const yr = pr.annual;
  return `
    <div class="dash-plan-toggle" id="dashPlanToggle">
      <button class="dash-plan-btn ${selected === 'monthly' ? 'dash-plan-btn--active' : ''}"
              data-plan="monthly" type="button">
        <span class="dash-plan-label">${mo.label}</span>
        <span class="dash-plan-price">${mo.display}<span class="dash-plan-period">${mo.period}</span></span>
      </button>
      <button class="dash-plan-btn ${selected === 'annual' ? 'dash-plan-btn--active' : ''}"
              data-plan="annual" type="button">
        <span class="dash-plan-label">${yr.label}</span>
        <span class="dash-plan-price">${yr.perMonth}<span class="dash-plan-period">/mo</span></span>
        <span class="dash-plan-badge">${yr.saving}</span>
      </button>
    </div>
    <div class="dash-plan-detail" id="dashPlanDetail">
      ${selected === 'annual'
        ? `<span class="dash-plan-billed">Billed ${yr.display}/year</span>`
        : `<span class="dash-plan-billed">${mo.detail}</span>`}
    </div>`;
}

function _buildUpgradeCard(tier, status) {
  const isTrial   = tier === 'trial';
  const trialUsed = !!status?.trial_activated;
  const days      = status?.trial_days_left ?? 7;

  const feats = [
    'Unlimited panels &amp; AI analyses per day',
    'Strengths, gaps &amp; interview coaching',
    'Cover letter angles per role',
    'Cancel anytime',
  ];
  const featHTML = feats.map(f =>
    `<div class="dash-upgrade-feat"><div class="dash-upgrade-check">${_CHECK_SVG}</div>${f}</div>`
  ).join('');

  // ── Trial tier — keep your access ────────────────────────────────────────
  if (isTrial) {
    // SVG warning triangle — replaces ⚠ Unicode glyph for cross-platform consistency.
    const warnSvg = '<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true" style="vertical-align:-2px;margin-right:3px"><path d="M6 1.5L11 10H1L6 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 5v2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="9" r=".7" fill="currentColor"/></svg>';
    const urgency = days <= 2
      ? `<span class="dash-trial-urgency">${warnSvg}${days === 1 ? 'Last day' : '2 days left'} — don't lose access</span>`
      : '';
    return `
      <div class="dash-upgrade-card">
        <div class="dash-upgrade-name-row">
          <div class="dash-upgrade-name">Keep your access</div>
          ${urgency}
        </div>
        <div class="dash-upgrade-desc">Trial ends in ${days} day${days !== 1 ? 's' : ''} — choose your plan to stay on Pro</div>
        ${_buildPlanToggle(_selectedPlan)}
        <button class="dash-upgrade-cta dash-upgrade-cta--amber" id="dashUpgradeCta" data-action="upgrade" type="button">
          ${_upgradeCTAText(_selectedPlan, 'trial')}
        </button>
        <div class="dash-upgrade-feats">${featHTML}</div>
      </div>`;
  }

  // ── Free tier — trial not yet used: trial as primary, paid as secondary ──
  if (!trialUsed) {
    // Trial duration comes from /status (status.trial_duration_days, which
    // mirrors TRIAL_DAYS in the backend). We don't quote per-day limits in
    // this card because the message is "unlimited everything during trial" —
    // the actual trial caps (10 panels/day, etc.) appear in the limit panel
    // if a trial user ever hits them, not here in the upsell.
    const trialDur = status?.trial_duration_days ?? status?.tiers?.trial?.duration_days ?? 7;
    return `
      <div class="dash-upgrade-card">
        <div class="dash-upgrade-name-row">
          <div class="dash-upgrade-name">Try Pro free for ${trialDur} days</div>
        </div>
        <div class="dash-upgrade-desc">Unlimited panels, analyses &amp; AI coaching</div>
        <div class="dash-trial-email-form">
          <div class="dash-trial-email-row">
            <input type="email" id="dashTrialEmail" class="dash-trial-email-inp"
                   placeholder="your@email.com" autocomplete="email">
            <button id="dashTrialBtn" class="dash-trial-btn" type="button">Start trial</button>
          </div>
          <div id="dashTrialMsg" class="msg msg--hidden" role="alert"></div>
        </div>
        <div class="dash-upgrade-feats">
          <div class="dash-upgrade-feat"><div class="dash-upgrade-check">${_CHECK_SVG}</div>Unlimited panels &amp; AI analyses</div>
          <div class="dash-upgrade-feat"><div class="dash-upgrade-check">${_CHECK_SVG}</div>Full coaching: strengths, gaps &amp; game plan</div>
          <div class="dash-upgrade-feat"><div class="dash-upgrade-check">${_CHECK_SVG}</div>No credit card needed · ${trialDur} days free</div>
        </div>
        <div class="dash-or-row"><span>ready to subscribe?</span></div>
        ${_buildPlanToggle(_selectedPlan)}
        <button class="dash-upgrade-cta dash-upgrade-cta--secondary" id="dashUpgradeCta" data-action="upgrade" type="button">
          ${_upgradeCTAText(_selectedPlan, 'subscribe')}
        </button>
        <div class="dash-or-row"><span>already on Pro?</span></div>
        <button class="dash-restore-link" data-action="restore-toggle" type="button">Restore subscription by email</button>
        <div id="dashRestoreForm" style="display:none" class="dash-restore-form">
          <div class="dash-restore-row">
            <input type="email" id="dashRestoreEmail" class="dash-restore-inp" placeholder="your@email.com">
            <button id="dashRestoreBtn" class="dash-restore-btn" type="button">Restore</button>
          </div>
          <div id="dashRestoreMsg" class="msg msg--hidden" role="alert"></div>
        </div>
      </div>`;
  }

  // ── Free tier — trial already used: paid upgrade with toggle ─────────────
  return `
    <div class="dash-upgrade-card">
      <div class="dash-upgrade-name-row">
        <div class="dash-upgrade-name">Rolevance Pro</div>
      </div>
      <div class="dash-upgrade-desc">Unlimited AI coaching on every role</div>
      ${_buildPlanToggle(_selectedPlan)}
      <button class="dash-upgrade-cta" id="dashUpgradeCta" data-action="upgrade" type="button">${_upgradeCTAText(_selectedPlan)}</button>
      <div class="dash-upgrade-feats">${featHTML}</div>
    </div>
    <button class="dash-restore-link" data-action="restore-toggle" type="button">Already subscribed? Restore access</button>
    <div id="dashRestoreForm" style="display:none" class="dash-restore-form">
      <div class="dash-restore-row">
        <input type="email" id="dashRestoreEmail" class="dash-restore-inp" placeholder="your@email.com">
        <button id="dashRestoreBtn" class="dash-restore-btn" type="button">Restore</button>
      </div>
      <div id="dashRestoreMsg" class="msg msg--hidden" role="alert"></div>
    </div>`;
}

// ── Upgrade complete listener ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'JS_UPGRADE_COMPLETE') return;
  showProToast();
  loadSubscriptionStatus().then(status => {
    _subStatus = status;
    updateSubscriptionUI(status);
    if (_dashboardMode) renderDashboard(status);
  });
});

function showProToast() {
  const toast = document.getElementById('saveToast');
  if (!toast) return;
  toast.textContent = "You're now on Pro — enjoy unlimited access";
  toast.classList.add('save-toast--success');
  toast.classList.remove('save-toast--hidden');
  setTimeout(() => {
    toast.classList.add('save-toast--hidden');
    toast.classList.remove('save-toast--success');
  }, 5000);
}

// ── Header / subscription UI ───────────────────────────────────────────────────
function updateSubscriptionUI(status) {
  _subStatus = status;
  if (_dashboardMode) renderDashboard(status);

  const proBadge    = document.getElementById('proBadge');
  const headerAction = document.getElementById('headerAction');
  if (!proBadge) return;

  function bindUpgradeBtn() {
    document.getElementById('headerUpgradeBtn')?.addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'JS_OPEN_UPGRADE', plan: _selectedPlan })
    );
  }

  if (!status || !status.subscriptions_enabled) {
    proBadge.style.display = 'none';
    if (headerAction) headerAction.innerHTML = '';
    return;
  }

  if (status.tier === 'pro') {
    proBadge.innerHTML   = 'Pro';
    proBadge.className   = 'pro-badge';
    proBadge.style.display = 'inline-flex';
    if (headerAction) headerAction.innerHTML = '<span class="header-pro-badge">Pro <svg viewBox="0 0 12 12" fill="none" width="9" height="9" aria-hidden="true" style="vertical-align:-1px"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    return;
  }

  if (status.tier === 'trial') {
    const days = status.trial_days_left ?? 7;
    const ring = `<span class="badge-ring"><span class="badge-ring-dot"></span></span>`;
    if (days <= 1) {
      proBadge.className = 'pro-badge pro-badge--trial pro-badge--trial-warn pro-badge--trial-urgent';
      proBadge.innerHTML = `${ring}<span class="badge-text">Trial · <strong>Last day</strong></span>`;
    } else if (days <= 3) {
      proBadge.className = 'pro-badge pro-badge--trial pro-badge--trial-warn';
      proBadge.innerHTML = `${ring}<span class="badge-text">Trial · <strong>${days}d</strong> left</span>`;
    } else {
      proBadge.className = 'pro-badge pro-badge--trial';
      proBadge.innerHTML = `${ring}<span class="badge-text">Trial · <strong>${days}d</strong> left</span>`;
    }
    proBadge.style.display = 'inline-flex';
    // Header upgrade button removed — the deadline pill carries the urgency,
    // the bottom upgrade card is the conversion surface. One upgrade surface.
    if (headerAction) headerAction.innerHTML = '';
    return;
  }

  // Free tier — header stays clean. Upgrade pathway lives in the bottom
  // upgrade card. Removing the header button is part of the dashboard
  // demotion plan: one upgrade surface, not four. Trial tier still gets a
  // header button because trial users have a deadline (see branch above).
  proBadge.style.display = 'none';
  if (headerAction) headerAction.innerHTML = '';
}

// ── Accordion ─────────────────────────────────────────────────────────────────
function setupAccordion() {
  document.querySelectorAll('.acc-header').forEach(header => {
    header.addEventListener('click', () =>
      header.closest('.acc-section').classList.toggle('open')
    );
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
          updateFooter(); scheduleSave();
        }
        inpEl.value = '';
      }
      if (e.key === 'Backspace' && !inpEl.value && tags[key].length) {
        tags[key].pop();
        renderTags(list, key, danger);
        updateFooter(); scheduleSave();
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
    const rm  = document.createElement('button');
    rm.className   = 'tag-rm';
    rm.innerHTML   = '×';
    rm.setAttribute('aria-label', `Remove ${t}`);
    rm.addEventListener('click', () => { tags[key].splice(i,1); renderTags(listId,key,danger); updateFooter(); scheduleSave(); });
    tag.append(document.createTextNode(t), rm);
    list.appendChild(tag);
  });
  const sc = document.getElementById('skills-count');
  const fc = document.getElementById('filters-count');
  const skillCount = tags.critical.length + tags.primary.length + tags.secondary.length;
  if (sc) sc.textContent = skillCount > 0 ? skillCount : '';
  if (fc) fc.textContent = (tags.deal.length + tags.avoid.length) > 0 ? (tags.deal.length + tags.avoid.length) : '';
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
  return new Promise(r => chrome.storage.local.get('rolevance', d => r(d.rolevance || null)));
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

// ── Auto-save ─────────────────────────────────────────────────────────────────
function scheduleSave() {
  setAutoSaveStatus('pending');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => save(true), 800);
}

function setAutoSaveStatus(state) {
  const el = document.getElementById('autoSaveStatus');
  if (!el) return;
  if (state === 'pending') {
    el.textContent = 'Saving…'; el.className = 'autosave-status autosave-status--pending';
  } else if (state === 'saved') {
    el.textContent = 'Saved'; el.className = 'autosave-status autosave-status--saved';
    clearTimeout(el._fadeTimer);
    el._fadeTimer = setTimeout(() => { el.textContent = ''; el.className = 'autosave-status'; }, 2200);
  } else {
    el.textContent = ''; el.className = 'autosave-status';
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function save(silent = false) {
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

  let existing = {};
  try {
    existing = await load() || {};
    if (JSON.stringify(existing.profile) === JSON.stringify(profile)) return;
    await chrome.storage.local.set({ rolevance: { ...existing, profile } });
    if (silent) {
      setAutoSaveStatus('saved');
    } else {
      const toast = document.getElementById('saveToast');
      if (toast) {
        toast.classList.remove('save-toast--hidden');
        setTimeout(() => toast.classList.add('save-toast--hidden'), 3000);
      }
    }
  } catch {
    showMsg('afMsg', 'Save failed', 'error');
    return;
  }

  const emailVal = get('userEmail').toLowerCase();
  if (emailVal && emailVal.includes('@') && emailVal !== existing.email) {
    chrome.runtime.sendMessage({ type: 'JS_SAVE_EMAIL', email: emailVal }, async (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.ok) {
        const current = await load() || {};
        await chrome.storage.local.set({ rolevance: { ...current, email: emailVal } });
        showEmailSaved(true);
      }
    });
  }
}

function showEmailSaved(visible) {
  const mark = document.getElementById('emailSavedMark');
  if (mark) mark.style.display = visible ? 'inline-flex' : 'none';
}

// ── Auto-fill ─────────────────────────────────────────────────────────────────
function setupAutofill() {
  const desc = document.getElementById('desc');
  const btn  = document.getElementById('autoFillBtn');
  desc?.addEventListener('input', () => { if (btn) btn.disabled = desc.value.trim().length < 20; });
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
    label.textContent = 'Profile updated';
    showMsg('afMsg', 'Profile extracted from your description', 'success');
    setTimeout(() => { label.textContent = 'Auto-fill from description'; btn.disabled = false; }, 3500);
  } catch {
    label.textContent = 'Auto-fill from description';
    btn.disabled = false;
    showMsg('afMsg', 'Could not extract — try again or fill manually', 'error');
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
  if (p.targetRoles?.length)    { tags.roles = [...p.targetRoles]; renderTags('rolesTags','roles',false); document.getElementById('acc-profile')?.classList.add('open'); }
  if (p.mustHaveSkills?.length) { tags.critical = [...p.mustHaveSkills.slice(0,MAX_CRITICAL)]; renderTags('criticalTags','critical',false); document.getElementById('acc-skills')?.classList.add('open'); }
  if (p.primarySkills?.length)  { tags.primary = [...p.primarySkills]; renderTags('primaryTags','primary',false); document.getElementById('acc-skills')?.classList.add('open'); }
  if (p.secondarySkills?.length){ tags.secondary = [...p.secondarySkills]; renderTags('secondaryTags','secondary',false); }
  if (p.dealBreakers?.length)   { tags.deal = [...p.dealBreakers]; renderTags('dealTags','deal',true); document.getElementById('acc-filters')?.classList.add('open'); }
  updateFooter(); scheduleSave();
}

// ── Status dot ────────────────────────────────────────────────────────────────
function updateStatus() {
  const dot = document.getElementById('brandActiveDot');
  if (!dot) return;
  chrome.tabs.query({ active:true, currentWindow:true }, tabs => {
    const url = tabs[0]?.url || '';
    const isActive = url.includes('linkedin.com/jobs') || url.includes('indeed.com');
    dot.className = `brand-dot${isActive ? ' brand-dot--active' : ''}`;
    dot.title = isActive ? 'Scoring jobs on this page' : 'Open LinkedIn or Indeed to start scoring';
  });
}

// ── Footer — profile completeness ─────────────────────────────────────────────
function updateFooter() {
  const done = COMPLETENESS_FIELDS.filter(f => f.check()).length;
  const pct  = Math.round(done / COMPLETENESS_FIELDS.length * 100);
  const fill = document.getElementById('progressFill');
  const lbl  = document.getElementById('progressLbl');
  if (fill) fill.style.width = pct + '%';
  if (lbl) {
    lbl.textContent = pct === 100 ? 'Profile complete' : `${pct}% complete`;
    lbl.className   = pct === 100 ? 'progress-lbl progress-lbl--done' : 'progress-lbl';
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
  el.textContent = text; el.className = `msg msg--${type}`;
  setTimeout(() => { el.className = 'msg msg--hidden'; el.textContent = ''; }, 5000);
}

function showMsgEl(el, text, type) {
  if (!el) return;
  el.textContent = text; el.className = `msg msg--${type}`;
  setTimeout(() => { if (el) { el.className = 'msg msg--hidden'; el.textContent = ''; } }, 5000);
}

// ── Subscription status cache ──────────────────────────────────────────────────
async function loadSubscriptionStatus() {
  return new Promise(resolve =>
    chrome.storage.local.get('rolevance_sub', d => resolve(d.rolevance_sub || null))
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────────
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      tabBtns.forEach(b => { b.classList.remove('tab-btn--active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('tab-btn--active');
      btn.setAttribute('aria-selected','true');

      const tab         = btn.dataset.tab;
      const mainContent = document.getElementById('mainContent');
      const trackerPane = document.getElementById('trackerPane');

      if (tab === 'tracker') {
        // Hide mainContent, show tracker — works whether we were on dashboard or form
        if (mainContent) mainContent.style.display = 'none';
        if (trackerPane) trackerPane.style.display = 'flex';
        await renderTracker();
      } else {
        // Returning to Profile tab from Tracker
        if (trackerPane) trackerPane.style.display = 'none';
        if (mainContent) { mainContent.style.display = 'flex'; mainContent.style.flexDirection = 'column'; }

        // Restore the correct view: dashboard if we were there, form otherwise
        if (_dashboardMode) {
          const db = document.getElementById('dashboard');
          const sa = document.getElementById('scrollArea');
          const ft = document.querySelector('.footer');
          if (db) db.style.display = 'flex';
          if (sa) sa.style.display = 'none';
          if (ft) ft.style.display = 'none';
        }
      }
    });
  });

  document.getElementById('tkFilters')?.addEventListener('click', async e => {
    const btn = e.target.closest('.tk-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.tk-filter-btn').forEach(b => b.classList.remove('tk-filter--active'));
    btn.classList.add('tk-filter--active');
    _trackerFilter = btn.dataset.filter;
    await renderTracker();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#tk-dropdown-portal') && !e.target.closest('.tk-status-pill')) {
      closePortalDropdown();
    }
  });
}

// ── Job Tracker ────────────────────────────────────────────────────────────────
const TRACKER_KEY    = 'rolevance_tracker';
let   _trackerFilter = 'all';

function loadTrackerData() {
  return new Promise(r => chrome.storage.local.get(TRACKER_KEY, d => r(d[TRACKER_KEY] || {})));
}
function saveTrackerData(data) {
  return new Promise(r => chrome.storage.local.set({ [TRACKER_KEY]: data }, r));
}

async function loadTrackerTabCount() {
  const data    = await loadTrackerData();
  const count   = Object.keys(data).length;
  const countEl = document.getElementById('trackerTabCount');
  if (countEl) countEl.textContent = count > 0 ? count : '';
}

// Portal dropdown
let _portalJobId = null;

function getOrCreatePortalDropdown() {
  let dd = document.getElementById('tk-dropdown-portal');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'tk-dropdown-portal';
    dd.className = 'tk-status-dropdown';
    dd.style.cssText = 'display:none; position:fixed; z-index:9999;';
    document.body.appendChild(dd);
    dd.addEventListener('click', async e => {
      const opt = e.target.closest('.tk-status-opt');
      if (!opt) return;
      const newStatus = opt.dataset.value;
      const jobId     = _portalJobId;
      closePortalDropdown();
      if (!jobId || !newStatus) return;
      const data = await loadTrackerData();
      if (data[jobId]) { data[jobId].status = newStatus; data[jobId].updatedAt = Date.now(); await saveTrackerData(data); }
      await renderTracker();
    });
  }
  return dd;
}

function openPortalDropdown(pill, jobId, currentStatus) {
  const dd = getOrCreatePortalDropdown();
  if (_portalJobId === jobId && dd.style.display !== 'none') { closePortalDropdown(); return; }
  _portalJobId = jobId;
  dd.innerHTML = Object.entries(STATUS_META)
    .filter(([val]) => val !== currentStatus)
    .map(([val, m]) => `<button class="tk-status-opt" data-value="${val}" type="button">${m.icon} ${m.label}</button>`)
    .join('');
  const rect = pill.getBoundingClientRect();
  dd.style.left = `${Math.round(rect.left)}px`;
  dd.style.minWidth = `${Math.round(rect.width)}px`;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 150) { dd.style.top='auto'; dd.style.bottom=`${Math.round(window.innerHeight-rect.top+4)}px`; }
  else { dd.style.bottom='auto'; dd.style.top=`${Math.round(rect.bottom+4)}px`; }
  dd.style.display = 'block';
}

function closePortalDropdown() {
  const dd = document.getElementById('tk-dropdown-portal');
  if (dd) dd.style.display = 'none';
  _portalJobId = null;
}

async function renderTracker() {
  const data    = await loadTrackerData();
  const entries = Object.values(data).sort((a,b) => b.savedAt - a.savedAt);
  const counts  = { all: entries.length, saved:0, applied:0, interview:0, rejected:0 };
  entries.forEach(e => { if (counts[e.status] !== undefined) counts[e.status]++; });
  ['all','saved','applied','interview','rejected'].forEach(k => {
    const el = document.getElementById(`tkc-${k}`);
    if (el) el.textContent = counts[k];
  });
  const tabCount = document.getElementById('trackerTabCount');
  if (tabCount) tabCount.textContent = counts.all > 0 ? counts.all : '';
  const filtered = _trackerFilter === 'all' ? entries : entries.filter(e => e.status === _trackerFilter);
  const list = document.getElementById('tkList');
  if (!list) return;
  if (filtered.length === 0) { list.innerHTML = _emptyStateHTML(counts.all === 0); return; }
  list.innerHTML = '';
  filtered.forEach(entry => list.appendChild(buildTrackerCard(entry)));
}

// Tracker status icons. Inline SVG (not emoji) for consistent rendering
// across Mac, Windows, Linux, and ChromeOS. All icons share the same stroke
// width and cap style for a unified visual language. 12×12 viewBox, scaled
// by font-size at usage site.
const TK_ICONS = {
  saved: `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
    <path d="M3 1.5h6v5L6 8.5 3 6.5v-5z" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6 8.5v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,
  applied: `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
    <path d="M10.5 1.5L1.5 5l4 1.5 1.5 4 3.5-9z" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  interview: `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="6" cy="6" r="2"   stroke="currentColor" stroke-width="1.2"/>
    <circle cx="6" cy="6" r=".6" fill="currentColor"/>
  </svg>`,
  rejected: `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round"/>
  </svg>`,
  chevron: `<svg viewBox="0 0 10 10" fill="none" width="9" height="9" aria-hidden="true">
    <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  external: `<svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
    <path d="M5 2H3a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V7" stroke="currentColor"
          stroke-width="1.2" stroke-linecap="round"/>
    <path d="M7 2h3v3M10 2L5.5 6.5" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

const STATUS_META = {
  saved:     { label:'Saved',     icon: TK_ICONS.saved,     cls:'tk-status--saved'     },
  applied:   { label:'Applied',   icon: TK_ICONS.applied,   cls:'tk-status--applied'   },
  interview: { label:'Interview', icon: TK_ICONS.interview, cls:'tk-status--interview' },
  rejected:  { label:'Rejected',  icon: TK_ICONS.rejected,  cls:'tk-status--rejected'  },
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
      <div class="tk-score-tile tk-score-tile--${entry.label}">
        <span class="tk-score-num">${scoreText}</span>
      </div>
      <div class="tk-card-info">
        <div class="tk-card-title">${_esc(entry.title)}</div>
        <div class="tk-card-meta">${platform} ${_esc(entry.company)}${entry.location ? ' · '+_esc(entry.location) : ''} <span class="tk-card-time">· ${_timeAgo(entry.savedAt)}</span></div>
      </div>
      <div class="tk-card-actions">
        ${entry.url ? `<a class="tk-icon-btn" href="${entry.url}" target="_blank" rel="noopener" title="Open posting">${TK_ICONS.external}</a>` : ''}
        <button class="tk-icon-btn tk-delete-btn" title="Remove" type="button">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M3 4h10M6 4V2h4v2M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="tk-card-bottom">
      <div class="tk-status-wrap">
        <button class="tk-status-pill ${meta.cls}" type="button"><span class="tk-status-icon">${meta.icon}</span> ${meta.label} <span class="tk-chevron">${TK_ICONS.chevron}</span></button>
      </div>
    </div>`;
  card.querySelector('.tk-status-pill').addEventListener('click', e => {
    e.stopPropagation();
    openPortalDropdown(e.currentTarget, entry.jobId, entry.status);
  });
  card.querySelector('.tk-delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    closePortalDropdown();
    showDeleteConfirm(card, entry.jobId);
  });
  return card;
}

function showDeleteConfirm(card, jobId) {
  const savedHTML = card.innerHTML;
  card.innerHTML = `
    <div class="tk-confirm">
      <span class="tk-confirm-msg">Remove this job from your tracker?</span>
      <div class="tk-confirm-btns">
        <button class="tk-confirm-yes" type="button">Remove</button>
        <button class="tk-confirm-no" type="button">Cancel</button>
      </div>
    </div>`;
  card.querySelector('.tk-confirm-yes').addEventListener('click', async () => {
    card.classList.add('tk-card--removing');
    const data = await loadTrackerData();
    delete data[jobId];
    await saveTrackerData(data);
    setTimeout(async () => { card.remove(); await renderTracker(); }, 220);
  });
  card.querySelector('.tk-confirm-no').addEventListener('click', async () => {
    card.innerHTML = savedHTML;
    await renderTracker();
  });
}

function _emptyStateHTML(noJobsAtAll) {
  // SVG clipboard icon — replaces 📋 emoji for cross-platform consistency
  const clipboardIcon = `
    <svg viewBox="0 0 36 36" fill="none" width="36" height="36" aria-hidden="true">
      <rect x="9" y="6" width="18" height="24" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <rect x="13" y="3" width="10" height="5" rx="1" stroke="currentColor" stroke-width="1.5"
            fill="currentColor" fill-opacity=".08"/>
      <path d="M13 14h10M13 19h10M13 24h6" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" opacity=".55"/>
    </svg>`;
  return `
    <div class="tk-empty">
      <div class="tk-empty-icon">${clipboardIcon}</div>
      <div class="tk-empty-title">${noJobsAtAll ? 'No jobs tracked yet' : 'No jobs in this stage'}</div>
      <div class="tk-empty-sub">${noJobsAtAll ? 'Score jobs on LinkedIn or Indeed, then click <strong>Save</strong> in the analysis panel.' : 'Change the filter above to see jobs in other stages.'}</div>
      ${noJobsAtAll ? '<a class="tk-empty-cta" href="https://www.linkedin.com/jobs/" target="_blank" rel="noopener">Go to LinkedIn Jobs →</a>' : ''}
    </div>`;
}

function _timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)          return 'just now';
  if (s < 3600)        return `${Math.floor(s/60)}m ago`;
  if (s < 86400)       return `${Math.floor(s/3600)}h ago`;
  if (s < 86400*30)    return `${Math.floor(s/86400)}d ago`;
  if (s < 86400*365)   return `${Math.floor(s/(86400*30))}mo ago`;
  return `${Math.floor(s/(86400*365))}yr ago`;
}

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}