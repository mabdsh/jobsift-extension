// JobSift Service Worker v3.1.0 — with subscription status caching

'use strict';

const API_BASE_URL  = 'http://localhost:3000'; // replace with your DuckDNS URL
const CLIENT_SECRET = '6fc521c67954cc87dee87f91b8def0811149c094b4f87594805485a1f40f8898';

// How long to cache the subscription status before re-fetching (ms)
const SUB_STATUS_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_DATA = {
  profile: {
    description: '', currentTitle: '', experienceYears: 0,
    targetRoles: [], mustHaveSkills: [], primarySkills: [],
    secondarySkills: [], workTypes: [], jobTypes: ['full-time'],
    minSalary: 0, dealBreakers: [], avoidIndustries: [], careerGoal: '',
  }
};

// ── Install — generate device ID ───────────────────────────────────────────────
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
  // Fetch subscription status immediately after install
  fetchAndCacheSubStatus();
});

// ── Hourly alarm — refresh subscription status ─────────────────────────────────
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

// ── Core backend call ──────────────────────────────────────────────────────────
async function callBackend(endpoint, body) {
  const deviceId = await getDeviceId();
  if (!deviceId) throw new Error('NO_DEVICE_ID');

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Device-ID':     deviceId,
      'X-Client-Secret': CLIENT_SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorCode = `API_ERROR_${res.status}`;
    try { const d = await res.json(); errorCode = d.error ?? errorCode; } catch (_) {}
    const err = new Error(errorCode);
    err.status = res.status;
    // Attach needs_upgrade flag so the content script can show the upgrade UI
    err.needs_upgrade = (res.status === 429);
    throw err;
  }

  return res.json();
}

// ── Fetch and cache subscription status ────────────────────────────────────────
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
    // Store with a timestamp so the popup can check freshness
    await chrome.storage.local.set({
      jobsift_sub: { ...data, cached_at: Date.now() }
    });
  } catch (_) {
    // Network failure — keep existing cached data, popup will use it
  }
}

// ── Message routing ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'JS_PARSE_PROFILE') {
    callBackend('/api/profile/parse', { text: msg.text })
      .then(data => sendResponse({ ok: true, result: data.result }))
      .catch(e  => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'JS_BATCH_SCORE') {
    callBackend('/api/score/batch', { profile: msg.profile, jobs: msg.jobs })
      .then(data => sendResponse({ ok: true, results: data.results }))
      .catch(e  => sendResponse({ ok: false, error: e.message, needs_upgrade: !!e.needs_upgrade }));
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
    // Popup requests a fresh status fetch (e.g. after restore)
    fetchAndCacheSubStatus()
      .then(() => chrome.storage.local.get('jobsift_sub', d => sendResponse({ ok: true, data: d.jobsift_sub || null })))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // Open the /upgrade page in a new tab.
  // Popup delegates this to the service worker so it never needs to know
  // the backend URL or have any hardcoded URLs itself.
  if (msg.type === 'JS_OPEN_UPGRADE') {
    getDeviceId().then(deviceId => {
      if (deviceId) {
        chrome.tabs.create({ url: `${API_BASE_URL}/upgrade?device=${deviceId}` });
      }
      sendResponse({ ok: !!deviceId });
    });
    return true;
  }

  // Restore subscription by email — calls the backend and then refreshes cache.
  // Returns { ok, status, message } so popup can update UI immediately.
  if (msg.type === 'JS_RESTORE_SUBSCRIPTION') {
    const email = msg.email;
    if (!email) { sendResponse({ ok: false, message: 'Email required.' }); return; }

    getDeviceId().then(async deviceId => {
      if (!deviceId) { sendResponse({ ok: false, message: 'Device ID not found.' }); return; }

      try {
        const res = await fetch(`${API_BASE_URL}/api/subscription/restore`, {
          method: 'POST',
          headers: {
            'Content-Type':    'application/json',
            'X-Device-ID':     deviceId,
            'X-Client-Secret': CLIENT_SECRET,
          },
          body: JSON.stringify({ email }),
        });

        const data = await res.json();

        if (!res.ok) {
          sendResponse({ ok: false, message: data.message || 'Restore failed.' });
          return;
        }

        // Refresh the cached status so popup shows Pro immediately
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
