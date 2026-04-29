// JobSift Tracker v1.0.0
// Manages the job application pipeline stored in chrome.storage.local.
// Runs as a content script on LinkedIn and Indeed — exports window.jsTracker
// for use by panel.js and injector.js in the same page context.

(function () {
  'use strict';
  if (window._jsTracker) return;
  window._jsTracker = true;

  const TRACKER_KEY = 'jobsift_tracker';
  const MAX_ENTRIES = 500;

  // ── Storage helpers ────────────────────────────────────────────────────────
  function _load() {
    return new Promise(r =>
      chrome.storage.local.get(TRACKER_KEY, d => r(d[TRACKER_KEY] || {}))
    );
  }

  function _persist(data) {
    return new Promise(r =>
      chrome.storage.local.set({ [TRACKER_KEY]: data }, r)
    );
  }

  // ── Entry builder ──────────────────────────────────────────────────────────
  // Constructs the canonical URL from jobId + platform so it's preserved even
  // if the original posting is later taken down from the search results.
  function _buildEntry(jobData, result) {
    const now      = Date.now();
    const onIndeed = location.hostname.includes('indeed.com');
    const jobId    = jobData.jobId || `js_${now}`;

    let url = '';
    if (jobData.jobId) {
      url = onIndeed
        ? `https://${location.hostname}/viewjob?jk=${jobData.jobId}`
        : `https://www.linkedin.com/jobs/view/${jobData.jobId}/`;
    }

    return {
      jobId,
      platform:  onIndeed ? 'indeed' : 'linkedin',
      title:     jobData.title    || '',
      company:   jobData.company  || '',
      location:  jobData.location || '',
      url,
      score:     result?.score ?? null,
      label:     result?.label  || 'gray',
      status:    'saved',   // always starts here
      savedAt:   now,
      updatedAt: now,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // Save a job. Idempotent — silently returns the existing entry if already saved.
  // Prunes the oldest entry if MAX_ENTRIES is reached before inserting.
  async function saveJob(jobData, result) {
    const data = await _load();

    if (data[jobData.jobId]) return data[jobData.jobId]; // already saved

    const entries = Object.values(data);
    if (entries.length >= MAX_ENTRIES) {
      const oldest = entries.sort((a, b) => a.savedAt - b.savedAt)[0];
      delete data[oldest.jobId];
    }

    const entry = _buildEntry(jobData, result);
    data[entry.jobId] = entry;
    await _persist(data);
    return entry;
  }

  // Returns true if the jobId is already in the tracker.
  async function isJobSaved(jobId) {
    if (!jobId) return false;
    const data = await _load();
    return !!data[jobId];
  }

  // Update the status of a tracked job.
  async function updateStatus(jobId, status) {
    const data = await _load();
    if (!data[jobId]) return;
    data[jobId].status    = status;
    data[jobId].updatedAt = Date.now();
    await _persist(data);
  }

  // Remove a job from the tracker permanently.
  async function deleteJob(jobId) {
    const data = await _load();
    delete data[jobId];
    await _persist(data);
  }

  // Total number of tracked jobs.
  async function getCount() {
    const data = await _load();
    return Object.keys(data).length;
  }

  window.jsTracker = { saveJob, isJobSaved, updateStatus, deleteJob, getCount };

}());
