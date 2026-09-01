# Comprehensive Survey Report: Nuvio Live Sports Plugin
**Project**: Nuvio Live Sports Plugin — Performance & Load Testing Survey  
**Date**: 2026-09-01  
**Agent**: Explorer 1 (`teamwork_preview_explorer_survey_1`)  
**Workspace**: `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin`  

---

## 1. Executive Summary

The **Nuvio Live Sports Plugin** (version 3.0.0) is a Node.js-based live sports streaming and metadata aggregation add-on designed for the Stremio and Nuvio media ecosystem. It aggregates real-time fixtures and streaming sources across dozens of live sports providers, executes automated stream health preflight checks, resolves HLS/M3U8 master playlists, rewrites proxy URLs, and exposes Stremio Addon SDK v1.6 compliant HTTP endpoints along with an Express-based video/manifest proxy.

The application relies on multi-tier caching architectures:
1. **`CacheService`**: Aggregated match fixture and catalog caching with Stale-While-Revalidate (SWR) background refresh.
2. **`StreamResolveCache`**: High-concurrency stream resolution cache featuring single-flight token mint coalescing (thundering herd protection), per-source adaptive TTL scaling (60s to 10m), negative caching for dead sources (30s), LRU capacity bounding (200 entries), and active match lifecycle pruning.
3. **Manifest Proxy Cache**: Short-TTL (3s positive, 15s negative) manifest caching with coalesced in-flight fetches for live HLS streams.
4. **Image & Logo Cache**: Local SVG placeholder and cached CDN channel logos.

This survey establishes the complete runtime, configuration, architecture, and testing landscape necessary to construct programmatic performance and load test suites without modifying existing application code.

---

## 2. Codebase Architecture & Structure

The repository is structured as a modular Node.js application leveraging Dependency Injection (DI) via **Awilix** (`InjectionMode.PROXY`):

```
.
├── src/
│   ├── index.js                  # Main entry point: Express server, SDK router, reverse proxy & handlers
│   ├── config.js                 # Shared runtime config (PORT, BASE_URL resolution)
│   ├── container.js              # Awilix DI container definition & provider registration
│   ├── manifest.js               # Stremio Addon manifest definition & catalog schemas
│   ├── catalog.js                # Catalog (/catalog/tv/*) and Meta (/meta/tv/*) route handlers
│   ├── streams.js                # Stream (/stream/tv/*) route handler, verification, & prewarming
│   ├── api.js                    # Legacy match scrapers and category normalization utilities
│   ├── timezone.js               # User timezone offset calculation utilities
│   ├── domain/
│   │   ├── MatchEntity.js        # Domain entity model for sports match fixtures
│   │   └── StreamEntity.js       # Domain entity model for resolved stream links
│   ├── services/
│   │   ├── CacheService.js       # Match fixture memory cache
│   │   ├── StreamResolveCache.js # Prewarm / verify-before-serve stream cache
│   │   ├── MatchAggregator.js    # Multi-provider match ingestion & deduplication engine
│   │   ├── CronService.js        # Background cron schedules (periodic sync & prewarming)
│   │   ├── CircuitBreakerService.js # Opossum circuit breaker for external scrapers
│   │   ├── M3U8ParserService.js  # M3U8 manifest parser for resolution, quality & bitrate
│   │   ├── ImageService.js       # SVG poster generation & image caching
│   │   ├── ChannelLogoService.js # TV channel logo scraper & resolver
│   │   ├── StreamScoringService.js # Heuristic quality scoring for resolved streams
│   │   ├── EmbedExtractorChain.js # Embedded web player iframe regex unpackers
│   │   └── YamlProviderBuilder.js # Dynamic YAML provider parser
│   └── providers/                # Scraping implementations for various stream providers
├── resolver/                     # Sub-package: Streamed.pk HLS resolver service (ES module)
│   ├── package.json
│   └── src/server.js             # HTTP server listening on RESOLVER_PORT (default 7003)
├── scripts/                      # Operational and test verification scripts
│   ├── measure-cache-hit.js      # CLI double-call benchmark measuring cold vs warm latency & stats
│   ├── test-e2e-caching.js       # Comprehensive E2E test verifying cache lifecycle & stats
│   ├── test-stream-resolve-cache.js # Unit test suite for StreamResolveCache
│   ├── test-manifest-negative-and-swr.js # Unit test suite for manifest negative caching & SWR
│   └── test-247-channels.js      # Direct 24/7 channel playback verification
├── public/                       # Static web UI assets (debugger index.html, configure.html)
├── Dockerfile                    # Container definition
├── docker-compose.yml            # Docker compose configuration
└── package.json                  # Root package configuration
```

