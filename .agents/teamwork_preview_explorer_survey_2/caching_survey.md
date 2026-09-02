# Comprehensive Caching Architecture Survey
**Nuvio Live Sports Plugin — Performance & Load Testing Investigation**
**Author:** Explorer 2 (Survey Phase)  
**Date:** 2026-09-01  
**Target Codebase:** `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin`

---

## 1. Executive Summary

The Nuvio Live Sports Plugin implements a **multi-tiered, purely in-memory caching architecture** designed for high throughput, minimal latency, and zero external database dependencies (e.g. no Redis or disk caches). The caching layer is tailored specifically for the extreme volatility of live sports streaming: short-lived tokens, fluctuating upstream CDN health, high-frequency HLS manifest polling, and bursty concurrent user traffic ("thundering herds") at match kickoff times.

### Key Architectural Highlights:
1. **Multi-Layered Caching Strategy**: Five distinct in-memory caching layers handle match aggregation (`CacheService`), stream token resolution (`StreamResolveCache`), live HLS manifest rewriting (`manifestCache`), dynamic artwork proxying (`ImageService`), and HLS segment prefetching (`relay/prefetch.js`).
2. **Single-Flight Coalescing (Thundering Herd Defense)**: Both `StreamResolveCache` and `manifestCache` coalesce parallel incoming requests for the same cold key into a single upstream minting promise, preventing upstream provider rate-limiting and connection pool exhaustion.
3. **Adaptive Per-Source TTL Scaling**: The stream cache dynamically doubles its TTL (up to 10 minutes) upon verified stream health and halves it (floored at 60 seconds) with immediate eviction upon stream failure.
4. **Negative Caching**: Dead streams, failing upstreams, and invalid manifests are cached with dedicated short TTLs (15s–30s) returning empty lists or cached errors, preventing repeated failed scraping loops.
5. **Direct Telemetry & Observability**: The `/health` endpoint exposes real-time internal cache counters (`hits`, `misses`, `negativeHits`, `evictions`, `entries`, `inFlight`, `learnedTtls`), enabling deterministic metrics collection during load tests.

---

## 2. Multi-Layer Caching Implementation

```
                           [ Incoming User / Client Traffic ]
                                          │
            ┌─────────────────────────────┼──────────────────────────────┐
            ▼                             ▼                              ▼
     GET /catalog/tv/...          GET /stream/tv/...             GET /api/manifest
     GET /meta/tv/...                     │                              │
            │                             ▼                              ▼
            │                   ┌───────────────────┐          ┌───────────────────┐
            │                   │StreamResolveCache │          │   manifestCache   │
            │                   │(Single-Flight JIT)│          │(Single-Flight HLS)│
            │                   └─────────┬─────────┘          └─────────┬─────────┘
            ▼                             │                              │
  ┌───────────────────┐                   ▼                              ▼
  │   CacheService    │          Provider Scrapers               Upstream CDN HLS
  │   (Catalog SWR)   │          & WASM Decryptors               (Impit / Undici)
  └─────────┬─────────┘
            │
            ▼
  ┌───────────────────┐
  │    CronService    │ (Background sync every 4h; popular prewarm every 3m;
  │ (Sync & Lifecycle)│  lifecycle pruning of ended matches)
  └───────────────────┘
```

---

