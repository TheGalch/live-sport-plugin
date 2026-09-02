# Project: Nuvio Live Sports Plugin — BeinArabicProvider Removal Verification & E2E Testing

## Architecture
The Nuvio Live Sports Plugin is an Express-based Stremio/Nuvio sports aggregation and streaming proxy service featuring Awilix DI container, multi-source match aggregation, and a multi-tiered in-memory caching architecture:
1. **DI Container (`src/container.js`)**: Awilix `PROXY` mode container managing 20 registered singletons and providers.
2. **Match Aggregator (`src/services/MatchAggregator.js`)**: Ingests and normalizes live sports fixtures and 24/7 channels across 12 active providers.
3. **Stream Resolution & Scoring (`src/streams.js`, `StreamResolveCache.js`, `StreamScoringService.js`)**: Single-flight coalesced scraping, preflight M3U8 verification, adaptive TTLs, and fallback routing.
4. **Proxy & Web Endpoints (`src/index.js`, `catalog.js`)**: Express server exposing Stremio manifest, catalog SWR, meta prewarming, stream endpoints, `/health` telemetry, `/api/manifest` HLS proxy, `/img` image pipeline, and `/watch` web player.

## Feature Inventory
| # | Feature / Requirement | Description | Milestone | Source | Status |
|---|-----------------------|-------------|-----------|--------|--------|
| 1 | R1: Container Integrity & Clean Removal | Confirm zero dangling references to `BeinArabicProvider`, 100% Awilix DI container resolution across all registrations. | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | R1: Server Boot & Sanity Check | Validate clean startup of Express app (port 7000) and child resolver process (port 7003) in both dev and production bundle modes. | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 3 | R2: Core Endpoints Contract Verification | Validate `/manifest.json`, `/catalog/tv/*.json`, `/meta/tv/*.json`, `/stream/tv/*.json`, `/health`, `/api/manifest`, `/img`, `/watch` response codes and JSON schemas. | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 4 | R2: Provider Aggregation & Stream Resolution | Ingest matches across 12 remaining providers, assert match normalization, and resolve multi-source streams without BeinArabicProvider. | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 5 | R2: Caching & SWR Validation | Verify `StreamResolveCache`, JIT prewarming, single-flight coalescing, and catalog SWR non-blocking background revalidation. | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 6 | R3: Git Diff & Remote GitHub Comparison | Detailed diff analysis against `origin/main` (commit 5463efc), verifying all changed files and deleted provider code. | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 7 | R3: Regression & Side-Effect Verification | Verify that provider removal introduced zero regressions in match deduplication, categorization, or stream fallbacks. | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 8 | Multi-Agent Quality & Forensic Audit | Comprehensive review by independent Reviewers, empirical testing by Challengers, and forensic integrity audit by Forensic Auditor. | M4 | Workflow Standards | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Startup & Container Sanity Verification (R1) | DI container resolution test, server boot in dev & dist, initial endpoint sanity checks. | Survey | DONE |
| M2 | Core Endpoints & Provider E2E Verification (R2) | End-to-end testing of all API endpoints, match aggregation, and stream resolution across remaining providers. | M1 | DONE |
| M3 | GitHub Comparison & Regression Verification (R3) | Deep comparison against GitHub remote `origin/main`, analyzing all diffs and proving zero regressions. | M2 | DONE |
| M4 | Multi-Agent Review, Challenger Stress & Forensic Audit | Multi-reviewer consensus (Reviewer 1 & 2 APPROVE), empirical challenger verification (Challenger 1 & 2 APPROVE), and forensic integrity audit (Auditor CLEAN). | M3 | DONE |

## Code Layout & Verified Boundaries
- **Modified/Removed Files for BeinArabicProvider Removal**:
  - `src/providers/BeinArabicProvider.js` (Deleted)
  - `dist/BeinArabicProvider.js` (Deleted)
  - `src/container.js` (Removed require & DI registration)
  - `src/services/MatchAggregator.js` (Removed constructor dependency, providers list, signature extraction, isolation rule)
  - `src/streams.js` (Removed from `KNOWN_FALLBACKS` & resolution dispatch branch)
- **Active Providers (12 total + dynamic YAML)**:
  - `StreamFreeProvider`, `TimStreamsProvider`, `IptvOrgProvider`, `SportyHunterProvider`, `WatchFootyProvider`, `CdnLiveProvider`, `StreamSports99Provider`, `StreamicProvider`, `Strims24Provider`, `EmbedIndiaProvider`, `EmbedStProvider`, `StreamedPkProvider`, `YamlProviderBuilder`.