---

## 3. Package Management, Engine, & Runtime Dependencies

### 3.1 Node Engine & Package Managers
- **Node.js Engine**: `>=22.0.0` (specified in `package.json` and `resolver/package.json`).
- **Package Manager**: Standard `npm` (with `package-lock.json`).
- **Module System**: Root workspace uses **CommonJS** (`require`/`module.exports`). The `resolver/` directory uses **ES Modules** (`"type": "module"`).

### 3.2 Key Dependencies & Roles
| Package | Version | Purpose |
|---|---|---|
| `express` | `^4.18.2` | Core HTTP server and API routing |
| `stremio-addon-sdk` | `^1.6.10` | Stremio Addon Protocol specification & router interface |
| `awilix` | `^13.0.5` | Inversion of Control / Dependency Injection container |
| `undici` | `^8.10.0` | High-performance HTTP client for fetching manifests and APIs |
| `impit` | `^0.14.3` | High-throughput HTTP client with persistent connection pooling |
| `node-cron` | `^4.6.0` | Scheduled background ingestion and cache prewarming jobs |
| `opossum` | `^10.0.0` | Circuit breaker pattern implementation for upstream provider scrapers |
| `m3u8-parser` | `^7.2.0` | Parse and inspect HLS master manifests |
| `cheerio`, `jsdom`, `happy-dom` | various | HTML parsing and DOM manipulation for provider extractors |
| `http-proxy-middleware` | `^4.2.0` | Proxies `/api` routes to internal resolver process |
| `dotenv` | `^17.4.2` | Environment variable loader |
| `jest` | `^30.4.2` | Unit testing framework |

---

## 4. Server Startup Entry Points & Runtime Configuration

### 4.1 Startup Commands
1. **Direct Node (Development / Source)**:
   ```bash
   node src/index.js
   ```
2. **Production Bundled**:
   ```bash
   node dist/index.js
   # Or via npm script:
   npm start
   ```
3. **Development Watch Mode**:
   ```bash
   npm run dev
   # Executes: node --watch-path=src src/index.js
   ```

### 4.2 Sub-Process Spawning (`resolver`)
When `src/index.js` boots, it automatically spawns the internal stream resolver process located at `resolver/src/server.js` using `child_process.spawn`:
- **Resolver Port**: Defaults to `7003` (or `process.env.RESOLVER_PORT`).
- **Communication**: Express proxies all `/api/*` traffic (except intercepted endpoints like `/api/matches` and `/api/manifest`) to `http://127.0.0.1:${RESOLVER_PORT}/api`.
- **Process Lifecycle**: The parent process registers `SIGINT`, `SIGTERM`, and `exit` handlers to cleanly kill the resolver child process upon shutdown.

### 4.3 Environment Variables & Configuration
| Variable | Default | Description |
|---|---|---|
| `PORT` | `7000` | Port on which the primary Express server listens |
| `HOST` / `IP` | `0.0.0.0` | Interface to bind Express server |
| `RESOLVER_PORT` | `7003` | Port for the spawned internal Streamed.pk resolver |
| `ADDON_URL` | Auto-detected | Base URL override for public links and manifest descriptors |
| `RENDER_EXTERNAL_URL` | `null` | Render.com external URL fallback |
| `WEBSITE_HOSTNAME` | `null` | Azure App Service external URL fallback |
| `CATALOG_REVALIDATE_MS` | `600000` (10m) | Stale-while-revalidate threshold for catalog sync |
| `RESIDENTIAL_PROXY` | `null` | Optional proxy URL for upstream scrapers |
| `LOW_MEMORY_MODE` | `null` | Toggles low memory configurations |

