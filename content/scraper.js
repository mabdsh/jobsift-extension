// JobSift Scraper v2.0.1
// Extracts job data from LinkedIn job cards — /jobs/search/ only.

(function () {
  'use strict';
  if (window._jsScraper) return;
  window._jsScraper = true;

  // Max characters of raw card text passed to the scorer and AI.
  // LinkedIn cards can contain hundreds of recommended jobs in their DOM
  // subtree — without a cap, rawText can exceed 50 KB per card and make
  // the batch scoring prompt enormous.
  const RAW_TEXT_LIMIT = 4000;

  const CARD_SELECTORS = [
    'li[data-occludable-job-id]',
    '[data-occludable-job-id]',
    'li[data-job-id]',
    'div[data-job-id]',
    'li.jobs-search-two-pane__job-card-wrapper',
    'li[class*="jobs-search-two-pane"]',
    'li.artdeco-list__item',
    'li.occludable-update',
    'li.jobs-search-results__list-item',
    'li.scaffold-layout__list-item',
    'li[class*="job-card"]',
    '.job-card-container--clickable',
  ];

  const TITLE_SELECTORS = [
    'a.job-card-list__title--link',
    '[class*="job-card-list__title"]',
    'a.job-card-container__link',
    'a[class*="job-card-container__link"]',
    'a[href*="/jobs/view/"]',
    'a[href*="currentJobId"]',
    '.artdeco-entity-lockup__title a',
    'h3 a', 'h2 a', 'h3', 'h2',
  ];

  const COMPANY_SELECTORS = [
    '.job-card-container__company-name',
    '.job-card-container__primary-description',
    '[class*="company-name"]',
    '[class*="primary-description"]',
    '.artdeco-entity-lockup__subtitle span',
  ];

  const METADATA_SELECTORS = [
    '.job-card-container__metadata-item',
    '[class*="metadata-item"]',
    '.artdeco-entity-lockup__caption li',
    '.job-card-container__metadata-wrapper li',
  ];

  const SALARY_SELECTORS = [
    '[class*="salary"]',
    '[class*="compensation"]',
    '.job-card-container__salary-info',
  ];

  // ── CRITICAL: require an actual job link, not just data attributes.
  // LinkedIn "occludes" (empties) cards when off-screen but keeps the <li>
  // with its data-occludable-job-id. Without this check we process empty
  // shells and inject floating orphan badges.
  function looksLikeJobCard(el) {
    if (!el || el.nodeType !== 1) return false;
    return !!el.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
  }

  function dedupe(arr) {
    return arr.filter(c => !arr.some(o => o !== c && o.contains(c)));
  }

  function findAllJobCards() {
    for (const sel of CARD_SELECTORS) {
      try {
        const nodes   = Array.from(document.querySelectorAll(sel)).filter(looksLikeJobCard);
        const deduped = dedupe(nodes);
        if (deduped.length > 0) return deduped;
      } catch (_) {}
    }
    // Link-based fallback
    try {
      const seen       = new Set();
      const candidates = [];
      document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]').forEach(a => {
        if (a.querySelector('.js-badge')) return;
        const card = findCardAncestor(a);
        if (card && !seen.has(card) && looksLikeJobCard(card)) {
          seen.add(card);
          candidates.push(card);
        }
      });
      return dedupe(candidates);
    } catch (_) {}
    return [];
  }

  function findCardAncestor(linkEl) {
    let el = linkEl.parentElement;
    for (let depth = 0; depth < 10 && el; depth++) {
      const tag = el.tagName;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (tag === 'LI' || tag === 'ARTICLE') return el;
      if (tag === 'DIV' && (el.dataset.jobId || el.dataset.occludableJobId ||
          cls.includes('job-card') || cls.includes('artdeco-entity-lockup'))) return el;
      if (['MAIN','SECTION','NAV','HEADER','BODY','HTML'].includes(tag)) break;
      el = el.parentElement;
    }
    return null;
  }

  function findJobCardsIn(root) {
    if (!root || root.nodeType !== 1) return [];
    const found = new Set();
    if (looksLikeJobCard(root)) found.add(root);
    for (const sel of CARD_SELECTORS) {
      try {
        root.querySelectorAll?.(sel).forEach(el => {
          if (looksLikeJobCard(el)) found.add(el);
        });
      } catch (_) {}
      if (found.size > 0) break;
    }
    if (found.size === 0) {
      root.querySelectorAll?.('a[href*="/jobs/view/"], a[href*="currentJobId="]').forEach(a => {
        const card = findCardAncestor(a);
        if (card && looksLikeJobCard(card)) found.add(card);
      });
    }
    return dedupe(Array.from(found));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function firstText(root, sels) {
    for (const sel of sels) {
      try { const el = root.querySelector(sel); if (el?.textContent.trim()) return el; } catch (_) {}
    }
    return null;
  }
  function clean(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function detectWorkType(text) {
    if (!text) return null;
    const t = text.toLowerCase();
    if (t.includes('remote'))                                                           return 'remote';
    if (t.includes('hybrid'))                                                           return 'hybrid';
    if (t.includes('on-site')||t.includes('on site')||t.includes('onsite')||t.includes('in-person')) return 'onsite';
    return null;
  }

  function extractSalary(text) {
    if (!text) return null;
    const pats = [
      /[\$£€]\s*(\d[\d,]*)\s*[kK]?\s*[-–—]+\s*[\$£€]?\s*(\d[\d,]*)\s*[kK]?/,
      /[\$£€]\s*(\d[\d,]*)\s*[kK]/,
      /(\d[\d,]+)\s*(?:per year|\/year|\/yr|annually)/i,
    ];
    for (const pat of pats) {
      const m = text.match(pat);
      if (!m) continue;
      let lo = parseFloat(m[1].replace(/,/g,''));
      let hi = m[2] ? parseFloat(m[2].replace(/,/g,'')) : lo;
      if (/\d\s*[kK]/.test(text)) { if (lo<1000) lo*=1000; if (hi<1000) hi*=1000; }
      return { low: lo, high: hi, midpoint: Math.round((lo+hi)/2) };
    }
    return null;
  }

  function extractExperience(text) {
    if (!text) return null;
    const explicit = [
      /(\d+)\s*(?:to|[-–])\s*(\d+)\s*\+?\s*years?/i,
      /(\d+)\s*\+\s*years?/i,
      /(\d+)\s*years?\s*(?:of\s+)?(?:experience|exp)/i,
    ];
    for (const pat of explicit) {
      const m = text.match(pat);
      if (!m) continue;
      const min = parseInt(m[1], 10);
      const max = m[2] ? parseInt(m[2], 10) : Math.min(min+3, min*2);
      return { min, max, source: 'explicit' };
    }
    const seniority = [
      { pat: /\b(internship|intern)\b/i, min:0, max:1 },
      { pat: /\bentry[\s-]level\b/i,     min:0, max:2 },
      { pat: /\bjunior\b|\bjr\.?\b/i,    min:0, max:3 },
      { pat: /\bassociate\b/i,           min:1, max:4 },
      { pat: /\bmid[\s-]?senior\b/i,     min:4, max:8 },
      { pat: /\bsenior\b|\bsr\.?\b/i,    min:4, max:10 },
      { pat: /\bstaff\b/i,               min:6, max:12 },
      { pat: /\bprincipal\b/i,           min:8, max:15 },
      { pat: /\blead\b/i,                min:5, max:12 },
      { pat: /\bdirector\b/i,            min:8, max:20 },
      { pat: /\bvp\b|\bvice\s+president\b/i, min:10, max:20 },
    ];
    for (const { pat, min, max } of seniority) {
      if (pat.test(text)) return { min, max, source: 'seniority' };
    }
    return null;
  }

  // Minimal safe object returned when extraction completely fails for a card.
  // This lets the rest of the pipeline (scorer, injector) handle it gracefully
  // instead of throwing or leaving the card with a stuck loading badge.
  function _emptyJobData() {
    return { jobId:'', title:'', company:'', location:'', workType:null, salary:null, experience:null, rawText:'' };
  }

  function extractJobData(card) {
    // Wrap the entire extraction in try/catch.
    // A single malformed card (e.g. detached from DOM mid-parse, unexpected
    // LinkedIn DOM shape) must not abort the whole batch.
    try {
      // Cap rawText: card.textContent can be very large on paginated lists
      // because LinkedIn reuses DOM nodes and may leave hidden job data inside.
      // 4 KB is more than enough for skill matching; the full JD is fetched
      // separately in the deep analysis flow.
      const rawText  = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, RAW_TEXT_LIMIT);
      const titleEl  = firstText(card, TITLE_SELECTORS);
      const title    = clean(titleEl);
      const jobUrl   = titleEl?.href || '';
      const jobId    = card.dataset.occludableJobId ||
                       card.dataset.jobId           ||
                       jobUrl.match(/\/jobs\/view\/(\d+)/)?.[1]  ||
                       jobUrl.match(/currentJobId=(\d+)/)?.[1]   || '';

      const company  = clean(firstText(card, COMPANY_SELECTORS));

      let metaEls = [];
      for (const sel of METADATA_SELECTORS) {
        try { const els = card.querySelectorAll(sel); if (els.length) { metaEls = [...els]; break; } } catch (_) {}
      }
      const metaTexts = metaEls.map(clean);

      let workType = null;
      for (const t of metaTexts) { workType = detectWorkType(t); if (workType) break; }
      if (!workType) workType = detectWorkType(rawText);

      const location = metaTexts.find(t => !detectWorkType(t) && t.length > 2) || '';

      let salary = extractSalary(clean(firstText(card, SALARY_SELECTORS)));
      if (!salary) for (const t of metaTexts) { salary = extractSalary(t); if (salary) break; }
      if (!salary) salary = extractSalary(rawText);

      const experience = extractExperience(title + ' ' + rawText);

      return { jobId, title, company, location, workType, salary, experience, rawText };
    } catch (_) {
      // Return a safe empty object — the scorer will return a null-score gray
      // badge, and the panel will tell the user the profile needs completing.
      return _emptyJobData();
    }
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  window.TITLE_SELECTORS = TITLE_SELECTORS;
  window.findAllJobCards  = findAllJobCards;
  window.findJobCardsIn   = findJobCardsIn;
  window.extractJobData   = extractJobData;

}());