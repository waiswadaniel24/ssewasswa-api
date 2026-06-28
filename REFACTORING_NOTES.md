# Refactoring Notes — ssewasswa-api

Audit trail for the refactoring work started 2026-06-28. Each subagent
appends a section here when it makes changes that affect the file tree
or dependency manifest.

This file is part of the audit trail and should be committed alongside
the changes it documents.

---

## Track 3 (Task t3) — Consolidate duplicate files and remove versioned dead code

**Date:** 2026-06-28
**Agent:** Track 3 (t3)

### Audit findings addressed

- **F-05** — "Duplicate files: 11× `fundraising-ultimate*.js`, school-v18
  cluster, fundraising-mega/pro/enhancements/unified variants."
- **F-09** — "Two lockfiles present (`bun.lock` and `package-lock.json`); pick
  one package manager."
- **F-10** — "`package.json` specifies `lodash: ^4.18.1` but lodash's latest
  4.x is `4.17.21` — version 4.18.x doesn't exist on npm."

### F-05: FALSE POSITIVE — no files deleted

**Investigation method:** For each flagged cluster, ran `wc -l` and `head -5`
on every file, then `rg`-searched `server.js` for `require('./<filename>')`
references.

**Finding:** Every file flagged by F-05 is a **distinct feature module** that
shares only a naming pattern with its siblings — they are NOT byte-for-byte
duplicates and not even semantic duplicates. Each implements a different set
of features. All are actively `require()`'d by `server.js`.

#### Fundraising cluster — all 15 files KEPT

Every file below is `require()`'d from `server.js` (verified by
`rg -n "require\('\./fundraising" server.js`). The "ultimate" suffix is a
sequence, not a version marker — each module in the sequence adds new
features:

| File | Lines | Required at server.js line | Feature set |
|---|---|---|---|
| `fundraising-ultimate.js`  | 1,466 | 35509 | 10 advanced features (recurring donations, impact calc, donor tiers, Harambee mode, etc.) |
| `fundraising-ultimate2.js` | 1,717 | 35532 | Donor Intelligence — 15 features |
| `fundraising-ultimate3.js` | 2,016 | 35536 | Campaign Optimization — 15 features |
| `fundraising-ultimate4.js` | 1,682 | 35540 | Financial & Compliance — 15 features |
| `fundraising-ultimate5.js` | 1,797 | 35544 | Community & Social — 15 features |
| `fundraising-ultimate6.js` | 1,829 | 35552 | Integration & Platform — 15 features |
| `fundraising-ultimate7.js` |   357 | 35556 | Advanced Donation Types & Events — 8 features |
| `fundraising-ultimate8.js` |   630 | 35560 | Capital Campaigns & Donor Engagement — 8 features |
| `fundraising-ultimate9.js` |   126 | 35564 | Events, Intelligence & Financial Pro — 8 features |
| `fundraising-ultimate10.js`| 1,990 | 35568 | Digital Presence & Alternative Assets — 8 features |
| `fundraising-ultimate11.js`|   926 | 35572 | Alternative Assets & Platform Operations — 8 features |
| `fundraising-mega.js`     | 1,502 | 35517 | 10 comprehensive features (Donor CRM, etc.) |
| `fundraising-mega2.js`    | 1,372 | 35525 | 10 advanced features (Donation Analytics Dashboard, etc.) |
| `fundraising-pro.js`      |   744 | 35499 | 15 pro features (Social Sharing, Donor Dashboard, Payouts, etc.) |
| `fundraising-enhancements.js` | 5,099 | 41923 | Professional & Global-Ready Features (largest single module) |
| `fundraising-unified-routes.js` | 650 | 41863 | Consolidated 5 tables / 14 routes |

`diff fundraising-ultimate.js fundraising-ultimate2.js` confirmed the files
implement entirely different features (Donor Intelligence vs. Recurring
Auto-Donations / Impact Calculator) — different `CREATE TABLE` statements,
different route handlers, different field names.

#### School-v18 cluster — all 3 files KEPT

All three are loaded at `server.js:41834-41836` via `loadSelfExec(...)`,
which does `require('./' + modName)` (with a try/catch).