### 4.4 Background Jobs & Cron Schedules (`CronService`)
When the server starts (`container.resolve('cronService').start()`), the following tasks are scheduled:
1. **Initial Match Sync**: Kicks off 1000ms after boot via `setTimeout` to populate `CacheService`.
2. **Match Aggregator Sync**: Runs every 4 hours (`0 */4 * * *`) to fetch matches from providers and prune ended matches from `StreamResolveCache`.
3. **Popular Matches Prewarm**: Runs every 3 minutes (`*/3 * * * *`) to prewarm streams for up to 10 top live popular fixtures.
4. **Keep-Alive Ping**: If `RENDER_EXTERNAL_URL` is configured, pings `/health` every 14 minutes.

---

## 5. Endpoints & API Specification

### 5.1 Healthcheck & Telemetry Endpoint
- **`GET /health`**
  - **Description**: Returns service health status and detailed internal statistics from `StreamResolveCache`.
  - **Status Code**: `200 OK`
  - **Sample Response**:
    ```json
    {
      "status": "ok",
      "service": "nuvio-live-sports",
      "streamResolveCache": {
        "entries": 12,
        "inFlight": 0,
        "hits": 45,
        "misses": 8,
        "negativeHits": 2,
        "evictions": 0,
        "learnedTtls": {
          "iptv-org": 120000,
          "streamfree": 240000
        }
      }
    }
    ```

### 5.2 Stremio Addon Protocol Endpoints
All endpoints support optional `/:config` prefix (base64url or URL-encoded JSON) for user-configured sports, timezone, or team filters.

1. **Manifest**:
   - `GET /manifest.json` or `GET /:config/manifest.json`
   - Returns Stremio Addon manifest with registered catalogs (`nuvio_sports_live`, `nuvio_sports_football`, `nuvio_sports_networks`, etc.).

2. **Catalog (List Matches)**:
   - `GET /catalog/tv/:catalogId.json` (e.g. `/catalog/tv/nuvio_sports_live.json`)
   - Optional search query: `?search=Arsenal`
   - Triggers fire-and-forget SWR refresh via `CronService.ensureFresh()` if catalog is older than 10 minutes.
   - Response: `{ "metas": [ { "id": "nuvio_sport_<matchId>", "type": "tv", "name": "...", "poster": "..." } ] }`

3. **Meta (Match Detail & JIT Prewarm)**:
   - `GET /meta/tv/:id.json` (e.g. `/meta/tv/nuvio_sport_12345.json`)
   - Returns match metadata and triggers asynchronous Just-In-Time (JIT) prewarming for top sources.
   - Response: `{ "meta": { "id": "...", "name": "...", "description": "...", "poster": "..." } }`

4. **Stream (Resolve Stream URLs)**:
   - `GET /stream/tv/:id.json` (e.g. `/stream/tv/nuvio_sport_12345.json`)
   - Resolves active sources through `StreamResolveCache.getOrCreate()`.
   - Returns direct HLS streams (`⚡ Direct Stream`) and web player fallbacks (`🌐 Web Stream`).
   - Response:
     ```json
     {
       "streams": [
         {
           "name": "⚡ Direct Stream",
           "title": "⚽ StreamFree\n📺 Quality: 1080p",
           "url": "http://127.0.0.1:7000/api/manifest?url=...",
           "behaviorHints": { "bingeGroup": "nuvio_sport_12345" }
         }
       ],
       "cacheMaxAge": 30,
       "staleRevalidate": 30,
       "staleError": 60
     }
     ```