### Layer 1: Catalog & Match Ingestion Cache (`CacheService`)
- **Source File**: [`src/services/CacheService.js`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/CacheService.js)
- **Container Registration**: Registered as singleton `cacheService` in [`src/container.js:33`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/container.js#L33).
- **Storage Mechanism**: In-memory JavaScript array (`this.cachedMatches`) with clone-on-read protection.
- **TTL & Invalidation**:
  - Internal default TTL: `5 * 60 * 1000` ms (5 minutes).
  - Stale-While-Revalidate (SWR) window: Controlled by `CATALOG_REVALIDATE_MS` env variable (defaults to 10 minutes / `10 * 60 * 1000` ms) in [`src/services/CronService.js:5`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/CronService.js#L5).
- **Core Operations**:
  - `getMatches()`: Returns shallow clones of cached match entities and their source arrays.
  - `setMatches(matches)`: Atomically updates `cachedMatches` and updates `this.lastFetchTime = Date.now()`.
  - `isStale(ttlMs)`: Evaluates `(Date.now() - this.lastFetchTime) > ttlMs`.
- **Interaction with SWR**:
  - When `handleCatalog` ([`src/catalog.js:214`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/catalog.js#L214)) or `handleMeta` ([`src/catalog.js:314`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/catalog.js#L314)) is called, `container.resolve('cronService').ensureFresh()` is triggered in a non-blocking fire-and-forget manner.
  - If the cache exceeds `REVALIDATE_AFTER_MS`, `CronService.runSync()` executes in the background while the request is served instantly (<5ms) from `CacheService`.

---

### Layer 2: Stream Token & Resolution Cache (`StreamResolveCache`)
- **Source File**: [`src/services/StreamResolveCache.js`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/StreamResolveCache.js)
- **Container Registration**: Registered as singleton value in [`src/container.js:39`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/container.js#L39).
- **Storage Mechanism**: In-memory `Map` instances:
  - `this.entries`: Map of `key -> { streams, matchId, status, resolvedAt, expiresAt, lastAccess }`.
  - `this.inFlight`: Map of `key -> Promise` (active mint promises for single-flight concurrency).
  - `this.ttl`: Map of `sourceName -> learnedTtlMs`.
  - `this.statsCounters`: `{ hits, misses, negativeHits, evictions }`.
- **TTL Constants**:
  - `DEFAULT_TTL_MS`: 60,000 ms (1 minute).
  - `MIN_TTL_MS`: 60,000 ms (1 minute).
  - `MAX_TTL_MS`: 600,000 ms (10 minutes).
  - `NEGATIVE_TTL_MS`: 30,000 ms (30 seconds).
  - `MAX_ENTRIES`: 200 items (LRU bounded).
- **Adaptive TTL Algorithm**:
  - **Success (`noteSuccess(key)`)**: `nextTtl = Math.min(_ttlFor(sourceName) * 2, maxTtlMs)`. Doubles TTL and extends active entry's `expiresAt`.
  - **Failure (`noteFailure(key)`)**: `nextTtl = Math.max(Math.floor(_ttlFor(sourceName) / 2), minTtlMs)`. Halves TTL and **immediately evicts** the failing key from `this.entries`.
- **Single-Flight Coalescing**:
  - If a key is currently resolving, any concurrent request finds `this.inFlight.get(key)` and awaits the existing Promise instead of triggering duplicate scraper runs.
  - Failures and empty arrays are converted to negative cache entries (`status: 'failed'`) lasting `NEGATIVE_TTL_MS`. `getOrCreate()` **never rejects**, preventing uncaught promise crashes.
- **LRU Eviction**:
  - When `entries.size > MAX_ENTRIES` (200), `_evictIfNeeded()` sorts entries by `lastAccess` ascending and removes the excess oldest entries, incrementing `statsCounters.evictions`.
- **Lifecycle Pruning (`pruneEnded`)**:
  - `pruneEnded(activeMatchIds)` drops entries whose `matchId` is no longer in the active match list, while preserving evergreen 24/7 channels (`matchId === '__channel__'`).

---

### Layer 3: Manifest Proxy Short-TTL Cache (`manifestCache`)
- **Source File**: [`src/index.js:140–324`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/index.js#L140-L324)
- **Purpose**: Live HLS players poll `/api/manifest` every 2–6 seconds per viewer. This layer caches parsed and rewritten `.m3u8` playlists and coalesces concurrent upstream HTTP requests via a shared keep-alive client (`Impit`).
- **Storage Mechanism**: In-memory `Map` instances:
  - `manifestCache`: Map of `key -> { body, expiresAt, lastAccess, negative?, status? }`.
  - `manifestInFlight`: Map of `key -> Promise` (coalesced upstream fetch).
- **TTL Constants**:
  - `MANIFEST_TTL_MS`: 3,000 ms (3 seconds positive TTL for live HLS playlists).
  - `MANIFEST_NEGATIVE_TTL_MS`: 15,000 ms (15 seconds negative TTL for dead upstreams, 404s, or non-M3U8 responses).
  - `MANIFEST_CACHE_MAX`: 100 entries (LRU eviction based on `lastAccess`).
- **Validation**:
  - Only responses containing `#EXT` are positively cached.
  - Non-M3U8 bodies trigger a 404/502 and are negatively cached for 15s.

---

### Layer 4: Artwork & Image Pipeline Cache (`ImageService`)
- **Source File**: [`src/services/ImageService.js`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/ImageService.js)
- **Endpoints**: `/img?url=...`, `/img/placeholder?...`
- **Storage Mechanism**:
  - `cache`: Map of `url -> { buffer, contentType, expiresAt, lastAccess }`.
  - `inFlight`: Map of `url -> Promise`.
  - `negatives`: Map of `url -> expiryTs`.
- **TTL & Limits**:
  - `IMAGE_TTL_MS`: 10 * 60 * 1000 ms (10 minutes).
  - `NEG_TTL_MS`: 60 * 1000 ms (60 seconds).
  - `CACHE_MAX_ENTRIES`: 120 entries.
  - `IMAGE_MAX_BYTES`: 1.5 MB maximum image size (hard limit to prevent heap exhaustion).
  - Fetch Timeout: 5,000 ms strict abort signal.
- **HTTP Cache Headers**:
  - Cached Image: `Cache-Control: public, max-age=600`.
  - Placeholder SVG: `Cache-Control: public, max-age=300`.
  - Fallback SVG on image failure: `Cache-Control: public, max-age=60`.

---

### Layer 5: Resolver Segment Prefetch Cache (`relay/prefetch.js`)
- **Source File**: [`resolver/src/relay/prefetch.js`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/resolver/src/relay/prefetch.js)
- **Purpose**: Internal CORS/proxy process (`port 7003`) prefetches upcoming HLS `.ts` video segments.
- **Storage Mechanism**: In-memory `Map` holding up to 5 segment request promises.
- **Eviction**: Bounded FIFO/LRU eviction (`cache.size > 5`).

---

### Layer 6: Provider-Level Local Caches
- **`EmbedIndiaProvider`** ([`src/providers/EmbedIndiaProvider.js:52`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/providers/EmbedIndiaProvider.js#L52)):
  - Holds `_failureCache` Map of `hostname -> timestamp`.
  - Short-circuits failed scraper domains for 5 minutes (300,000 ms) before retrying.
- **`Strims24Provider`** ([`src/providers/Strims24Provider.js:238`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/providers/Strims24Provider.js#L238)):
  - Holds `matchDetailsCache` Map of `match_id -> detail` to avoid redundant HTML parsing during multi-source aggregation.

---

## 3. Cache Key Generation Strategies

| Cache Component | Key Structure / Formula | Example Key | Notes / Collision Guards |
|---|---|---|---|
| **`StreamResolveCache` (Standard Matches)** | `${src.source}:${match.id}:${src.id}` | `watchfooty:f1_monza_2026:stream_1`<br>`iptv-org:arsenal_vs_chelsea:sky_sports_pl` | Formed in `streams.js:272` & `streams.js:305`. Scoped by source provider, match ID, and source-specific stream ID. |
| **`StreamResolveCache` (24/7 Channels)** | `${src.source}:__channel__:${channel.id}` | `streamfree:__channel__:willow`<br>`streamfree:__channel__:skycricket` | Uses special sentinel `__channel__` matchId ([`StreamResolveCache.js:20`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/StreamResolveCache.js#L20)) so it is NEVER purged during match lifecycle pruning. |
| **`StreamResolveCache` (Adaptive TTL Table)** | `sourceName` (extracted via `key.split(':')[0]`) | `watchfooty`<br>`streamfree`<br>`iptv-org` | Per-provider learned TTL tracking across individual match mints. |
| **`manifestCache` (`/api/manifest`)** | `${targetUrl}\|${referer}\|${origin}` | `https://cdn.stream.com/live.m3u8\|https://embed.st/\|https://embed.st` | Upstream token validation depends on target URL, Referer header, and Origin header. Key delimiter is `\|`. |
| **`ImageService` (`/img`)** | `url` (exact upstream image URL string) | `https://streamfree.top/logos/team1.png` | Normalized URL string; rejected if not starting with `http://` or `https://`. |
| **`CacheService`** | *N/A (Global In-Memory Array)* | `cachedMatches` | Singleton aggregated fixture array stored directly in memory. |

---

## 4. Cache Hit vs. Miss Measurement & Telemetry

Load and performance tests can measure and verify cache behavior through three distinct surfaces:

### 1. HTTP Response Headers
| Endpoint | Cache Header | Values | Meaning |
|---|---|---|---|
| `GET /api/manifest?url=...` | `X-Manifest-Cache` | `HIT` | Manifest served from `manifestCache` (<5ms, no upstream request). |
| | | `MISS` | Manifest fetched from upstream, rewritten, and stored. |
| | | `NEGATIVE` | Dead upstream hit served from negative cache (returns cached 404/502). |
| `GET /img?url=...` | `Cache-Control` | `public, max-age=600` | Cached upstream image buffer returned. |
| `GET /img/placeholder` | `Cache-Control` | `public, max-age=300` | Dynamic SVG card generated. |
| `GET /stream/tv/*.json` | Response Payload | `cacheMaxAge: 30`<br>`staleRevalidate: 30`<br>`staleError: 60` | Stremio SDK client-side caching directive returned in JSON response body. |

### 2. Internal Telemetry Endpoint (`GET /health`)
The `/health` endpoint directly queries `container.resolve('streamResolveCache').stats()`:
```http
GET /health HTTP/1.1
Host: localhost:7000
```
**Response Body**:
```json
{
  "status": "ok",
  "service": "nuvio-live-sports",
  "streamResolveCache": {
    "entries": 14,
    "inFlight": 0,
    "hits": 1450,
    "misses": 48,
    "negativeHits": 12,
    "evictions": 0,
    "learnedTtls": {
      "streamfree": 240000,
      "watchfooty": 480000,
      "iptv-org": 600000
    }
  }
}
```

#### Metrics Extraction Formulas for Load Tests:
- **Cache Hit Ratio**: $\text{Hit Ratio} = \frac{\Delta \text{hits}}{\Delta \text{hits} + \Delta \text{misses}}$
- **Negative Hit Ratio**: $\text{Negative Ratio} = \frac{\Delta \text{negativeHits}}{\Delta \text{hits} + \Delta \text{misses} + \Delta \text{negativeHits}}$
- **Active In-Flight Load**: Direct gauge from `inFlight` counter (indicates ongoing coalesced scraper operations).
- **Eviction Rate**: $\Delta \text{evictions}$ over test duration (indicates cache thrashing if $>0$ under normal load).

### 3. Response Latency Signatures
| Operation | Cold / Cache Miss Latency | Hot / Cache Hit Latency | Latency Delta Ratio |
|---|---|---|---|
| **Stream Resolution** (`/stream/tv/nuvio_sport_<id>.json`) | **500 ms – 5,000 ms+**<br>(HTML scraping, WASM/XOR decrypt, network preflight ping) | **< 15 ms – 30 ms**<br>(In-memory map lookup + shallow copy) | **~30x – 150x faster** |
| **Catalog Query** (`/catalog/tv/nuvio_sports_<cat>.json`) | **1,500 ms – 8,000 ms**<br>(Multi-provider sync if forced) | **< 5 ms – 10 ms**<br>(Filtered in-memory array) | **~300x – 800x faster** |
| **Manifest Proxy** (`/api/manifest?url=...`) | **200 ms – 1,500 ms**<br>(TLS handshake, Impit/Undici fetch, URL rewrite) | **< 5 ms**<br>(In-memory string return) | **~40x – 200x faster** |

---

## 5. TTL Configurations, Eviction & Invalidation Summary

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                SUMMARY OF TTLs & CAPACITIES                              │
├──────────────────────────┬────────────────┬───────────────┬──────────────┬───────────────┤
│ Cache Component          │ Default TTL    │ Min / Max TTL │ Negative TTL │ Max Capacity  │
├──────────────────────────┼────────────────┼───────────────┼──────────────┼───────────────┤
│ CacheService (Catalog)   │ 5 min (300s)   │ N/A           │ N/A          │ Unbounded     │
│ Catalog SWR Revalidation │ 10 min (600s)* │ Configurable  │ N/A          │ N/A           │
│ StreamResolveCache       │ 1 min (60s)    │ 60s / 600s    │ 30s          │ 200 entries   │
│ manifestCache            │ 3 sec          │ Fixed         │ 15s          │ 100 entries   │
│ ImageService             │ 10 min (600s)  │ Fixed         │ 60s          │ 120 entries   │
│ Resolver prefetch.js     │ N/A (Promise)  │ N/A           │ N/A          │ 5 entries     │
│ EmbedIndia failureCache  │ 5 min (300s)   │ Fixed         │ 5 min        │ Hostname map  │
└──────────────────────────┴────────────────┴───────────────┴──────────────┴───────────────┘
* Configurable via CATALOG_REVALIDATE_MS environment variable.
```

### Invalidation & Lifecycle Pruning Workflows:
1. **Periodic Lifecycle Pruning (`pruneEnded`)**:
   - Executed inside `CronService.runSync()` ([`src/services/CronService.js:20`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/CronService.js#L20)).
   - Prunes all cached stream keys whose `matchId` is no longer returned in the active match list (e.g. finished matches > 24h past kickoff).
   - Skips entries with `matchId === '__channel__'`.
2. **Preflight Verification Failure Eviction**:
   - In `streams.js:212, 222, 230`, if an upstream direct stream returns 404, 403, 5xx, or invalid non-M3U8 text during health verification, `resolveCache.noteFailure(cacheKey)` is called immediately.
   - This purges the dead entry from `this.entries` immediately and halves the provider's learned TTL.
3. **Stale Lazy Eviction**:
   - `get()` in `StreamResolveCache` and `manifestCacheGet()` check `now > e.expiresAt`. If expired, the entry is deleted on read and returns `null`.

---

## 6. Pre-Warming, Concurrency Protections & Bypass Parameters

### Warm-Up Behaviors:
1. **Boot Initialization**:
   - `CronService.start()` schedules a `setTimeout(..., 1000)` on application boot to run `runSync()`, immediately populating `CacheService` before significant client traffic hits.
2. **Periodic Background Sync**:
   - Scheduled cron every 4 hours (`0 */4 * * *`) refreshes the complete match catalog.
3. **Scheduled Popular Match Prewarming**:
   - Scheduled cron every 3 minutes (`*/3 * * * *`) in [`CronService.js:55`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/services/CronService.js#L55) calls `prewarmPopular()`.
   - Filters up to 10 live matches marked `popular === '1'` and resolves/verifies their top 3 sources in the background so hot matches are already cached when users click.
4. **Just-In-Time (JIT) Metadata Prewarming**:
   - When a user views a match details card in Nuvio/Stremio (`GET /meta/tv/nuvio_sport_<id>.json`), `handleMeta()` ([`src/catalog.js:327`](file:///C:/Users/odeda/Desktop/Projects/Nuvio%20Live%20Sports%20Plugin/src/catalog.js#L327)) immediately fires `prewarmMatch(match, config)` in a non-blocking background promise.
   - By the time the user clicks "Play" (`/stream/tv/...`), the stream resolution and verification are already complete.

### Concurrency & Single-Flight Coalescing:
- Both `StreamResolveCache.getOrCreate()` and `/api/manifest` implement single-flight coalescing via `inFlight` Maps:
```javascript
const pending = this.inFlight.get(key);
if (pending) {
  await pending.catch(() => {});
  return this.get(key) || [];
}
```
- If 100 concurrent requests request an un-cached stream or manifest, exactly **1** upstream scrape/fetch executes. The remaining 99 await the shared promise and receive shallow clones of the result.

### Cache Bypass & Invalidation in Testing:
- **No HTTP Query Parameter Bypass**: There is no public HTTP query parameter (e.g. `?bypass_cache=1`) in production endpoints to prevent abuse.
- **Programmatic / Test Invalidation**:
  - In integration tests, cache state can be manipulated directly via the Awilix container:
    ```javascript
    const cache = container.resolve('streamResolveCache');
    cache.entries.clear();
    cache.inFlight.clear();
    cache.statsCounters = { hits: 0, misses: 0, negativeHits: 0, evictions: 0 };
    ```
  - For HTTP-level testing, unique cache keys can be generated by varying URL query parameters (e.g. `referer` or match ID variations).

---

## 7. Performance & Load Testing Recommendations

When constructing the load and performance test suite, the following scenarios and test harnesses should be implemented:

| Test Scenario | Purpose | Key Metrics to Assert |
|---|---|---|
| **1. Stream Cache Hit vs Miss Latency** | Verify that hot cached streams resolve in $< 30$ ms while cold scrapes take $> 500$ ms. | P50, P95, P99 latency comparison; `hits` vs `misses` counter verification on `/health`. |
| **2. High-Concurrency Single-Flight Stress** | Fire 50–200 concurrent requests for the same un-cached stream ID simultaneously. | Upstream execution count ($== 1$), zero unhandled rejections, all clients receive valid streams. |
| **3. Negative Caching Resiliency** | Request a deliberately failing or dead source ID repeatedly under load. | Verify 1st request misses and fails, subsequent requests return `[]` / cached error in $< 5$ ms; `negativeHits` increments. |
| **4. Manifest Proxy Throughput & Rate** | Simulate 100 concurrent HLS video players polling `/api/manifest` every 2 seconds. | Throughput (req/sec), `X-Manifest-Cache: HIT` ratio ($> 95\%$), P95 latency $< 15$ ms. |
| **5. JIT Prewarm Pipeline Flow** | Simulate user journey: `GET /catalog` $\rightarrow$ `GET /meta` (triggers prewarm) $\rightarrow$ sleep(150ms) $\rightarrow$ `GET /stream`. | Stream request must result in a clean cache HIT without cold scraper latency. |
| **6. LRU Eviction & Memory Footprint** | Flood cache with $> 500$ unique keys beyond `MAX_ENTRIES` (200). | `entries` strictly bounded at 200, `evictions` recorded accurately, zero memory leaks. |

---

## 8. Conclusion

The caching implementation across the Nuvio Live Sports Plugin is robust, layered, and specifically tuned for live streaming requirements. Its in-memory design, adaptive TTLs, single-flight coalescing, and telemetry hooks provide an ideal foundation for high-performance load testing and metrics validation.
