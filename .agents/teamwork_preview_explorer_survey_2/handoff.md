# Handoff Report — Explorer 2 (Caching Service Survey)

**Agent Role**: Explorer 2 (Caching Service Survey)  
**Working Directory**: `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_explorer_survey_2`  
**Target File**: `caching_survey.md`  
**Date**: 2026-09-01  

---

## 1. Observation

Direct investigation of the codebase revealed the following exact components, files, and implementations:

1. **`StreamResolveCache` (`src/services/StreamResolveCache.js:15–165`)**:
   - In-memory cache holding resolved stream tokens (`this.entries`), single-flight promise deduplication (`this.inFlight`), and per-source learned TTLs (`this.ttl`).
   - Default TTL is `60,000` ms, bounded between `60,000` ms (min) and `600,000` ms (max). Negative TTL is `30,000` ms. LRU capacity is `200` entries.
   - Cache key format: `${src.source}:${match.id}:${src.id}` for matches (`streams.js:305`), and `${src.source}:__channel__:${channel.id}` for 24/7 evergreen channels (`streams.js:327`).
   - Adaptive scaling: `noteSuccess(key)` doubles provider TTL (`StreamResolveCache.js:119`), `noteFailure(key)` halves provider TTL and immediately evicts the key from `this.entries` (`StreamResolveCache.js:131–133`).
   - Telemetry method: `stats()` returns `{ entries, inFlight, hits, misses, negativeHits, evictions, learnedTtls }` (`StreamResolveCache.js:155–165`).

2. **`manifestCache` (`src/index.js:147–324`)**:
   - In-memory cache for rewritten live HLS manifests.
   - Cache key format: `${targetUrl}|${referer}|${origin}` (`src/index.js:244`).
   - Positive TTL is `3,000` ms; Negative TTL is `15,000` ms; LRU capacity is `100` entries.
   - Header feedback: Sets `X-Manifest-Cache: HIT`, `X-Manifest-Cache: MISS`, or `X-Manifest-Cache: NEGATIVE` (`src/index.js:248, 254, 311`).

3. **`CacheService` (`src/services/CacheService.js:1–20`) & SWR (`src/services/CronService.js:5–38`)**:
   - In-memory array `cachedMatches` holding the unified multi-provider fixture list.
   - Default TTL is `300,000` ms (5 min). Stale-While-Revalidate window is controlled by `process.env.CATALOG_REVALIDATE_MS` (default `600,000` ms / 10 min).
   - In `handleCatalog` (`src/catalog.js:214`) and `handleMeta` (`src/catalog.js:314`), `cronService.ensureFresh()` triggers a background re-sync while serving the cached list immediately (<5ms).

4. **Telemetry Endpoint (`src/index.js:993–997`)**:
   - `GET /health` returns `{ status: 'ok', service: 'nuvio-live-sports', streamResolveCache: container.resolve('streamResolveCache').stats() }`.

5. **Pre-Warming Workflows**:
   - Scheduled: `CronService.prewarmPopular()` runs every 3 minutes (`src/services/CronService.js:55–61`), prewarming up to 10 live matches marked `popular === '1'`.
   - Just-In-Time (JIT): `handleMeta()` triggers `prewarmMatch(match, config)` in a non-blocking background promise (`src/catalog.js:327`) when a user visits the detail page.

---

## 2. Logic Chain

1. From `src/services/StreamResolveCache.js`, `src/services/CacheService.js`, and `src/index.js`, the entire caching tier is purely in-memory (no Redis, no SQLite, no disk I/O). This eliminates disk/network bottlenecks and means all cache lookups complete in sub-millisecond to sub-15ms timeframes.
2. From the single-flight implementations in `StreamResolveCache.js:73–98` and `src/index.js:259–306`, concurrent requests for the same un-cached key are coalesced into a single Promise. Therefore, under load spikes ("thundering herds"), upstream providers receive exactly 1 scrape/manifest request rather than $N$ requests.
3. From `src/index.js:993–997` and `src/index.js:248–311`, testing tools can measure cache performance without invasive code modifications:
   - For `/api/manifest`: Directly check HTTP header `X-Manifest-Cache`.
   - For `/stream/tv/...` and `/catalog/tv/...`: Measure response latency deltas (cold $>500$ms vs hot $<30$ms) and query the `/health` endpoint before and after test runs to compute exact hit ratios, miss ratios, negative hit rates, and eviction counts.

---

## 3. Caveats

- **No Public Cache-Bypass Query Parameter**: The production server does not support a `?nocache=1` query parameter on HTTP endpoints. Cache bypass in end-to-end tests must be achieved via unique cache keys (e.g. distinct URL query params or fresh match IDs) or by allowing the TTL to elapse.
- **In-Memory Volatility**: Because all caches are process-local Maps/arrays, restarting the Node.js server clears all cached entries. The server takes ~1000ms on boot to run the initial catalog sync (`CronService.js:79–86`).

---

## 4. Conclusion

The caching architecture has been completely mapped and analyzed. All requirements in `ORIGINAL_REQUEST.md` for measuring cache hit/miss behavior, single-flight coalescing, adaptive TTLs, negative caching, and prewarming can be directly tested and quantified using HTTP headers, response latency distributions (P50/P95/P99), and the internal `/health` telemetry endpoint.

The detailed findings, architecture diagrams, key schemes, and load testing blueprint are documented in:
`C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_explorer_survey_2\caching_survey.md`

---

## 5. Verification Method

To independently verify the caching mechanisms and survey findings:
1. **Unit & Logic Tests**:
   - Run `node scripts/test-stream-resolve-cache.js` to verify single-flight coalescing, clone-on-read, adaptive TTL doubling/halving, LRU capping, and negative caching.
   - Run `node scripts/test-manifest-negative-and-swr.js` to verify manifest proxy negative caching, `X-Manifest-Cache` headers, and catalog Stale-While-Revalidate triggers.
   - Run `node scripts/test-e2e-caching.js` to verify end-to-end JIT prewarming, hit latency acceleration (<30ms), and telemetry reporting.
2. **Telemetry Endpoint Inspection**:
   - Start the server (`node src/index.js` or `npm start`) and query `curl -s http://localhost:7000/health`. Verify the returned `streamResolveCache` JSON object matches the schema detailed in `caching_survey.md`.