### 5.3 Proxies and Helper APIs
1. **`GET /api/matches`**: Returns all cached match entities from `CacheService.getMatches()`.
2. **`GET /api/manifest`**: Manifest proxy with URL rewriting (`url`, `referer`, `origin`), caching headers, and `X-Manifest-Cache: HIT | MISS | NEGATIVE`.
3. **`GET /api/proxy-embed`**: CORS proxy for embed pages with strict domain allowlist (SSRF protected).
4. **`GET /watch`**: Embed player proxy page (`mode=extract` or iframe embed).
5. **`GET /img` & `GET /img/placeholder`**: SVG poster card generation and upstream image caching.

---

## 6. Caching Architecture & Behavioral Mechanisms

### 6.1 `CacheService` (`src/services/CacheService.js`)
- **Storage**: In-memory array of match objects.
- **TTL**: 5 minutes (`CACHE_TTL = 300000ms`).
- **Stale-While-Revalidate**: Monitored by `CronService.ensureFresh()`. If `isStale(10 min)` is true, serves the cached list instantly and triggers a background sync.

### 6.2 `StreamResolveCache` (`src/services/StreamResolveCache.js`)
- **Key Structure**: `${sourceName}:${matchId}:${streamId}` (e.g., `streamfree:102938:stream_1`).
- **Single-Flight Coalescing**: Tracks in-flight mint promises in `inFlight = new Map()`. If 50 concurrent requests arrive for the same cold key, only 1 upstream resolution executes; the other 49 await the same Promise.
- **Adaptive TTL**:
  - Initial default TTL: 60 seconds (`defaultTtlMs = 60000`).
  - Preflight verification success (`noteSuccess`): doubles the source's TTL up to a maximum of 10 minutes (`MAX_TTL_MS = 600000`).
  - Preflight verification failure (`noteFailure`): halves the source's TTL down to a floor of 60 seconds (`MIN_TTL_MS = 60000`) and immediately evicts the cached entry.
- **Negative Caching**:
  - Failed resolutions or empty stream lists are cached with `status: 'failed'` for 30 seconds (`negativeTtlMs = 30000`).
  - During this window, subsequent calls return `[]` instantly without scraping or throwing errors.
- **Clone-On-Read**: Returns `{ ...stream }` shallow clones on every read so downstream stream title/header alterations do not mutate cached originals.
- **LRU Eviction**: Bounds storage to `maxEntries = 200`. Sorts by `lastAccess` when capacity is exceeded.
- **Lifecycle Pruning**: `pruneEnded(activeMatchIds)` discards entries for matches that finished, while preserving evergreen 24/7 channels (`CHANNEL_MATCH_ID = '__channel__'`).
- **Telemetry Counters**: Tracks `hits`, `misses`, `negativeHits`, and `evictions`.

### 6.3 Manifest Proxy Cache (`src/index.js`)
- **Key Structure**: `${targetUrl}|${referer}|${origin}`
- **Positive TTL**: 3 seconds (`MANIFEST_TTL_MS = 3000`).
- **Negative TTL**: 15 seconds (`MANIFEST_NEGATIVE_TTL_MS = 15000`) for non-M3U8 responses or upstream errors.
- **Capacity**: 100 entries (`MANIFEST_CACHE_MAX = 100`).
- **Single-Flight**: Coalesces concurrent playlist polls via `manifestInFlight`.
- **Response Headers**: Emits `X-Manifest-Cache: HIT`, `X-Manifest-Cache: MISS`, or `X-Manifest-Cache: NEGATIVE`.

---

## 7. Existing Test Harnesses & Tools

