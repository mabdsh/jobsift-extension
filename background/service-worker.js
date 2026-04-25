// JobSift Service Worker v2.1.0
// Developer key — hidden from users. Get yours at https://console.groq.com

'use strict';

// ─── Replace this with your Groq key before deploying ─────────────────────────
const DEVELOPER_API_KEY = 'replaced';
// ──────────────────────────────────────────────────────────────────────────────

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_FAST    = 'llama-3.1-8b-instant';
const MODEL_SMART   = 'llama-3.3-70b-versatile';

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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await chrome.storage.local.set({ jobsift: DEFAULT_DATA });
});

// ── Routing ───────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'JS_PARSE_PROFILE') {
    parseProfile(msg.text)
      .then(r  => sendResponse({ ok:true, result:r }))
      .catch(e => sendResponse({ ok:false, error:e.message }));
    return true;
  }

  // Batch-score all visible cards in one shot
  if (msg.type === 'JS_BATCH_SCORE') {
    batchScoreJobs(msg.profile, msg.jobs)
      .then(r  => sendResponse({ ok:true, results:r }))
      .catch(e => sendResponse({ ok:false, error:e.message }));
    return true;
  }

  // Deep single-job analysis for the panel
  if (msg.type === 'JS_ANALYZE_JOB') {
    analyzeJob(msg.profile, msg.jobData, msg.fullDescription)
      .then(r  => sendResponse({ ok:true, result:r }))
      .catch(e => sendResponse({ ok:false, error:e.message }));
    return true;
  }

  if (msg.type === 'SET_BADGE') {
    const n = msg.count || 0;
    chrome.action.setBadgeText({ text: n>0 ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: n>0 ? '#16a34a' : '#94a3b8' });
    sendResponse({ ok:true });
    return;
  }
});

