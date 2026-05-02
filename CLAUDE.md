# Rolevance Extension — Claude Instructions

Read the parent CLAUDE.md at `/srv/Extensions/CLAUDE.md` first. Everything there applies here too. This file adds the extension-specific details.

---

## Stack
- **Chrome Manifest V3** (MV3) — the modern Chrome extension format
- **Vanilla JavaScript** — no TypeScript, no bundler, no npm, no build step
- **Files load directly into Chrome as-is** — what you write is exactly what runs
- **Targets:** LinkedIn (`linkedin.com`) and Indeed (`indeed.com`)

---

## File map — what every file does

```
manifest.json
  → Declares everything: permissions, which scripts load on which pages,
    icon files, popup page, background service worker. The content script
    load ORDER defined here matters — do not reorder without understanding
    the dependencies.

background/service-worker.js
  → The background brain. Runs separately from the page. Handles ALL fetch
    calls to the backend API — content scripts cannot call the API directly.
    Also manages: subscription status caching (hourly alarm), LemonSqueezy
    checkout flow, post-upgrade polling (every 8s until tier flips to pro),
    and all chrome.runtime.onMessage routing.

content/scraper.js
  → Reads job card elements from the LinkedIn/Indeed DOM and extracts:
    title, company, location, salary, work type, job ID, raw text snippet.
    Has separate logic for LinkedIn cards and Indeed cards.

content/scorer.js
  → Does a fast rule-based score locally (no API call) using the ALIASES
    table for skill matching. Also handles badge injection after AI results
    come back. The rule-based score shows instantly; AI score updates it.

content/panel.js
  → Builds the job match panel UI as DOM elements. Renders the verdict card,
    score chip, quick-facts bar, criteria breakdown, AI section placeholder,
    and footer. Also handles the save-to-tracker button and close button.

content/injector.js
  → Physically places badges onto job cards in the DOM. Has separate
    injection logic for LinkedIn (li elements) and Indeed (cardOutline divs).

content/observer.js
  → MutationObserver that watches the page for new job cards being added
    to the DOM (happens when user scrolls or navigates within the SPA).
    When new cards appear, notifies content.js to score them.

content/ai-analyzer.js
  → Renders the deep AI analysis inside the panel. For Pro/Trial users:
    reads the full job description from the page DOM, calls the backend,
    renders decision, summary, key requirements, strengths, gaps, tips,
    and the coach's insight with staggered animation.
    For free users: renders the upgrade wall instead (no API call made).

content/tracker.js
  → Job application pipeline tracker. Saves jobs to chrome.storage.local
    under 'rolevance_tracker'. Provides saveJob(), isJobSaved(),
    updateStatus(), deleteJob(), getCount(). Used by panel.js (save button)
    and popup.js (tracker tab).

content/content.js
  → The main coordinator. Loads user preferences, detects page type
    (LinkedIn vs Indeed, search page vs detail page), triggers batch
    scoring, manages the SPA navigation watcher, score cache, daily stats,
    and reprocessing when the profile changes.

popup/popup.js
  → Runs inside the extension popup (the window that appears when clicking
    the Rolevance icon in the Chrome toolbar). Handles: profile form with
    auto-save, AI auto-fill from description text, subscription status
    display, upgrade flow UI, subscription restore, and the tracker tab.

popup/popup.html → The popup UI markup
popup/popup.css  → The popup styles
assets/styles/badge.css → Styles for job card badges (injected via manifest)
```

---

## Content script load order (from manifest.json)

```
scraper.js → scorer.js → panel.js → injector.js → observer.js
→ ai-analyzer.js → tracker.js → content.js
```

`content.js` always loads last because it calls functions defined by all the others. If you add a new content script, its position determines what it can access.

---

## MV3 rules — never break these

- **No `eval()`** — not allowed in MV3
- **No remote code** — cannot load scripts from external URLs
- **No `localStorage`** — must use `chrome.storage.local` for all persistent data
- **API calls only from service-worker.js** — content scripts send messages to the service worker, which makes the actual `fetch()` calls
- **Message passing** — content scripts communicate with the service worker only via `chrome.runtime.sendMessage()` and `chrome.runtime.onMessage`