| Script / Test File | Type | Execution Command | Description |
|---|---|---|---|
| `scripts/measure-cache-hit.js` | Benchmark | `node scripts/measure-cache-hit.js` | Direct double-call measurement of `handleStream` on real catalog data; computes speedup ratio and cache hit counters. |
| `scripts/test-e2e-caching.js` | E2E Suite | `node scripts/test-e2e-caching.js` | Mocks local HLS server and tests 7 core caching capabilities: DI registration, JIT prewarm, hit latency, single-flight coalescing, negative caching, adaptive TTL, and telemetry. |
| `scripts/test-stream-resolve-cache.js` | Unit Test | `node scripts/test-stream-resolve-cache.js` | Pure unit tests for `StreamResolveCache` methods (TTL math, LRU eviction, clone-on-read, single-flight). |
| `scripts/test-manifest-negative-and-swr.js` | Integration Test | `node scripts/test-manifest-negative-and-swr.js` | Tests manifest proxy negative caching and catalog SWR background refresh. |
| `test-health.js` | Sanity Check | `node test-health.js` | Simple HTTP client that pings `http://localhost:7000/health` and logs JSON output. |
| `test-e2e.js` | Integration | `node test-e2e.js` | Ingests live matches, resolves a match, and outputs `e2e-audit-data.json`. |

---

## 8. Blueprint for Programmatic Performance & Load Testing

To fulfill the requirements of `ORIGINAL_REQUEST.md`, any performance and load testing framework designed for this workspace must implement the following operational flow:

### 8.1 Server Lifecycle Management
1. **Port Allocation**: Select an available port (e.g. `PORT=7010`, `RESOLVER_PORT=7013`) to avoid port conflicts with already-running instances.
2. **Process Spawning**: Spawn `node src/index.js` with inherited environment variables (`PORT`, `RESOLVER_PORT`, `HOST=127.0.0.1`).
3. **Readiness Verification**: Poll `GET http://127.0.0.1:${PORT}/health` every 100-200ms until `200 OK` is returned with `{ status: 'ok' }` (timeout after 15-30s).
4. **Graceful Teardown**: Upon test completion (or failure/interruption), send `SIGTERM`/`SIGINT` to the spawned server process, ensuring the child resolver process is also terminated.

### 8.2 Workload Scenarios to Exercise
1. **Healthcheck Baseline (`GET /health`)**: High-concurrency throughput baseline and telemetry overhead check.
2. **Catalog Load (`GET /catalog/tv/nuvio_sports_live.json`)**: Measure throughput and latency under concurrent catalog browsing; verify SWR behavior.
3. **Cold vs. Warm Stream Resolution (`GET /stream/tv/nuvio_sport_<id>.json`)**:
   - **Cold Phase (Miss)**: Initial concurrent calls triggering resolution and preflight checks.
   - **Warm Phase (Hit)**: Repeated concurrent calls for the same fixture validating sub-15ms hit latency and hit ratio scaling.
4. **Single-Flight / Thundering Herd Simulation**:
   - Fire $N$ (e.g. 50–100) simultaneous requests for an un-cached fixture.
   - Verify that internal `misses` increments by the number of unique sources, not $N \times \text{sources}$.
5. **Manifest Proxy Concurrency (`GET /api/manifest?url=...`)**:
   - Simulate player polling loops (re-requesting every 2s) to verify manifest cache hits and negative cache eviction.

### 8.3 Required Performance & Health Metrics
- **Throughput**: Requests per second (RPS / req/s).
- **Latency Distribution**: Min, Mean, Median (P50), P95, P99, Max latency.
- **Cache Hit / Miss Ratio**:
  - Client-side calculated ratio (Warm requests / Total requests).
  - Server-side reported telemetry via `GET /health` (`hits`, `misses`, `negativeHits`, `evictions`).
- **Error Rates**: HTTP 4xx, 5xx status counts and connection timeout percentages.
- **Stability under Concurrency**: Pipeline memory behavior and absence of unhandled rejections or deadlocks under load.

---

## 9. Conclusion

The Nuvio Live Sports Plugin codebase is well-structured, modular, and possesses sophisticated built-in caching and single-flight concurrency safeguards. All endpoints and runtime requirements are fully mapped. A standalone programmatic load testing suite can now be engineered to boot the server, exercise concurrent load against `/health`, `/catalog/tv/*`, `/stream/tv/*`, and `/api/manifest`, and output clear, checkable metrics.
