// Rolevance Scorer v5.2
// v5.2: Fixed denominator bug in scoreSkills — primary skills no longer penalise
//       score when unmatched. Role category matching added. missingCritical
//       penalty reduced -18→-8. Label thresholds aligned: green≥70.

(function () {
  'use strict';
  if (window._jsScorer) return;
  window._jsScorer = true;

  // ── Alias table ───────────────────────────────────────────────────────────
  const ALIASES = {
    'javascript':    ['javascript','js','ecmascript','es6','es2020','vanilla js'],
    'typescript':    ['typescript','ts'],
    'react':         ['react','reactjs','react.js','react native','react hooks'],
    'vue':           ['vue','vuejs','vue.js','vue3'],
    'angular':       ['angular','angularjs','angular.js'],
    'svelte':        ['svelte','sveltekit'],
    'next.js':       ['next','nextjs','next.js'],
    'nuxt':          ['nuxt','nuxtjs','nuxt.js'],
    'node.js':       ['node','nodejs','node.js','express','expressjs'],
    'php':           ['php','php7','php8'],
    'laravel':       ['laravel','lumen'],
    'wordpress':     ['wordpress','wp','woocommerce'],
    'django':        ['django','drf','django rest framework'],
    'fastapi':       ['fastapi','fast api'],
    'flask':         ['flask'],
    'python':        ['python','python3','py'],
    'java':          ['java','java 8','java 11','java 17','jvm'],
    'spring':        ['spring','spring boot','springboot'],
    'kotlin':        ['kotlin'],
    'swift':         ['swift','swiftui','objective-c'],
    'c#':            ['c#','csharp','c sharp','.net','dotnet','asp.net','blazor'],
    'c++':           ['c++','cpp'],
    'go':            ['go','golang','go lang'],
    'rust':          ['rust','rustlang'],
    'ruby':          ['ruby','rails','ruby on rails'],
    'sql':           ['sql','mysql','postgresql','postgres','mssql','sql server','mariadb','sqlite'],
    'mongodb':       ['mongodb','mongo','mongoose'],
    'redis':         ['redis','elasticache'],
    'elasticsearch': ['elasticsearch','elastic','opensearch','elk stack'],
    'graphql':       ['graphql','gql','apollo'],
    'rest':          ['rest','restful','rest api'],
    'docker':        ['docker','dockerfile','docker-compose','containerization'],
    'kubernetes':    ['kubernetes','k8s','helm'],
    'aws':           ['aws','amazon web services','ec2','s3','lambda','rds','cloudformation'],
    'azure':         ['azure','microsoft azure','azure devops'],
    'gcp':           ['gcp','google cloud','bigquery','cloud run','firebase'],
    'terraform':     ['terraform','infrastructure as code'],
    'ci/cd':         ['ci/cd','cicd','jenkins','github actions','gitlab ci','circle ci'],
    'git':           ['git','github','gitlab','bitbucket'],
    'linux':         ['linux','ubuntu','debian','centos','bash','shell scripting'],
    'kafka':         ['kafka','rabbitmq','message queue','pub/sub','sqs'],
    'tailwind':      ['tailwind','tailwindcss'],
    'webpack':       ['webpack','vite','parcel','rollup'],
    'jest':          ['jest','mocha','jasmine','pytest','junit','unit tests'],
    'agile':         ['agile','scrum','kanban','jira'],
    'microservices': ['microservices','distributed systems'],
  };

  // ── Reverse alias map — built ONCE at init, O(1) lookup per keyword ───────
  // Maps every alias string → the full alias array for its group.
  // e.g. 'js' → ['javascript','js','ecmascript','es6','es2020','vanilla js']
  //
  // Before: matchKeyword scanned all Object.values(ALIASES) (~60 groups) for
  // every skill check. With 25 cards × 15 skills × 60 groups = 22,500 iterations.
  // After: single Map.get() call per skill = 25 × 15 = 375 lookups total.
  const _ALIAS_MAP = new Map();
  for (const aliases of Object.values(ALIASES)) {
    for (const a of aliases) {
      _ALIAS_MAP.set(a, aliases);
    }
  }

  const SENIORITY = [
    { pat: /\b(intern|internship)\b/i,     min:0,  max:1,  label:'Internship'  },
    { pat: /\bentry[\s-]level\b/i,         min:0,  max:2,  label:'Entry level' },
    { pat: /\bjunior\b|\bjr\.?\b/i,        min:0,  max:3,  label:'Junior'      },
    { pat: /\bassociate\b/i,               min:1,  max:4,  label:'Associate'   },
    { pat: /\bmid[\s-]?level\b/i,          min:3,  max:6,  label:'Mid-level'   },
    { pat: /\bmid[\s-]?senior\b/i,         min:4,  max:8,  label:'Mid-Senior'  },
    { pat: /\bsenior\b|\bsr\.?\b/i,        min:4,  max:10, label:'Senior'      },
    { pat: /\bstaff\b/i,                   min:6,  max:12, label:'Staff'       },
    { pat: /\bprincipal\b|\barchitect\b/i, min:8,  max:16, label:'Principal'   },
    { pat: /\blead\b/i,                    min:5,  max:12, label:'Lead'        },
    { pat: /\bdirector\b/i,               min:8,  max:20, label:'Director'    },
    { pat: /\bvp\b|\bvice\s+president\b/i, min:10, max:20, label:'VP'          },
  ];

  // ── Word-boundary match ───────────────────────────────────────────────────
  function wordMatch(term, text) {
    try {
      return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(text);
    } catch { return text.toLowerCase().includes(term.toLowerCase()); }
  }

  // Hybrid: word-boundary for pure-word keywords, substring for special chars
  function matchKeyword(kw, titleText, bodyText) {
    const k = kw.toLowerCase().trim();
    const t = titleText.toLowerCase();
    const b = bodyText.toLowerCase();
    const isWord = /^\w+$/.test(k);
    const hit = (term, text) => isWord ? wordMatch(term, text) : text.includes(term);

    // Direct match first — the common case, no alias lookup needed
    if (hit(k, t)) return { matched: true, inTitle: true,  via: null };
    if (hit(k, b)) return { matched: true, inTitle: false, via: null };

    // O(1) reverse map lookup — single call to get this keyword's alias group
    const groupAliases = _ALIAS_MAP.get(k);
    if (groupAliases) {
      for (const a of groupAliases) {
        if (a === k) continue;
        const aIsWord = /^\w+$/.test(a);
        const aHit = (text) => aIsWord ? wordMatch(a, text) : text.includes(a);
        if (aHit(t)) return { matched: true, inTitle: true,  via: a };
        if (aHit(b)) return { matched: true, inTitle: false, via: a };
      }
    }

    return { matched: false, inTitle: false, via: null };
  }

  function yearsToRange(y) {
    if (!y || y <= 0) return null;
    if (y <= 1)  return { min:0,  max:2  };
    if (y <= 2)  return { min:1,  max:3  };
    if (y <= 4)  return { min:2,  max:5  };
    if (y <= 6)  return { min:3,  max:7  };
    if (y <= 8)  return { min:5,  max:10 };
    if (y <= 12) return { min:7,  max:14 };
    return              { min:10, max:25 };
  }

  function fmtK(n) {
    if (!n && n !== 0) return '?';
    return n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRITERIA
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Technical skills — 35%
  //
  // Key design principles:
  //   Critical skills: scored independently as a proportion (critMatched / critical.length)
  //   Primary skills:  positive matches only — missing ones do NOT penalise.
  //                    Benchmark = min(4, primary.length) so having 10 skills
  //                    doesn't make you score worse than having 4.
  //   Secondary:       small bonus only, never negative
  //   Title hits:      bonus for skills appearing in the job title itself
  //
  //   Old bug: (critMatched*1.4 + primMatched) / (critical.length + primary.length)
  //   A dev with 2 critical (both match) + 7 primary (0 match in card snippet)
  //   scored 2.8/9 = 0.31 (PARTIAL) — completely wrong for a perfect critical match.
  function scoreSkills(jobTitle, jobRaw, critical, primary, secondary) {
    const hasAny = critical.length || primary.length || secondary.length;
    if (!hasAny) return _unknown('Technical skills', 35, 'Add skills to your profile — this drives 35% of every score');

    // Secondary-only profile: low confidence but still useful
    if (!critical.length && !primary.length) {
      const secHits = secondary.filter(kw => matchKeyword(kw, jobTitle, jobRaw).matched);
      const value   = secHits.length ? Math.min(0.45, secHits.length / secondary.length) : 0;
      return { name:'Technical skills', status: value >= 0.2 ? 'partial' : 'unknown',
        value, weight:35, note:'Only secondary skills set — add primary skills for accurate scoring',
        verdict:null, matched:[], missing:[], missingCritical:[] };
    }

    // ── Critical skills — each missing one is a meaningful signal ──────────
    const critResults    = critical.map(kw => ({ kw, ...matchKeyword(kw, jobTitle, jobRaw) }));
    const critMatchedN   = critResults.filter(r => r.matched).length;
    const missingCritical = critResults.filter(r => !r.matched).map(r => r.kw);
    // Proportion of critical skills found — 0 to 1
    const critScore      = critical.length > 0 ? critMatchedN / critical.length : 1.0;

    // ── Primary skills — reward matches, don't punish for large skill sets ──
    // A candidate with 10 listed skills shouldn't be penalised because this one
    // job only mentions 3 of them. Use a benchmark of min(4, primary.length)
    // so matching 3-4 primary skills = full primary score.
    const primResults  = primary.map(kw => ({ kw, ...matchKeyword(kw, jobTitle, jobRaw) }));
    const primMatched  = primResults.filter(r => r.matched);
    const primMissing  = primResults.filter(r => !r.matched);
    const primBenchmark = Math.min(4, primary.length);
    const primScore    = primary.length > 0
      ? Math.min(1, primMatched.length / primBenchmark)
      : 1.0; // no primary configured → don't penalise

    // ── Secondary skills — small bonus only ────────────────────────────────
    const secHits  = secondary.filter(kw => matchKeyword(kw, jobTitle, jobRaw).matched);
    const secBonus = Math.min(0.07, secHits.length * 0.025);

    // ── Title-hit bonus — skill in job title = strong confirmation signal ──
    const allMatchedResults = [...critResults.filter(r=>r.matched), ...primMatched];
    const titleHits = allMatchedResults.filter(r => r.inTitle);
    const titleBonus = Math.min(0.08, titleHits.length * 0.04);

    // ── Combine ─────────────────────────────────────────────────────────────
    // If both critical and primary configured: weight 60/35 split.
    // If only one type configured: that type carries 90% of the value.
    let value;
    if (critical.length > 0 && primary.length > 0) {
      value = critScore * 0.60 + primScore * 0.35;
    } else if (critical.length > 0) {
      value = critScore * 0.90;
    } else {
      value = primScore * 0.90;
    }
    value = Math.min(1, value + secBonus + titleBonus);

    // ── Status thresholds — realistic for card-data partial visibility ──────
    let status;
    if (value >= 0.58) status = 'pass';
    else if (value >= 0.27) status = 'partial';
    else status = 'fail';

    // ── Note ────────────────────────────────────────────────────────────────
    const noteparts = [];
    if (critMatchedN === critical.length && critical.length)
      noteparts.push(`All ${critical.length} critical skills found`);
    else if (missingCritical.length)
      noteparts.push(`Missing critical: ${missingCritical.join(', ')}`);
    if (primMatched.length) noteparts.push(`${primMatched.length}/${primary.length} primary matched`);
    if (titleHits.length)   noteparts.push(`${titleHits.length} in job title`);

    return {
      name:'Technical skills', status, value, weight:35,
      note: noteparts.join(' · ') || 'No skill overlap found',
      verdict: status==='pass' ? 'Strong match' : status==='partial' ? 'Partial match' : 'Skills gap',
      matched: allMatchedResults.map(r => ({kw:r.kw, inTitle:r.inTitle, via:r.via})),
      missing: [...missingCritical, ...primMissing.map(r=>r.kw)],
      missingCritical,
    };
  }

  // ── Role categories — semantic groupings for related-title matching ─────────
  // Prevents "Backend Engineer" from failing against "Software Engineer" target.
  // When job title and target role share a category → treat as related role (partial+).
  const ROLE_CATEGORIES = [
    ['software engineer','developer','programmer','engineer','swe','sde'],
    ['backend','back-end','server','api developer','php developer','laravel developer',
     'node developer','python developer','java developer','ruby developer','golang developer'],
    ['frontend','front-end','ui developer','web developer','react developer',
     'vue developer','angular developer','javascript developer'],
    ['full stack','fullstack','full-stack'],
    ['devops','sre','platform engineer','cloud engineer','infrastructure'],
    ['mobile','android','ios','flutter developer','react native'],
    ['data engineer','data scientist','ml engineer','machine learning','ai engineer','data analyst'],
    ['qa','quality assurance','test engineer','sdet','automation engineer','qa engineer'],
    ['product manager','product owner','pm','product lead'],
  ];

  function sameRoleCategory(a, b) {
    const al = a.toLowerCase(); const bl = b.toLowerCase();
    return ROLE_CATEGORIES.some(cat =>
      cat.some(t => al.includes(t)) && cat.some(t => bl.includes(t))
    );
  }

  // 2. Role alignment — 20%
  function scoreRole(jobTitle, targetRoles) {
    if (!targetRoles?.length || !jobTitle)
      return _unknown('Role alignment', 20, 'Add target roles to check title fit');

    const jt = jobTitle.toLowerCase();
    let best = 0, bestRole = '';
    for (const role of targetRoles) {
      const r = role.toLowerCase().trim();
      if (jt.includes(r) || r.includes(jt)) { best = 1.0; bestRole = role; break; }
      const rw = r.split(/\s+/).filter(w=>w.length>2);
      const tw = jt.split(/[\s\-\/]+/).filter(w=>w.length>2);
      const s = rw.length ? rw.filter(w=>tw.some(t=>t.includes(w)||w.includes(t))).length / rw.length : 0;
      if (s > best) { best = s; bestRole = role; }
    }

    // Category match — e.g. "Backend Engineer" vs "Software Engineer"
    // Score as strong partial even if word overlap is low
    const sameCat = targetRoles.find(r => sameRoleCategory(jobTitle, r));

    if (best >= 0.7) return { name:'Role alignment', status:'pass', value:1.0, weight:20,
      verdict:'Direct match', note:`"${jobTitle}" matches your target "${bestRole}"` };
    if (best >= 0.35 || sameCat) {
      const roleVal = best >= 0.5 ? 0.75 : 0.55;
      return { name:'Role alignment', status:'partial', value:roleVal, weight:20,
        verdict:'Related role', note:`Related to your target "${sameCat || bestRole}"` };
    }
    return { name:'Role alignment', status:'fail', value:0, weight:20,
      verdict:'Role mismatch', note:`"${jobTitle}" doesn't match your targets (${targetRoles.slice(0,2).join(', ')})` };
  }

  // 3. Experience / seniority — 15%
  function scoreSeniority(jobExp, jobTitle, expYears) {
    const userRange = yearsToRange(expYears);
    if (!userRange) return _unknown('Experience fit', 15, 'Set your years of experience');

    let resolved = jobExp, lbl = '';
    for (const { pat, min, max, label } of SENIORITY) {
      if (pat.test(jobTitle || '')) { lbl = label; resolved = resolved || { min, max }; break; }
    }
    if (!resolved) return _unknown('Experience fit', 15, 'No seniority signal found in listing');

    const display = lbl ? `${lbl} (${resolved.min}–${resolved.max} yrs)` : `${resolved.min}–${resolved.max} yrs`;
    const overlap  = Math.min(userRange.max, resolved.max) - Math.max(userRange.min, resolved.min);
    const userMid  = (userRange.min + userRange.max) / 2;
    const jobMid   = (resolved.min + resolved.max) / 2;

    if (overlap > 0) {
      const q = overlap / ((resolved.max - resolved.min) || 1);
      return { name:'Experience fit', status:'pass', value:q>=0.5?1.0:0.75, weight:15,
        verdict:'Good fit', note:`${display} — matches your ${expYears} yr experience` };
    }
    if (jobMid < userMid) {
      const gap = userMid - resolved.max;
      return gap <= 1.5
        ? { name:'Experience fit', status:'partial', value:0.5, weight:15, verdict:'Over-qualified',
            note:`${display} — you may be over-qualified` }
        : { name:'Experience fit', status:'fail',    value:0.2, weight:15, verdict:'Over-qualified',
            note:`${display} — significantly over-qualified at ${expYears} yrs` };
    }
    const gap = resolved.min - userMid;
    return gap <= 1.5
      ? { name:'Experience fit', status:'partial', value:0.45, weight:15, verdict:'Stretch role',
          note:`${display} — slightly above your ${expYears} yrs` }
      : { name:'Experience fit', status:'fail',    value:0,    weight:15, verdict:'Under-qualified',
          note:`Requires ${display} — you have ${expYears} yrs` };
  }

  // 4. Work arrangement — 15%
  function scoreWorkType(jobWorkType, preferred) {
    const labels = { remote:'Remote', hybrid:'Hybrid', onsite:'On-site' };
    if (!preferred?.length) return _unknown('Work arrangement', 15, 'Set your work preference to score this');
    if (preferred.length >= 3) return { name:'Work arrangement', status:'pass', value:1.0, weight:15,
      verdict:'Open to all', note:'You are open to any work arrangement' };
    if (!jobWorkType) return _unknown('Work arrangement', 15, 'Work type not stated — confirm before applying');

    return preferred.includes(jobWorkType)
      ? { name:'Work arrangement', status:'pass', value:1.0, weight:15,
          verdict:'Matches preference', note:`${labels[jobWorkType]||jobWorkType} — matches your preference ✓` }
      : { name:'Work arrangement', status:'fail', value:0, weight:15,
          verdict:'Mismatch',
          note:`${labels[jobWorkType]||jobWorkType} — you prefer ${preferred.map(t=>labels[t]||t).join(' or ')}` };
  }

  // 5. Compensation — 15%
  function scoreCompensation(jobSalary, minSalary) {
    if (!minSalary || minSalary < 1000) return _unknown('Compensation', 15, 'Set a minimum salary to score this');
    if (!jobSalary) return _unknown('Compensation', 15,
      `Salary not listed — verify meets your $${fmtK(minSalary)} minimum`);

    const mid  = jobSalary.midpoint;
    const diff = (mid - minSalary) / minSalary;

    if (diff >= 0.25) return { name:'Compensation', status:'pass', value:1.0, weight:15,
      verdict:'Well above range',
      note:`$${fmtK(jobSalary.low)}–$${fmtK(jobSalary.high)} · ${Math.round(diff*100)}% above your $${fmtK(minSalary)} min` };
    if (diff >= 0) return { name:'Compensation', status:'pass', value:0.82, weight:15,
      verdict:'Meets expectations', note:`$${fmtK(mid)} meets your $${fmtK(minSalary)} minimum` };
    if (diff >= -0.15) return { name:'Compensation', status:'partial', value:0.4, weight:15,
      verdict:'Slightly below', note:`$${fmtK(mid)} — ${Math.round(Math.abs(diff)*100)}% below min, may be negotiable` };
    return { name:'Compensation', status:'fail', value:0, weight:15,
      verdict:'Below range', note:`$${fmtK(mid)} — significantly below your $${fmtK(minSalary)} minimum` };
  }

  // 6. Deal-breakers — hard override, 0 weight (handled separately)
  function scoreDealBreakers(jobTitle, jobRaw, dealBreakers, avoidIndustries) {
    const all = [...(dealBreakers||[]), ...(avoidIndustries||[])];
    if (!all.length) return { name:'Deal-breakers', status:'pass', value:1.0, weight:0,
      note:'No deal-breakers configured', verdict:null, dealBreaker:false };

    const text = `${jobTitle||''} ${jobRaw||''}`;
    const hit = all.find(db => {
      try { return new RegExp(`\\b${db.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(text); }
      catch { return text.toLowerCase().includes(db.toLowerCase()); }
    });

    return hit
      ? { name:'Deal-breakers', status:'fail', value:0, weight:0, dealBreaker:true,
          verdict:'Deal-breaker found', note:`"${hit}" detected in listing` }
      : { name:'Deal-breakers', status:'pass', value:1.0, weight:0, dealBreaker:false,
          verdict:'Clean', note:'No deal-breakers detected' };
  }

  // ── Resume tips ────────────────────────────────────────────────────────────
  function buildTips(criteria, jobData) {
    const tips = [];
    const get  = n => criteria.find(c => c.name === n);
    const skills = get('Technical skills');
    const role   = get('Role alignment');
    const exp    = get('Experience fit');
    const work   = get('Work arrangement');

    if (skills?.missingCritical?.length)
      tips.push(`Your critical skills (${skills.missingCritical.slice(0,2).join(', ')}) aren't in this listing — clarify in cover letter or reconsider`);
    const titleHits = skills?.matched?.filter(m=>m.inTitle)||[];
    if (titleHits.length)
      tips.push(`Lead your resume headline with ${titleHits.slice(0,2).map(m=>m.kw).join(' & ')} — they appear in the job title`);
    if (skills?.missing?.length && !skills?.missingCritical?.length)
      tips.push(`${skills.missing.slice(0,3).join(', ')} not found — mention in cover letter if you have exposure`);
    if (role?.status==='fail')
      tips.push(`Mirror the exact title "${jobData?.title}" in your resume summary to improve ATS ranking`);
    if (exp?.verdict==='Over-qualified')
      tips.push(`You appear over-qualified — lead with impact and growth goals, not seniority`);
    if (exp?.verdict?.includes('Stretch')||exp?.verdict==='Under-qualified')
      tips.push(`Stretch opportunity — emphasise fast learning, step-up readiness, and project impact`);
    if (!jobData?.salary)
      tips.push(`No salary listed — research range on Glassdoor before applying to anchor negotiation`);
    if (work?.status==='fail')
      tips.push(`Work arrangement mismatch — confirm flexibility before investing time in application`);

    return tips.slice(0,4);
  }

  // ── Verdict line ───────────────────────────────────────────────────────────
  function buildVerdict(criteria, score) {
    const skills = criteria.find(c=>c.name==='Technical skills');
    const role   = criteria.find(c=>c.name==='Role alignment');
    const work   = criteria.find(c=>c.name==='Work arrangement');
    const parts  = [];

    if (skills?.missingCritical?.length)
      parts.push(`Missing critical ${skills.missingCritical.slice(0,2).join('/')} skills`);
    else if (skills?.status==='pass' && skills.matched?.length)
      parts.push(`Strong ${skills.matched.slice(0,2).map(m=>m.kw).join('/')} match`);
    else if (skills?.status==='partial' && skills.matched?.length)
      parts.push(`Partial skill match (${skills.matched.length}/${skills.matched.length+(skills.missing?.length||0)} found)`);

    if (work?.status==='fail')
      parts.push(work.note?.split('—')[0]?.trim()||'Work type mismatch');
    else if (work?.status==='pass' && work.verdict!=='Open to all')
      parts.push(work.note?.split('—')[0]?.trim()||'Work type matches');

    if (role?.status==='fail') parts.push('Role title differs from your targets');

    if (!parts.length) return score>=70 ? 'Overall good fit based on available data' : 'Limited overlap based on available data';
    return parts.join(' · ');
  }

  // ── Main entry ────────────────────────────────────────────────────────────
  function scoreJob(jobData, profile) {
    if (!profile) return _empty('Open Rolevance and set up your profile');

    const critical  = profile.mustHaveSkills  || [];
    const primary   = profile.primarySkills   || [];
    const secondary = profile.secondarySkills || [];
    const targets   = profile.targetRoles     || [];
    const expYears  = profile.experienceYears || 0;

    const criteria = [
      scoreSkills(jobData.title, jobData.rawText, critical, primary, secondary),
      scoreRole(jobData.title, targets),
      scoreSeniority(jobData.experience, jobData.title, expYears),
      scoreWorkType(jobData.workType, profile.workTypes),
      scoreCompensation(jobData.salary, profile.minSalary),
      scoreDealBreakers(jobData.title, jobData.rawText, profile.dealBreakers, profile.avoidIndustries),
    ];

    const dealBreak = criteria.find(c => c.dealBreaker);
    if (dealBreak) {
      return {
        score:0, label:'red', text:'Deal-breaker matched',
        verdict:`"${dealBreak.note.match(/"(.+)"/)?.[1]||'Keyword'}" found — skip this listing`,
        recommendation:{ text:'Skip — deal-breaker keyword detected', level:'danger' },
        criteria, confidence:1, warnings:[], missingCritical:[],
        metCount:0, total:criteria.length, tips:buildTips(criteria, jobData),
      };
    }

    const known    = criteria.filter(c => c.status !== 'unknown' && c.weight > 0);
    const totalW   = known.reduce((s,c) => s+c.weight, 0);
    const numKnown = known.length;

    if (numKnown === 0) return {
      ..._empty('Fill in at least one preference to see scores'),
      criteria, warnings: _buildWarnings(profile, primary, critical),
    };

    const sum   = known.reduce((s,c) => s + c.weight * c.value, 0);
    let score   = Math.round((sum / totalW) * 100);

    const skillCrit       = criteria.find(c=>c.name==='Technical skills');
    const missingCritical = skillCrit?.missingCritical || [];
    // Reduced from -18 to -8 per missing critical skill.
    // The skills component (35% weight) already reflects missing criticals via
    // critScore = critMatched/critical.length. The additional penalty prevents
    // double-punishment and accounts for the fact that card snippets don't
    // always contain all required skills even when the full JD does.
    score = Math.max(0, score - missingCritical.length * 8);

    const maxW       = criteria.filter(c=>c.weight>0).reduce((s,c)=>s+c.weight,0);
    const confidence = maxW > 0 ? totalW / maxW : 0;

    // ── Label thresholds — green ≥ 70, amber 50–69, red < 50 ────────────────
    // Only force red when ALL critical skills are absent (0 of N found) —
    // not for 1 missing out of 3, which already depressed the skills score.
    // Matching 2/3 critical skills is still a good candidate.
    const allCritMissing = missingCritical.length > 0
      && missingCritical.length === (criteria.find(c=>c.name==='Technical skills')?.missingCritical?.length || 0)
      && critical.length > 0
      && missingCritical.length === critical.length;

    let label;
    if (allCritMissing)      label = 'red';
    else label = score >= 70 ? 'green' : score >= 50 ? 'amber' : 'red';

    const textMap = [
      [88,'Exceptional fit'],[75,'Strong match'],[65,'Good match'],
      [50,'Partial match'],  [35,'Weak fit'],    [0, 'Poor fit'],
    ];
    const text = confidence < 0.35
      ? (score>=65 ? 'Likely good fit' : score>=45 ? 'Uncertain fit' : 'Likely poor fit')
      : (textMap.find(([t]) => score >= t)?.[1] || 'Poor fit');

    const recText  = score>=80 ? 'Apply with confidence — strong match'
      : score>=65 ? 'Worth applying — solid overall fit'
      : score>=50 ? 'Review the gaps before applying'
      : score>=35 ? 'Significant gaps — apply only if role is compelling'
      :             'Poor fit — likely not the right opportunity';
    const recLevel = score>=70 ? 'success' : score>=45 ? 'warning' : 'danger';

    const warnings = _buildWarnings(profile, primary, critical);
    const verdict  = buildVerdict(criteria, score);
    const metCount = known.filter(c=>c.status==='pass').length;

    return {
      score, label, text, verdict, criteria,
      recommendation:{ text:recText, level:recLevel },
      confidence, warnings, missingCritical,
      metCount, total:numKnown,
      tips: buildTips(criteria, jobData),
    };
  }

  function _buildWarnings(profile, primary, critical) {
    const w = [];
    if (!critical.length && !primary.length) w.push('Primary skills — drives 35% of score');
    if (!profile.targetRoles?.length)        w.push('Target roles — 20% of score');
    if (!profile.experienceYears)            w.push('Years of experience — 15% of score');
    if (!profile.minSalary || profile.minSalary < 1000) w.push('Minimum salary — 15% of score');
    if (!profile.workTypes?.length)          w.push('Work preference — 15% of score');
    return w;
  }

  function _unknown(name, weight, note) {
    return { name, status:'unknown', value:0, weight, note, verdict:null };
  }
  function _empty(msg) {
    return { score:null, label:'gray', text:msg, verdict:'', recommendation:null,
      criteria:[], confidence:0, warnings:[], missingCritical:[], metCount:0, total:0, tips:[] };
  }

  window.scoreJob = scoreJob;

}());