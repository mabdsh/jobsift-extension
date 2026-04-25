// JobSift Service Worker v3.0.0
// Backend proxy edition — Groq key stays on the server, never in the extension.

'use strict';

// ── Backend config ─────────────────────────────────────────────────────────────
// Replace YOUR_SUBDOMAIN with your actual DuckDNS subdomain.
// Must match what you deployed on Oracle Cloud.
const API_BASE_URL  = 'http://localhost:3000'; // no trailing slash — endpoints start with /

// Must exactly match CLIENT_SECRET in your backend .env file.
// This is the shared secret that proves the request came from this extension.
const CLIENT_SECRET = '6fc521c67954cc87dee87f91b8def0811149c094b4f87594805485a1f40f8898';

// ── Default profile ────────────────────────────────────────────────────────────
const DEFAULT_DATA = {
  profile: {
    description:      '',
    currentTitle:     '',
    experienceYears:  0,
    targetRoles:      [],
    mustHaveSkills:   [],
    primarySkills:    [],
    secondarySkills:  [],
    workTypes:        [],
    jobTypes:         ['full-time'],
    minSalary:        0,
    dealBreakers:     [],
    avoidIndustries:  [],
    careerGoal:       '',
  }
};

// ── Install — generate device ID ───────────────────────────────────────────────
// A UUID is created once per extension install and stored in chrome.storage.local.
// It's sent with every backend request as the user's anonymous identity.
// If the extension was already installed (upgrade from v2), we preserve the
// existing profile data and just add the missing deviceId.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const existing = await new Promise(r =>
    chrome.storage.local.get('jobsift', d => r(d.jobsift || null))
  );

  if (reason === 'install' || !existing) {
    // Fresh install — full default data + new device ID
    await chrome.storage.local.set({
      jobsift: { ...DEFAULT_DATA, deviceId: crypto.randomUUID() }
    });
  } else if (!existing.deviceId) {
    // Existing install upgrading from v2 — keep profile, add device ID
    await chrome.storage.local.set({
      jobsift: { ...existing, deviceId: crypto.randomUUID() }
    });
  }
  // If deviceId already exists (extension reload/update), do nothing
});

// ── Device ID helper ───────────────────────────────────────────────────────────
async function getDeviceId() {
  return new Promise(resolve => {
    chrome.storage.local.get('jobsift', d => resolve(d.jobsift?.deviceId ?? null));
  });
}

// ── Core backend call ──────────────────────────────────────────────────────────
// All three API functions funnel through here.
// Throws typed errors so callers can distinguish rate limits from server errors.
async function callBackend(endpoint, body) {
  const deviceId = await getDeviceId();

  if (!deviceId) {
    // Shouldn't happen after install, but handle gracefully
    throw new Error('NO_DEVICE_ID');
  }

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Device-ID':     deviceId,
      'X-Client-Secret': CLIENT_SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorCode = `API_ERROR_${res.status}`;
    try {
      const data = await res.json();
      errorCode = data.error ?? errorCode;
    } catch (_) {}

    // Throw with a code the message handlers can inspect
    const err = new Error(errorCode);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// ── Routing ────────────────────────────────────────────────────────────────────
// Message handler shape is IDENTICAL to v2 — content scripts never know
// that requests now go to the backend instead of Groq directly.
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
      .catch(e  => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'JS_ANALYZE_JOB') {
    callBackend('/api/analyze/job', {
      profile:         msg.profile,
      jobData:         msg.jobData,
      fullDescription: msg.fullDescription,
    })
      .then(data => sendResponse({ ok: true, result: data.result }))
      .catch(e  => sendResponse({ ok: false, error: e.message }));
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