| File | Lines | Module type | Feature set |
|---|---|---|---|
| `school-v18-upgrade.js` | 1,866 | exports `function(app, pool, opts)` | School Portal v18 Upgrade — 10 features (Teacher Dashboard, Rankings, Certificates, Clubs, Field Trips, Counselling, Special Needs, Academic Terms, Newsletter, Continuous Assessment) |
| `school-v18-b.js`       | 1,674 | exports `function(app, pool, opts)` | School Portal v18 Part 2 — Features 11-20 (Public Website Pages, SEO, WCAG, Online Admission Form, Bus GPS, Meal Plan, Sickbay, API Docs, PWA Manifest, Analytics) |
| `v14-v17-routes.js`     | 1,264 | self-executing (uses globals) | v14.0 routes: AI Symptom Checker, Smart Notifications, Patient Kiosk, Health Wallet, Theatre, etc. |

These are NOT version copies — they implement different feature sets and
have different module shapes (some are function-exported, some are
self-executing). None can be safely deleted.

#### Recommended follow-up (out of scope for this pass)

The audit's F-05 was a filename-pattern-based false positive. To prevent
the audit from re-flagging these files in future runs, consider renaming
them so the version-suffix pattern is broken:

- `fundraising-ultimate.js`   → `fundraising-advanced.js`
- `fundraising-ultimate2.js`  → `fundraising-donor-intelligence.js`
- `fundraising-ultimate3.js`  → `fundraising-campaign-optimization.js`
- `fundraising-ultimate4.js`  → `fundraising-financial-compliance.js`
- `fundraising-ultimate5.js`  → `fundraising-community-social.js`
- `fundraising-ultimate6.js`  → `fundraising-integration-platform.js`
- `fundraising-ultimate7.js`  → `fundraising-advanced-donations.js`
- `fundraising-ultimate8.js`  → `fundraising-capital-campaigns.js`
- `fundraising-ultimate9.js`  → `fundraising-events-intelligence.js`
- `fundraising-ultimate10.js` → `fundraising-digital-presence.js`
- `fundraising-ultimate11.js` → `fundraising-alternative-assets.js`
- `school-v18-upgrade.js`     → `school-portal-v18-features-1-10.js`
- `school-v18-b.js`           → `school-portal-v18-features-11-20.js`

This rename requires updating the `require()` calls in `server.js` at the
lines listed above and is left for a future, lower-risk refactor pass.

A separate observation (out of scope): `loadSelfExec` at `server.js:41454`
just does `require('./' + modName)` without invoking the returned function.
For `school-v18-b.js` and `school-v18-upgrade.js` (which export
`function(app, pool, opts)`), the routes they define may not actually be
registered at runtime — this is a pre-existing bug worth investigating
separately, but it does not change the fact that the files are *referenced*
and therefore cannot be deleted without breaking the require resolution.

### F-09: RESOLVED — lockfile cleanup applied

**Before:**
- `bun.lock`      — 665 lines / 70 KB
- `package-lock.json` — 4,075 lines / 140 KB

Both lockfiles were tracked. `bun.lock` was the primary (per audit F-09
recommendation, bun is faster).

**After:**
- `bun.lock` — 76 KB (updated: ran `bun install` to sync with the
  `node-pg-migrate` dependency that Track 1 added to `package.json`)
- `package-lock.json` — **DELETED** (4,075 lines removed from the repo)

`.gitignore` was already updated by Track 1 (the Conservative refactor
agent) to include `package-lock.json` and `yarn.lock`. Verified the
entry is present at the "Lockfiles" section of `.gitignore`.

**No changes to `package.json` scripts** — `npm run *` commands still
work (they just invoke `node` under the hood). If a developer runs
`npm install` locally, npm will regenerate `package-lock.json`, but it
will be gitignored and won't be committed. The canonical lockfile in
the repo is `bun.lock`, and developers should use `bun install`.

### F-10: FALSE POSITIVE — no change to `package.json`

**Audit claim:** "lodash's latest 4.x is 4.17.21 — version 4.18.x doesn't
exist on npm."