// ── Core API call ─────────────────────────────────────────────────────────────
async function callGroq(messages, model, maxTokens = 900) {
  if (!DEVELOPER_API_KEY || DEVELOPER_API_KEY.includes('REPLACE')) {
    throw new Error('NO_API_KEY: Set DEVELOPER_API_KEY in service-worker.js');
  }

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DEVELOPER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1,
      response_format: { type: 'json_object' } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('INVALID_KEY');
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(`API_ERROR_${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  try { return JSON.parse(text); }
  catch { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
}

// ── Batch score — one call for all visible cards ───────────────────────────────
async function batchScoreJobs(profile, jobs) {
  if (!jobs?.length) return [];

  const summary = buildProfileSummary(profile);

  // Compact job list — only what's on the card (no full JD yet)
  const jobLines = jobs.map((j, i) => {
    const salary = j.salary
      ? `$${fmtK(j.salary.low)}–$${fmtK(j.salary.high)}/yr`
      : 'salary not listed';
    const work = j.workType || 'work type unknown';
    return `${i+1}. [id:${j.jobId||i}] ${j.title||'Unknown'} at ${j.company||'Unknown'} · ${work} · ${salary}`;
  }).join('\n');

  const result = await callGroq([
    {
      role: 'system',
      content: `You are an expert recruiter scoring job-candidate fit. Be honest and calibrated.

Score guide: 85-100=exceptional, 70-84=strong, 50-69=reasonable, 30-49=weak, 0-29=poor.
Label rules: green≥75, amber 50-74, red <50.
Hard rules:
- If candidate's critical/must-have skills are absent from the job title: cap score at 55
- If job contains any candidate deal-breakers: score must be 0-15
- Generic titles (just "Software Engineer") with no tech stack visible: score 25-40 unless skills strongly align

Return ONLY valid JSON (no markdown):
{
  "results": [
    {"jobId":"<id>","score":<0-100>,"label":"<green|amber|red>","text":"<Exceptional fit|Strong match|Good match|Partial match|Weak fit|Poor fit>","verdict":"<one specific sentence>"},
    ...
  ]
}
Return one entry per job in the same order, no extra fields.`
    },
    {
      role: 'user',
      content: `CANDIDATE:\n${summary}\n\nJOBS TO SCORE:\n${jobLines}`
    }
  ], MODEL_SMART, Math.min(200 + jobs.length * 60, 1800));

  return result.results || [];
}

// ── Deep single-job analysis for panel ────────────────────────────────────────
async function analyzeJob(profile, jobData, fullDescription) {
  const summary  = buildProfileSummary(profile);
  const jobText  = [
    `Title: ${jobData.title || 'Unknown'}`,
    `Company: ${jobData.company || 'Unknown'}`,
    `Location: ${jobData.location || 'Not specified'}`,
    `Work type: ${jobData.workType || 'Not specified'}`,
    jobData.salary ? `Salary: $${fmtK(jobData.salary.low)}–$${fmtK(jobData.salary.high)}/yr` : 'Salary: Not listed',
    '',
    'Full job description:',
    (fullDescription || '(not available — scored from card data only)').slice(0, 3800),
  ].join('\n');

  return callGroq([
    {
      role: 'system',
      content: `You are a senior technical recruiter doing a deep evaluation. Be specific — name actual skills and requirements from the job.

Return ONLY valid JSON:
{
  "summary": "<2-3 sentences — specific assessment referencing actual skills/requirements>",
  "strengths": ["<2-4 specific matching strengths>"],
  "gaps": ["<1-3 actual gaps, [] if strong match>"],
  "tips": ["<2-3 actionable and specific application tips>"],
  "insights": "<one non-obvious observation about this role, team, or company>"
}`
    },
    {
      role: 'user',
      content: `CANDIDATE:\n${summary}\n\n---\n\n${jobText}`
    }
  ], MODEL_SMART, 900);
}

// ── Profile text → structured fields (auto-fill) ───────────────────────────────
async function parseProfile(text) {
  return callGroq([
    {
      role: 'system',
      content: `Extract job search preferences from this description.
Return ONLY valid JSON:
{
  "currentTitle":     "<role or ''>",
  "experienceYears":  <0-30>,
  "targetRoles":      ["<2-5 job titles>"],
  "workTypes":        ["<subset of: remote, hybrid, onsite>"],
  "jobTypes":         ["<subset of: full-time, contract, part-time>"],
  "minSalary":        <annual USD or 0>,
  "mustHaveSkills":   ["<2-4 absolutely critical hard skills — dealbreaker if absent>"],
  "primarySkills":    ["<expert-level hard skills>"],
  "secondarySkills":  ["<familiar but not expert>"],
  "dealBreakers":     ["<tech/domains strictly to avoid>"],
  "avoidIndustries":  ["<industries to avoid>"],
  "careerGoal":       "<1 sentence or ''>"
}
Rules: mustHaveSkills = 2-4 skills the person MUST see in the job. No soft skills anywhere. Use [] for anything not mentioned.`
    },
    { role: 'user', content: text }
  ], MODEL_FAST, 500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildProfileSummary(p) {
  if (!p) return 'No profile set';
  return [
    p.currentTitle     ? `Current role: ${p.currentTitle}` : '',
    p.experienceYears  ? `Experience: ${p.experienceYears} years` : '',
    p.targetRoles?.length     ? `Target roles: ${p.targetRoles.join(', ')}` : '',
    p.mustHaveSkills?.length  ? `CRITICAL skills (must appear): ${p.mustHaveSkills.join(', ')}` : '',
    p.primarySkills?.length   ? `Expert skills: ${p.primarySkills.join(', ')}` : '',
    p.secondarySkills?.length ? `Also know: ${p.secondarySkills.join(', ')}` : '',
    p.workTypes?.length  ? `Work preference: ${p.workTypes.join(', ')}` : '',
    p.minSalary > 1000   ? `Min salary: $${fmtK(p.minSalary)}/yr` : '',
    p.dealBreakers?.length    ? `Hard no: ${p.dealBreakers.join(', ')}` : '',
    p.avoidIndustries?.length ? `Avoid industries: ${p.avoidIndustries.join(', ')}` : '',
    p.careerGoal ? `Goal: ${p.careerGoal}` : '',
  ].filter(Boolean).join('\n');
}

function fmtK(n) {
  if (!n && n !== 0) return '?';
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
}
