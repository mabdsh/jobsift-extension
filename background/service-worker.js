// JobSift Service Worker v3.5.0 — direct LemonSqueezy checkout

'use strict';

const API_BASE_URL  = 'http://localhost:3000'; // replace with your DuckDNS URL
const CLIENT_SECRET = '6fc521c67954cc87dee87f91b8def0811149c094b4f87594805485a1f40f8898';

// ── LemonSqueezy checkout config ───────────────────────────────────────────────
// Set these to your actual values from the LemonSqueezy dashboard.
// Neither is sensitive — the store subdomain and variant ID are publicly
// visible in any checkout URL. The checkout is opened directly from the
// extension so it works even when the backend is unavailable.
const LS_STORE_SUBDOMAIN = 'YOUR_STORE_SUBDOMAIN';   // e.g. 'myjobsift'
const LS_VARIANT_ID      = 'YOUR_VARIANT_ID';         // e.g. '123456'

const SUB_STATUS_TTL_MS  = 60 * 60 * 1000;
const BACKEND_TIMEOUT_MS = 8000;

const DEFAULT_DATA = {
  profile: {
    description: '', currentTitle: '', experienceYears: 0,
    targetRoles: [], mustHaveSkills: [], primarySkills: [],
    secondarySkills: [], workTypes: [], jobTypes: ['full-time'],
    minSalary: 0, dealBreakers: [], avoidIndustries: [], careerGoal: '',
  }
};

// ── Install ────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const existing = await new Promise(r =>
    chrome.storage.local.get('jobsift', d => r(d.jobsift || null))
  );
  if (reason === 'install' || !existing) {
    await chrome.storage.local.set({
      jobsift: { ...DEFAULT_DATA, deviceId: crypto.randomUUID() }
    });
  } else if (!existing.deviceId) {
    await chrome.storage.local.set({
      jobsift: { ...existing, deviceId: crypto.randomUUID() }
    });
  }
  fetchAndCacheSubStatus();
});

// ── Hourly alarm ───────────────────────────────────────────────────────────────
chrome.alarms.create('refreshSubStatus', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'refreshSubStatus') fetchAndCacheSubStatus();
});

// ── Device ID helper ───────────────────────────────────────────────────────────
async function getDeviceId() {
  return new Promise(resolve => {
    chrome.storage.local.get('jobsift', d => resolve(d.jobsift?.deviceId ?? null));
  });
}

// ── Fetch with timeout ─────────────────────────────────────────────────────────
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timerId    = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timerId));
}

// ── Core backend call ──────────────────────────────────────────────────────────
async function callBackend(endpoint, body) {
  const deviceId = await getDeviceId();
  if (!deviceId) throw new Error('NO_DEVICE_ID');

  const res = await fetchWithTimeout(
    `${API_BASE_URL}${endpoint}`,
    {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Device-ID':     deviceId,
        'X-Client-Secret': CLIENT_SECRET,
      },
      body: JSON.stringify(body),
    },
    BACKEND_TIMEOUT_MS
  );

  if (!res.ok) {
    let errorCode = `API_ERROR_${res.status}`;
    let resetAt   = null;
    try {
      const d   = await res.json();
      errorCode = d.error    ?? errorCode;
      resetAt   = d.reset_at ?? null;
    } catch (_) {}
    const err         = new Error(errorCode);
    err.status        = res.status;
    err.needs_upgrade = (res.status === 429);
    err.reset_at      = resetAt;
    throw err;
  }

  return res.json();
}

