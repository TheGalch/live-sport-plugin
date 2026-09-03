# Project: Nuvio Live Sports Plugin - Cache Removal & Backup

## Architecture
Express-based Stremio Live Sports Plugin backend providing sports matches and live streams with zero server-side caching and direct upstream resolution.

## Survey Synthesis
- **Git State**: Clean working tree on `main`. Remote branch `with-cache` created and pushed to `origin` preserving baseline cached commit `af5c8e5e03789399da0e7d77c48ad02126fd0420`.
- **Caching Architecture Gutted**:
  - `src/services/StreamResolveCache.js` deleted.
  - `src/services/CacheService.js` deleted.
  - `src/services/CronService.js` stripped of `ensureFresh()`, `prewarmPopular()`, and `pruneStreamCache()`.
  - `src/services/MatchAggregator.js` returns live matches without cache.
  - `src/services/ImageService.js` fetches live without in-memory cache maps.
  - `src/providers/EmbedIndiaProvider.js` stripped of `_failureCache`.
  - `src/api.js` stripped of `cachedMatches`.
  - `src/container.js` stripped of cache service registrations.
  - `src/streams.js` stripped of memoization, returning `cacheMaxAge: 0`.
  - `src/catalog.js` stripped of SWR and prewarming, querying match aggregator on demand.
  - `src/index.js` stripped of `manifestCache`, `/health` telemetry, and setting `Cache-Control: no-cache, no-store, must-revalidate`.

## Feature Inventory
| # | Feature | Description | Milestone | Status | Source |
|---|---------|-------------|-----------|--------|--------|
| 1 | Backup branch `with-cache` | Create branch `with-cache` pointing to `af5c8e5` with full caching layer and push to `origin` | M1 | DONE | ORIGINAL_REQUEST.md § R1 |
| 2 | Remove caching layer | Strip `StreamResolveCache`, `CacheService`, `CronService` caching/prewarming, `manifestCache`, and update routes/services | M2 | DONE | ORIGINAL_REQUEST.md § R2 |
| 3 | Verification Test Suite | Implement and execute automated test script requesting stream twice and asserting upstream provider is hit both times | M3 | DONE | ORIGINAL_REQUEST.md § Verification |
| 4 | QA & Integrity Audit | Multi-agent review (2 Reviewers), adversarial challenge (2 Challengers), and Forensic Integrity Audit (Auditor) | M4 | DONE | ORIGINAL_REQUEST.md § Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Survey | Codebase and git exploration | None | DONE |
| M1 | Branch Backup | Create and push `with-cache` branch to `origin` | M0 | DONE |
| M2 | Cache Removal | Remove all caching from `main` branch | M1 | DONE |
| M3 | Verification Test | Programmatic double-request upstream hit verification script | M2 | DONE |
| M4 | Gate & Audit | Reviewers (2 APPROVE), Challengers (2 APPROVE), Auditor (CLEAN) | M3 | DONE |

## Code Layout & Deliverables
- `scripts/test-zero-cache-stream-fetch.js` — Programmatic test script asserting 2 consecutive stream requests hit upstream twice (0.00% cache hit rate).
- `scripts/test-sanity-zero-cache.js` — Comprehensive regression test suite.
- `scripts/challenger-stream-stress.js` — Challenger 1 stress test suite.
- `scripts/challenger-endpoints-stress.js` — Challenger 2 stress test suite.
- `dist/index.js` — Verified production bundle (`npm run build` exit code 0).
