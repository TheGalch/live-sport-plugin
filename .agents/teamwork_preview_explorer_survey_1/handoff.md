# Handoff Report — Explorer 1 (Survey Phase)

## 1. Observation
- **Authoritative Request**: In `.agents/ORIGINAL_REQUEST.md`, requiring a performance and load testing framework for the Nuvio Live Sports Plugin caching service to measure cache hit/miss behavior, P95 latency, throughput, and error rates, with a strict read-only constraint on existing code.
- **Codebase & Architecture**:
  - `package.json`: Version 3.0.0, Node `>=22.0.0`, dependencies include `express`, `stremio-addon-sdk`, `awilix`, `undici`, `impit`, `node-cron`, `opossum`, `m3u8-parser`, `dotenv`, `http-proxy-middleware`.
  - `src/index.js` (lines 15–110, 237–324, 990–1017): Initializes Express app, registers SDK router, spawns resolver sub-process (`resolver/src/server.js`) on `RESOLVER_PORT` (default 7003), listens on `PORT` (default 7000, host `0.0.0.0`), exposes `/health`, `/manifest.json`, `/catalog/tv/*`, `/meta/tv/*`, `/stream/tv/*`, `/api/matches`, `/api/manifest`, `/watch`.
  - `src/config.js` (lines 20–30): Exports `PORT` (parsed from `process.env.PORT || 7000`) and `BASE_URL`.
  - `src/container.js` (lines 31–41): Registers `cacheService`, `streamResolveCache`, `circuitBreaker`, `m3u8Parser`, `cronService`, `matchAggregator`, `streamScorer`.
  - `src/services/CacheService.js`: In-memory match cache with `CACHE_TTL = 5 * 60 * 1000` (5 mins).
  - `src/services/StreamResolveCache.js` (lines 15–165): Core caching engine with `getOrCreate(key, mintFn)`, single-flight coalescing (`inFlight` Map), adaptive TTL (60s to 10m), negative caching (30s), LRU eviction (`maxEntries = 200`), lifecycle pruning (`pruneEnded`), and telemetry statistics via `stats()`.
  - `src/services/CronService.js` (lines 40–87): Starts background jobs for periodic sync and popular match prewarming.
  - `resolver/` (ES Module subproject): Streamed.pk HLS resolver running on `RESOLVER_PORT`.
  - Existing scripts in `scripts/`: `measure-cache-hit.js`, `test-e2e-caching.js`, `test-stream-resolve-cache.js`, `test-manifest-negative-and-swr.js`.

## 2. Logic Chain
1. *From codebase inspection (`src/index.js`, `src/config.js`)*: The server can be booted programmatically with `node src/index.js` with custom environment variables `PORT=xxxx` and `RESOLVER_PORT=yyyy` to avoid port collisions on multi-tenant or busy development environments.
2. *From endpoint inspection (`src/index.js:993-997`)*: The `/health` endpoint returns `{ status: 'ok', service: 'nuvio-live-sports', streamResolveCache: {...} }` with HTTP 200, serving as an ideal polling readiness probe and live cache telemetry provider.
3. *From caching inspection (`StreamResolveCache.js`, `CacheService.js`, `src/index.js:manifestCache`)*: The primary performance targets under load are:
   - Match catalog lookup (`/catalog/tv/nuvio_sports_live.json`) testing memory latency and SWR refresh.
   - Stream resolution (`/stream/tv/nuvio_sport_<id>.json`) testing cold miss vs. warm hit acceleration (<15ms) and single-flight request coalescing.
   - Manifest proxy (`/api/manifest`) testing live playlist caching and negative cache handling.
4. *From constraint analysis (`ORIGINAL_REQUEST.md`)*: Existing application code must remain untouched; all performance tests and benchmark tools must reside in separate test files/scripts executable via Node.js.

## 3. Caveats
- Upstream live stream scraping involves third-party external networks if live fixtures are scraped on demand. For deterministic and isolated high-load testing, mock fixtures and mock upstream stream endpoints (similar to `scripts/test-e2e-caching.js`) should be utilized alongside real-world endpoints to avoid network flakiness and rate-limiting from external CDNs.
- Spawning `node src/index.js` spawns an asynchronous child process for `resolver/src/server.js`. Test runners must guarantee process cleanup on `process.on('exit')` or `SIGINT`/`SIGTERM` to prevent orphaned background processes.
- In `scripts/test-stream-resolve-cache.js`, line 86 tests `TTL floors at 20s`, but `StreamResolveCache.js:16` sets `MIN_TTL_MS = 60 * 1000` (60s). `test-e2e-caching.js` and `test-manifest-negative-and-swr.js` are fully aligned and pass with 100% success.

## 4. Conclusion
The survey phase is complete. The codebase, dependency tree, configuration options, server entry points, healthcheck readiness endpoints, caching layers (`StreamResolveCache`, `CacheService`, `manifestCache`), and existing test tools have been fully documented in `survey_report.md`. The design and implementation phases can proceed directly to build the programmatic load and performance testing suite.

## 5. Verification Method
1. Verify report existence and completeness:
   - Inspect `.agents/teamwork_preview_explorer_survey_1/survey_report.md`.
2. Verify existing test baseline:
   - Run `node scripts/test-e2e-caching.js` (25/25 passing)
   - Run `node scripts/test-manifest-negative-and-swr.js` (11/11 passing)