// ── Subscription status cache ──────────────────────────────────────────────────
async function fetchAndCacheSubStatus() {
  const deviceId = await getDeviceId();
  if (!deviceId) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/subscription/status`, {
      headers: {
        'X-Device-ID':     deviceId,
        'X-Client-Secret': CLIENT_SECRET,
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    await chrome.storage.local.set({
      jobsift_sub: { ...data, cached_at: Date.now() }
    });
  } catch (_) {}
}

// ── Message routing ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Panel open gate ──────────────────────────────────────────────────────────
  if (msg.type === 'JS_PANEL_OPEN') {
    getDeviceId().then(async deviceId => {
      if (!deviceId) { sendResponse({ allowed: true }); return; }
      try {
        const res = await fetchWithTimeout(
          `${API_BASE_URL}/api/panel/open`,
          {
            method:  'POST',
            headers: {
              'Content-Type':    'application/json',
              'X-Device-ID':     deviceId,
              'X-Client-Secret': CLIENT_SECRET,
            },
            body: JSON.stringify({ jobId: msg.jobId || '' }),
          },
          BACKEND_TIMEOUT_MS
        );
        const data = await res.json();
        sendResponse(data);
      } catch (_) {
        sendResponse({ allowed: true }); // fail open
      }
    });
    return true;
  }

  // ── Email collection ───────────────────────────────────────────────────────
  if (msg.type === 'JS_SAVE_EMAIL') {
    const email = (msg.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      sendResponse({ ok: false, message: 'Invalid email address.' });
      return;
    }

    getDeviceId().then(async deviceId => {
      if (!deviceId) { sendResponse({ ok: false, message: 'Device ID not found.' }); return; }
      try {
        const res = await fetchWithTimeout(
          `${API_BASE_URL}/api/device/email`,
          {
            method:  'POST',
            headers: {
              'Content-Type':    'application/json',
              'X-Device-ID':     deviceId,
              'X-Client-Secret': CLIENT_SECRET,
            },
            body: JSON.stringify({ email }),
          },
          BACKEND_TIMEOUT_MS
        );
        const data = await res.json();
        sendResponse({ ok: res.ok, message: data.message || '' });
      } catch (_) {
        sendResponse({ ok: false, message: 'Network error — email not saved yet.' });
      }
    });
    return true;
  }

  if (msg.type === 'JS_PARSE_PROFILE') {
    callBackend('/api/profile/parse', { text: msg.text })
      .then(data => sendResponse({ ok: true, result: data.result }))
      .catch(e  => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'JS_BATCH_SCORE') {
    callBackend('/api/score/batch', { profile: msg.profile, jobs: msg.jobs })
      .then(data => sendResponse({ ok: true, results: data.results }))
      .catch(e  => sendResponse({
        ok:            false,
        error:         e.message,
        needs_upgrade: !!e.needs_upgrade,
        reset_at:      e.reset_at || null,
      }));
    return true;
  }

  if (msg.type === 'JS_ANALYZE_JOB') {
    callBackend('/api/analyze/job', {
      profile: msg.profile, jobData: msg.jobData, fullDescription: msg.fullDescription,
    })
      .then(data => sendResponse({ ok: true, result: data.result }))
      .catch(e  => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'JS_REFRESH_SUB_STATUS') {
    fetchAndCacheSubStatus()
      .then(() => chrome.storage.local.get('jobsift_sub', d =>
        sendResponse({ ok: true, data: d.jobsift_sub || null })
      ))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // ── Upgrade — open LemonSqueezy checkout directly ──────────────────────────
  // The checkout URL is built entirely in the extension. This works even when
  // the backend is down — no backend call is made for this flow at all.
  // The device_id is embedded as custom checkout data so the webhook can
  // match the payment back to this device after the user completes checkout.
  if (msg.type === 'JS_OPEN_UPGRADE') {
    getDeviceId().then(deviceId => {
      if (!deviceId) { sendResponse({ ok: false }); return; }

      const checkoutUrl =
        `https://${LS_STORE_SUBDOMAIN}.lemonsqueezy.com/checkout/buy/${LS_VARIANT_ID}` +
        `?checkout[custom][device_id]=${deviceId}`;

      chrome.tabs.create({ url: checkoutUrl });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'JS_RESTORE_SUBSCRIPTION') {
    const email = msg.email;
    if (!email) { sendResponse({ ok: false, message: 'Email required.' }); return; }

    getDeviceId().then(async deviceId => {
      if (!deviceId) { sendResponse({ ok: false, message: 'Device ID not found.' }); return; }
      try {
        const res = await fetchWithTimeout(
          `${API_BASE_URL}/api/subscription/restore`,
          {
            method:  'POST',
            headers: {
              'Content-Type':    'application/json',
              'X-Device-ID':     deviceId,
              'X-Client-Secret': CLIENT_SECRET,
            },
            body: JSON.stringify({ email }),
          },
          BACKEND_TIMEOUT_MS
        );
        const data = await res.json();
        if (!res.ok) { sendResponse({ ok: false, message: data.message || 'Restore failed.' }); return; }
        await fetchAndCacheSubStatus();
        const cached = await new Promise(r =>
          chrome.storage.local.get('jobsift_sub', d => r(d.jobsift_sub || null))
        );
        sendResponse({ ok: true, message: data.message, status: cached });
      } catch (err) {
        sendResponse({ ok: false, message: 'Network error — try again shortly.' });
      }
    });
    return true;
  }

  if (msg.type === 'SET_BADGE') {
    const n = msg.count || 0;
    chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: n > 0 ? '#16a34a' : '#94a3b8' });
    sendResponse({ ok: true });
    return;
  }
});