**Verification (2026-06-28):**

```
$ npm view lodash version
4.18.1

$ npm view lodash@4.18.1 dist.integrity
sha512-dMInicTPVE8d1e5otfwmmjlxkZoUpiVLwyeTdUsi/Caj/gfzzblBcCE5sRHV/AsjuCmxWrte2TNGSYuCeCq+0Q==
```

As of 2026-06-28, lodash has published versions 4.17.22, 4.17.23, 4.18.0,
and 4.18.1. The current latest is **4.18.1** — exactly what `package.json`
specifies (`"lodash": "^4.18.1"`).

The `bun.lock` entry for lodash also matches:
```
"lodash": ["lodash@4.18.1", "", {},
  "sha512-dMInicTPVE8d1e5otfwmmjlxkZoUpiVLwyeTdUsi/Caj/gfzzblBcCE5sRHV/AsjuCmxWrte2TNGSYuCeCq+0Q=="]
```

The integrity hash matches the npm registry exactly. **No change was
needed.** The audit finding was based on outdated npm metadata —
lodash 4.18.x did not exist when the audit was performed but has since
been published.

Changing `^4.18.1` → `^4.17.21` as the audit suggested would have
DOWNGRADED lodash from the current latest version. This is exactly the
kind of false positive the task instructions warned about — verified
before acting.

### Files modified

- `bun.lock` — regenerated by `bun install` (added `node-pg-migrate`
  entry that Track 1 had added to `package.json` but not yet propagated
  to the lockfile)
- `.github/workflows/ci.yml` — switched the install step from `npm ci`
  to `bun install --frozen-lockfile` and added a `oven-sh/setup-bun@v2`
  step. Removed `cache: npm` from the `actions/setup-node@v4` step.
  This was a necessary follow-on from deleting `package-lock.json`
  (Track 4's CI workflow used `npm ci`, which strictly requires
  `package-lock.json` to be committed; without this change, CI would
  break). The `npm run syntax` / `npm run lint` / `npm test` steps
  are unchanged — `npm run` still works fine because it just invokes
  `node` under the hood and `node_modules` is populated by `bun install`.

### Files deleted

- `package-lock.json` — 4,075 lines removed (audit finding F-09)

### Files created

- `REFACTORING_NOTES.md` — this file (audit trail)

### Files NOT deleted (and why)

All 19 files flagged by audit F-05 (`fundraising-ultimate*.js` × 11,
`fundraising-mega*.js` × 2, `fundraising-pro.js`, `fundraising-enhancements.js`,
`fundraising-unified-routes.js`, `school-v18-b.js`, `school-v18-upgrade.js`,
`v14-v17-routes.js`) are **required by `server.js`** and implement
distinct feature sets. Deleting any of them would break the application.
See "F-05: FALSE POSITIVE" section above for the per-file evidence table.

### Verification

- `node -c server.js` — PASS (server.js parses)
- All `require('./...')` targets in `server.js` resolve to existing files — PASS
- `node -e "require('./package.json')"` — PASS (package.json is valid JSON)
- `bun.lock` is the only lockfile in the repo root — PASS
- `package-lock.json` is in `.gitignore` — PASS
- Repo root `.js` file count: 237 (unchanged from pre-task — no files
  deleted, because the audit's duplicate-file finding was a false
  positive)

### Open issues / follow-ups

1. **F-05 false positive** — Recommend the audit tooling be updated to
   check `require()` references before flagging filename-pattern matches
   as duplicates. The current F-05 report would lead a less-careful
   agent to delete 19 actively-used modules and break the app.

2. **Rename pass** — Consider renaming the 11 `fundraising-ultimate*.js`
   files (and the school-v18 cluster) to descriptive names so future
   audits don't re-flag them. See "Recommended follow-up" above. Out of
   scope for this pass.

3. **`loadSelfExec` bug** — `school-v18-b.js` and `school-v18-upgrade.js`
   export functions but `loadSelfExec` only does `require()` without
   invoking them. Their routes may not actually be registered at
   runtime. Pre-existing bug; out of scope for this task.