---

## Chrome storage keys — fixed, never rename

| Key | Contents |
|-----|----------|
| `rolevance` | User profile (skills, preferences, experience) + device ID |
| `rolevance_sub` | Cached subscription status — tier, limits, trial days left |
| `rolevance_tracker` | Job pipeline — saved/applied/interview/offer entries |
| `rolevance_scores` | Score cache — avoids re-calling API for already-seen jobs (24hr TTL) |
| `rolevance_daily` | Today's activity — jobs scored, strong matches (resets daily) |

---

## All message types (content scripts ↔ service worker)

| Type | Direction | What it triggers |
|------|-----------|-----------------|
| `JS_BATCH_SCORE` | content → SW | AI score a batch of jobs |
| `JS_ANALYZE_JOB` | content → SW | Deep AI analysis of one job |
| `JS_PARSE_PROFILE` | popup → SW | Extract profile fields from text |
| `JS_PANEL_OPEN` | content → SW | Gate check — can this user open a panel? |
| `JS_SAVE_EMAIL` | popup → SW | Send email to backend |
| `JS_REFRESH_SUB_STATUS` | popup → SW | Force-refresh subscription from backend |
| `JS_OPEN_UPGRADE` | content/popup → SW | Open LemonSqueezy checkout tab |
| `JS_RESTORE_SUBSCRIPTION` | popup → SW | Restore sub by email |
| `JS_UPGRADE_COMPLETE` | SW → popup | Tier flipped to pro — update UI |
| `SET_BADGE` | content → SW | Update the toolbar badge count |

---

## Freemium gating in the extension

The extension enforces two levels of gating:

**Panel gate** (in `panel.js` + `content.js`):
- Before opening any panel, sends `JS_PANEL_OPEN` to the service worker
- Service worker calls `POST /api/panel/open` on the backend
- If `allowed: false` comes back, shows the limit-reached panel instead
- Free users get 5 panel opens per day; same job opened again = free re-open

**AI analysis gate** (in `ai-analyzer.js`):
- Checks `panelCheckResult.trial` and `panelCheckResult.limit` from the panel open response
- If `trial === false` AND `limit` is a finite number → user is free tier
- Free tier: renders the upgrade wall UI, makes zero API calls
- Pro/Trial: reads full job description from DOM, calls backend for deep analysis

---

## How to reload after changes

```
# Any file change:
Chrome → chrome://extensions → Rolevance → click ↺ → refresh LinkedIn/Indeed tab

# After changing service-worker.js:
Chrome → chrome://extensions → click "Service worker" link → close that tab
→ click ↺ → refresh LinkedIn/Indeed tab

# Check for extension errors:
Chrome → chrome://extensions → Rolevance → click "Errors"

# Watch service worker console logs:
Chrome → chrome://extensions → Rolevance → click "Service worker" → Console tab
```

---

## Platform differences to always check

Many files branch on `location.hostname.includes('indeed.com')`. When changing anything that touches job cards, panels, or badges, always verify it works on BOTH platforms:

- **LinkedIn:** job cards are `<li>` elements, job ID from `data-occludable-job-id`
- **Indeed:** job cards are `div.cardOutline`, job ID from `a[data-jk]`
- **LinkedIn detail page:** `/jobs/view/12345/`
- **Indeed detail page:** `/viewjob?jk=abc123`

When adding a feature, ask yourself: does this need different logic for LinkedIn vs Indeed?

---

## Things that must never be broken

- **`_deepCache` in `ai-analyzer.js`** — caches AI results per job ID in memory. Prevents calling the API again if the user closes and reopens the same job panel in the same session.
- **`chrome.storage.local` everywhere** — never switch to `localStorage`. MV3 service workers don't have access to `localStorage` and it would break immediately.
- **Content script load order** — `content.js` calls `window.scoreJob`, `window.showPanel`, `window.setupObserver` etc. that are defined by earlier scripts. Reordering breaks everything.
- **The fail-open in `togglePanel()`** — if the panel gate API call fails, `panelCheckResult` defaults to `{ allowed: true }`. The panel opens anyway. Users must never be blocked by network errors.
