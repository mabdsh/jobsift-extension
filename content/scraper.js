// Rolevance Scraper v5.0
// Extracts job data from LinkedIn job cards — /jobs/search/ only.
// v2.1.0: added isDetailPage() + extractDetailPageData() for /jobs/view/ support.

(function () {
  'use strict';
  if (window._jsScraper) return;
  window._jsScraper = true;

  // Max characters of raw card/description text passed to the scorer and AI.
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

  // ── Detail page detection ──────────────────────────────────────────────────
  // Returns true on /jobs/view/123456/ URLs (direct open OR SPA navigation).
  function isDetailPage() {
    return /\/jobs\/view\/\d+/.test(window.location.pathname);
  }

  // ── Detail page data extraction ────────────────────────────────────────────
  // Uses only stable anchors that survive LinkedIn DOM class renames:
  //   - Job ID:       URL regex (most reliable possible source)
  //   - Title:        document.title (LinkedIn keeps this consistent)
  //   - Company:      document.title (same)
  //   - Description:  [data-testid="expandable-text-box"] (intentionally stable)
  //   - Work type:    rawText scan via existing detectWorkType()
  //   - Salary:       rawText scan via existing extractSalary()
  //   - Experience:   title + rawText via existing extractExperience()
  //   - Location:     best-effort paragraph scan; empty string on failure (non-scoring field)
  function extractDetailPageData() {
    try {
      // ── Job ID ─────────────────────────────────────────────────────────────
      const jobId = window.location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || '';

      // ── Title + company from document.title ────────────────────────────────
      // Format: "Sr Laravel Engineer - ByteCrew | LinkedIn"
      // Company names may contain dashes so only split on the FIRST " - ".
      const pageTitle = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
      const dashIdx   = pageTitle.indexOf(' - ');
      const title     = dashIdx > -1 ? pageTitle.slice(0, dashIdx).trim() : pageTitle;
      const company   = dashIdx > -1 ? pageTitle.slice(dashIdx + 3).trim() : '';

      // ── Full description ───────────────────────────────────────────────────
      // data-testid is a stable attribute that LinkedIn uses for its own tests
      // and avoids renaming during visual refactors. This is the best selector
      // available on the new obfuscated-class LinkedIn DOM.
      const descEl  = document.querySelector('[data-testid="expandable-text-box"]');
      const rawText = descEl
        ? descEl.textContent.replace(/\s+/g, ' ').trim().slice(0, RAW_TEXT_LIMIT)
        : (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, RAW_TEXT_LIMIT);

      // ── Work type — scan rawText, fall back to broader page scan ───────────
      const workType = detectWorkType(rawText)
                    || detectWorkType((document.body.innerText || '').slice(0, 3000));

      // ── Salary + experience — reuse search-page helpers verbatim ──────────
      const salary     = extractSalary(rawText);
      const experience = extractExperience(title + ' ' + rawText);

      // ── Location — best-effort, non-scoring, empty on failure ─────────────
      // LinkedIn renders a <p> element that contains the title text followed
      // by the city/country on the same line or next line. We extract the
      // portion after the title text from the first matching paragraph.
      let jobLocation = '';
      try {
        const lazyCol = document.querySelector('[data-component-type="LazyColumn"]');
        if (lazyCol && title) {
          const paras = Array.from(lazyCol.querySelectorAll('p')).slice(0, 30);
          for (const p of paras) {
            const text = p.textContent;
            if (text.includes(title)) {
              const afterTitle = text
                .slice(text.indexOf(title) + title.length)
                .replace(/\s+/g, ' ')
                .trim();
              // Accept as location if short, doesn't start with company name,
              // and doesn't look like a date/applicant count string.
              if (
                afterTitle &&
                afterTitle.length > 3 &&
                afterTitle.length < 80 &&
                !afterTitle.startsWith(company) &&
                !afterTitle.includes(' ago') &&
                !afterTitle.toLowerCase().includes('applied')
              ) {
                jobLocation = afterTitle;
              }
              break;
            }
          }
        }
      } catch (_) {}

      return { jobId, title, company, location: jobLocation, workType, salary, experience, rawText };
    } catch (_) {
      return { jobId: '', title: '', company: '', location: '', workType: null, salary: null, experience: null, rawText: '' };
    }
  }

  // ── Card helpers (unchanged from v2.0.1) ──────────────────────────────────

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
    if (t.includes('remote'))                                                                     return 'remote';
    if (t.includes('hybrid'))                                                                     return 'hybrid';
    if (t.includes('on-site') || t.includes('on site') || t.includes('onsite') || t.includes('in-person')) return 'onsite';
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

  function _emptyJobData() {
    return { jobId:'', title:'', company:'', location:'', workType:null, salary:null, experience:null, rawText:'' };
  }

  function extractJobData(card) {
    try {
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
      return _emptyJobData();
    }
  }

  // ── Indeed support ─────────────────────────────────────────────────────────
  // All selectors use data-testid or stable semantic class names, not the
  // obfuscated CSS-module class names that Indeed refreshes on deploys.

  function isIndeedPage() {
    return location.hostname.includes('indeed.com');
  }

  // Covers:
  //   /jobs, /jobs?q=...        — standard search pages
  //   /q-...-jobs.html          — category search pages
  //   / (homepage job feed)     — logged-in "Jobs for you" page
  //   any other Indeed path     — detected by presence of #mosaic-provider-jobcards
  //                               (stable ID present on ALL Indeed listing pages)
  // Using a DOM check as the catch-all is safe because content scripts run at
  // document_idle, so the DOM is fully loaded when this is first called.
  function isIndeedSearchPage() {
    if (!isIndeedPage()) return false;
    const p = location.pathname;
    if (p === '/jobs' || p.startsWith('/jobs') || /\/q-.*-jobs/.test(p)) return true;
    // Homepage and recommendation feeds — detect by the stable job card container
    return !!document.querySelector('#mosaic-provider-jobcards');
  }

  // /viewjob?jk=... — direct link to a single job
  function isIndeedDirectViewPage() {
    return isIndeedPage() && location.pathname === '/viewjob';
  }

  // A real Indeed job card must have a data-jk anchor and not be a hidden
  // duplicate (Indeed renders aria-hidden="true" clones for accessibility).
  function looksLikeIndeedCard(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!el.classList.contains('cardOutline')) return false;
    if (!el.querySelector('a[data-jk]')) return false;
    // Exclude hidden duplicate cards
    const li = el.closest('li');
    if (li && li.getAttribute('aria-hidden') === 'true') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function findAllIndeedCards() {
    return Array.from(document.querySelectorAll('div.cardOutline'))
      .filter(looksLikeIndeedCard);
  }

  function findIndeedCardsIn(root) {
    if (!root || root.nodeType !== 1) return [];
    const found = new Set();
    if (looksLikeIndeedCard(root)) found.add(root);
    root.querySelectorAll?.('div.cardOutline').forEach(el => {
      if (looksLikeIndeedCard(el)) found.add(el);
    });
    return Array.from(found);
  }

  // Converts an Indeed salary string like "Rs 40,000 - Rs 45,000 a month"
  // or "$50,000 - $70,000 a year" into our { low, high, midpoint } format.
  // Falls back to the generic extractSalary() for standard currency symbols.
  function extractIndeedSalary(text) {
    if (!text) return null;
    // Handle Pakistani rupee "Rs X,XXX" format
    const rsPat = /Rs\.?\s*([\d,]+)\s*[-–]\s*Rs\.?\s*([\d,]+)/i;
    const rsM   = text.match(rsPat);
    if (rsM) {
      const lo = parseFloat(rsM[1].replace(/,/g, ''));
      const hi = parseFloat(rsM[2].replace(/,/g, ''));
      return { low: lo, high: hi, midpoint: Math.round((lo + hi) / 2) };
    }
    // Fall through to generic extractor
    return extractSalary(text);
  }

  function extractIndeedJobData(card) {
    try {
      const anchor = card.querySelector('a[data-jk]');
      const jobId  = anchor?.dataset?.jk || '';

      // Title — prefer span[title] which is exactly the job title without markup
      const titleEl = card.querySelector('h2.jobTitle a span[title], a[data-jk] span[title]');
      const title   = titleEl?.title || titleEl?.textContent?.trim() || '';

      const companyEl = card.querySelector('[data-testid="company-name"]');
      const company   = companyEl?.textContent?.replace(/\s+/g, ' ').trim() || '';

      const locationEl = card.querySelector('[data-testid="text-location"]');
      const jobLocation = locationEl?.textContent?.replace(/\s+/g, ' ').trim() || '';

      // Salary — data-testid contains "salary-snippet" on the li wrapper
      const salaryEl  = card.querySelector('[data-testid*="salary-snippet"] span');
      const salaryTxt = salaryEl?.textContent?.trim() || '';

      // Raw text capped for scorer and AI
      const rawText = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, RAW_TEXT_LIMIT);

      const workType  = detectWorkType(jobLocation + ' ' + rawText);
      const salary    = extractIndeedSalary(salaryTxt) || extractIndeedSalary(rawText);
      const experience = extractExperience(title + ' ' + rawText);

      return { jobId, title, company, location: jobLocation, workType, salary, experience, rawText };
    } catch (_) {
      return { jobId: '', title: '', company: '', location: '', workType: null, salary: null, experience: null, rawText: '' };
    }
  }

  // Extracts job data from Indeed's right-pane detail view or direct /viewjob page.
  // Stable selectors only — no obfuscated CSS classes.
  function extractIndeedDetailData() {
    try {
      // Job ID — query param is the most reliable source
      const params = new URLSearchParams(location.search);
      const jobId  = params.get('jk') || params.get('vjk') || '';

      // Title — strip the "- job post" suffix Indeed appends
      const titleEl = document.querySelector(
        '#jobsearch-ViewjobPaneWrapper h2.jobsearch-JobInfoHeader-title span:first-child, ' +
        'h2.jobsearch-JobInfoHeader-title span:first-child'
      );
      const title = titleEl
        ? titleEl.textContent.replace(/[-–]\s*job post\s*$/i, '').trim()
        : document.title.replace(/\s*[|\-–].*$/i, '').trim();

      // Company name
      const companyEl = document.querySelector(
        '[data-testid="inlineHeader-companyName"] a, ' +
        '[data-company-name="true"] span a, ' +
        '[data-company-name="true"] span'
      );
      const company = companyEl?.textContent?.replace(/\s+/g, ' ').trim() || '';

      // Location
      const locationEl = document.querySelector(
        '[data-testid="inlineHeader-companyLocation"] div, ' +
        '[data-testid="inlineHeader-companyLocation"]'
      );
      const jobLocation = locationEl?.textContent?.replace(/\s+/g, ' ').trim() || '';

      // Full description — #jobDescriptionText is a stable ID on Indeed
      const descEl  = document.querySelector('#jobDescriptionText');
      const rawText = descEl
        ? descEl.textContent.replace(/\s+/g, ' ').trim().slice(0, RAW_TEXT_LIMIT)
        : (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, RAW_TEXT_LIMIT);

      // Salary from the job details panel
      const salaryEl  = document.querySelector('#salaryInfoAndJobType span');
      const salaryTxt = salaryEl?.textContent?.trim() || '';

      const workType  = detectWorkType(jobLocation + ' ' + rawText);
      const salary    = extractIndeedSalary(salaryTxt) || extractIndeedSalary(rawText);
      const experience = extractExperience(title + ' ' + rawText);

      return { jobId, title, company, location: jobLocation, workType, salary, experience, rawText };
    } catch (_) {
      return { jobId: '', title: '', company: '', location: '', workType: null, salary: null, experience: null, rawText: '' };
    }
  }

  // ── Exports ────────────────────────────────────────────────────────────────
  window.TITLE_SELECTORS          = TITLE_SELECTORS;
  window.findAllJobCards           = findAllJobCards;
  window.findJobCardsIn            = findJobCardsIn;
  window.extractJobData            = extractJobData;
  window.isDetailPage              = isDetailPage;
  window.extractDetailPageData     = extractDetailPageData;
  // Indeed
  window.isIndeedPage              = isIndeedPage;
  window.isIndeedSearchPage        = isIndeedSearchPage;
  window.isIndeedDirectViewPage    = isIndeedDirectViewPage;
  window.findAllIndeedCards        = findAllIndeedCards;
  window.findIndeedCardsIn         = findIndeedCardsIn;
  window.extractIndeedJobData      = extractIndeedJobData;
  window.extractIndeedDetailData   = extractIndeedDetailData;

}());