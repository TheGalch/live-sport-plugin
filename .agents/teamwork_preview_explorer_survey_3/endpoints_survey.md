# Endpoints Survey Report — Nuvio Live Sports Plugin

**Date**: 2026-09-01  
**Agent**: Explorer 3 (`teamwork_preview_explorer_survey_3`)  
**Project**: Nuvio Live Sports Plugin Performance & Load Testing  
**Authoritative Request**: Performance and load testing for caching service, cache hit/miss behavior, pipeline stability, P95 latency, throughput, error rates.

---

## 1. Executive Summary

The **Nuvio Live Sports Plugin** is a high-performance live sports aggregation add-on and streaming proxy designed for the Stremio/Nuvio ecosystem. It operates as an Express.js server (default port `7000`) managing an internal child-process stream resolver (default port `7003`), background cron sync workers, and multiple layers of in-memory caching (`CacheService`, `StreamResolveCache`, `ImageService`, `manifestCache`).

The server exposes 4 main categories of HTTP routes:
1. **Stremio Addon Protocol Routes** (`/manifest.json`, `/catalog/tv/*.json`, `/meta/tv/*.json`, `/stream/tv/*.json`)
2. **Streaming & Proxy Routes** (`/api/manifest`, `/api/proxy-embed`, `/watch`, and proxied `/api/hls/*`, `/api/stream`)
3. **Application & Media Endpoints** (`/api/matches`, `/img`, `/img/placeholder`, `/health`)
4. **Static & Web UI Routes** (`/`, `/configure`, `/:config/configure`, `/public/*`)

---

## 2. Complete Endpoint & Route Map

### 2.1 Stremio Addon Protocol Endpoints

#### 2.1.1 Addon Manifest
- **Route Paths**:
  - `GET /manifest.json`
  - `GET /:config/manifest.json`
- **Method**: `GET`
- **Path Parameters**:
  - `config` *(optional)*: Base64URL-encoded or URL-encoded JSON user configuration string (e.g., `%7B%22sports%22%3A%22football%2Ccricket%22%2C%22teams%22%3A%22Arsenal%22%7D`).
- **Headers**:
  - Request: None required (standard HTTP headers).
  - Response:
    - `Content-Type: application/json`
    - `Access-Control-Allow-Origin: *`
    - `Access-Control-Allow-Headers: *`
- **Upstream Dependencies**: Purely in-memory; modifies manifest catalog array according to `parsedConfig.sports` and `parsedConfig.teams`.
- **Response Structure (200 OK)**:
  ```json
  {
    "id": "community.nuvio.live-sports",
    "version": "3.0.0",
    "name": "🏆 Nuvio Live Sports",
    "description": "...",
    "logo": "https://upload.wikimedia.org/wikipedia/commons/...",
    "types": ["tv"],
    "resources": ["catalog", "meta", "stream"],
    "catalogs": [
      { "type": "tv", "id": "nuvio_sports_live", "name": "🔴 Live Now", "extra": [{ "name": "search", "isRequired": false }] },
      { "type": "tv", "id": "nuvio_sports_football", "name": "⚽ Soccer", "extra": [{ "name": "search", "isRequired": false }] },
      { "type": "tv", "id": "nuvio_sports_cricket", "name": "🏏 Cricket", "extra": [{ "name": "search", "isRequired": false }] }
    ],
    "config": [...],
    "idPrefixes": ["nuvio_sport_"],
    "behaviorHints": { "adult": false, "p2p": false, "configurable": true }
  }
  ```
- **Status Codes**: `200 OK`.
- **Load / Bottleneck Profile**: Minimal CPU / memory overhead; pure synchronous JSON serialization.

---

#### 2.1.2 Catalog Listing
- **Route Paths**:
  - `GET /catalog/:type/:id.json`
  - `GET /:config/catalog/:type/:id.json`
  - `GET /catalog/:type/:id/:extra.json`
  - `GET /:config/catalog/:type/:id/:extra.json`
- **Method**: `GET`
- **Path Parameters**:
  - `type`: Must be `'tv'`.
  - `id`: Catalog ID. Supported IDs:
    - `nuvio_sports_live` (currently live events)
    - `nuvio_sports_upcoming` (future kickoff events)
    - `nuvio_sports_networks` (24/7 TV channels)
    - `nuvio_sports_teams` (favorites based on user config)
    - Sport categories: `nuvio_sports_football`, `nuvio_sports_cricket`, `nuvio_sports_basketball`, `nuvio_sports_motorsport`, `nuvio_sports_hockey`, `nuvio_sports_baseball`, `nuvio_sports_mma`, `nuvio_sports_golf`, `nuvio_sports_tennis`, `nuvio_sports_rugby`, `nuvio_sports_american_football`, `nuvio_sports_darts`, `nuvio_sports_college`, `nuvio_sports_other`
  - `extra` *(optional)*: E.g., `search=Arsenal` or `skip=0`.
  - `config` *(optional)*: Base64URL or encoded JSON with `{ sports, teams, timezone }`.
- **Query Parameters**: Stremio SDK parses extra segments or query parameters.
- **Upstream Dependencies**:
  - Synchronously queries `CacheService.getMatches()` (in-memory array).
  - Background asynchronous trigger: `CronService.ensureFresh()` checks if cache age exceeds `CATALOG_REVALIDATE_MS` (default 10 minutes). If stale, fires a background match sync without blocking the response (Stale-While-Revalidate pattern).
- **Response Structure (200 OK)**:
  ```json
  {
    "metas": [
      {
        "id": "nuvio_sport_sf_12345",
        "type": "tv",
        "name": "🔴 LIVE: Arsenal vs Chelsea",
        "genres": ["FOOTBALL"],
        "poster": "http://localhost:7000/img?url=...&text=Arsenal%0Avs%0AChelsea&color=10b981",
        "posterShape": "landscape",
        "background": "http://localhost:7000/img?...",
        "logo": "http://localhost:7000/img?...",
        "releaseInfo": "LIVE",
        "description": "🏆 League: Premier League\n📅 Category: FOOTBALL\n⏰ Status: 🔴 LIVE NOW",
        "cast": ["Arsenal", "Chelsea"],
        "behaviorHints": {
          "defaultVideoId": "nuvio_sport_sf_12345"
        },
        "released": "2026-09-01T18:00:00.000Z"
      }
    ]
  }
  ```
- **Status Codes**: `200 OK` (returns `{ metas: [] }` on invalid catalog ID or type).
- **Load / Bottleneck Profile**:
  - High throughput possible when cache is warm.
  - Sorting and filtering 200–500 matches per request.
  - CPU cost in string manipulation and date parsing for timezone conversions.

---

#### 2.1.3 Match Meta Detail
- **Route Paths**:
  - `GET /meta/:type/:id.json`
  - `GET /:config/meta/:type/:id.json`
- **Method**: `GET`
- **Path Parameters**:
  - `type`: Must be `'tv'`.
  - `id`: Event ID prefixed with `nuvio_sport_` (e.g., `nuvio_sport_sf_12345`).
  - `config` *(optional)*: Configuration string.
- **Upstream Dependencies**:
  - Reads from `CacheService.getMatches()`.
  - Side effect: Triggers `prewarmMatch(match, config)` in the background (fire-and-forget). Prewarms the top 3 stream sources into `StreamResolveCache` so that subsequent clicks on `/stream/` are instant cache hits.
- **Response Structure (200 OK)**:
  ```json
  {
    "meta": {
      "id": "nuvio_sport_sf_12345",
      "type": "tv",
      "name": "🔴 LIVE: Arsenal vs Chelsea",
      "genres": ["FOOTBALL"],
      "poster": "http://localhost:7000/img?...",
      "posterShape": "landscape",
      "background": "http://localhost:7000/img?...",
      "logo": "http://localhost:7000/img?...",
      "releaseInfo": "LIVE",
      "description": "...",
      "cast": ["Arsenal", "Chelsea"],
      "behaviorHints": { "defaultVideoId": "nuvio_sport_sf_12345" }
    }
  }
  ```
- **Status Codes**: `200 OK` (or `{ meta: null }` if ID not found).
- **Load / Bottleneck Profile**:
  - Detail lookup is an $O(N)$ find on memory array.
  - Background `prewarmMatch` triggers asynchronous network fetches / WASM execution for stream sources. Under sudden traffic surges to a popular match meta page, multiple prewarms could be triggered (coalesced by `StreamResolveCache.inFlight`).

---

#### 2.1.4 Stream Resolution & Verification
- **Route Paths**:
  - `GET /stream/:type/:id.json`
  - `GET /:config/stream/:type/:id.json`
- **Method**: `GET`
- **Path Parameters**:
  - `type`: `'tv'`
  - `id`: `nuvio_sport_<matchId>`
  - `config` *(optional)*: May contain `sources` filter (e.g. `sources=streamfree,watchfooty`).
- **Middleware**: Intercepted by Stream URL Rewrite Middleware (`src/index.js:418-476`) which rewrites relative `/watch` and `/api/hls` URLs to absolute `BASE_URL` strings.
- **Upstream Dependencies & Resolution Pipeline**:
  1. Finds `MatchEntity` in `CacheService`.
  2. Selects candidate sources based on priority order:
     - `admin`, `echo`, `golf`, `delta` (Priority 1)
     - `watchfooty` (Priority 2)
     - `cdnlive` (Priority 3)
     - `streamsports99` (Priority 4)
     - `streamic` (Priority 5)
     - `strims24` (Priority 7)
     - `streamfree` (Priority 8)
     - `timstreams` (Priority 9)
     - `sportyhunter` (Priority 12)
     - `iptv-org` (Priority 14)
     - `embedindia` (Priority 15)
  3. Queries `StreamResolveCache.getOrCreate(key, mintFn)` for each source:
     - **Cache Hit**: Returns cached `StreamEntity[]` in < 2ms.
     - **In-Flight**: Coalesces concurrent calls for the same key onto a single active Promise.
     - **Cache Miss**: Calls `resolveSource(src, match, config)`:
       - May execute scrapers, HTTP requests, or WASM child processes (`run_wasm_native.js`, `run_gasm_india.js`).
       - Executes `verifyStreams()`: Pings candidate direct M3U8 URLs with a 2-second timeout to verify 200 OK + `#EXT` presence; parses master playlist bitrate/resolution via `M3U8ParserService`.
       - Adapts learned TTL: preflight success doubles TTL (up to 10m); failure halves TTL (down to 1m) and negative-caches for 30s.
  4. Formats stream titles, assigns icons, scores streams via `StreamScoringService`, and sorts direct streams first by score descending.
- **Response Structure (200 OK)**:
  ```json
  {
    "streams": [
      {
        "name": "⚡ Direct Stream",
        "title": "⚽ StreamFree | 📺 Sky Sports Main Event\n📺 Quality: 1080p\n👥 1420 Viewers",
        "url": "http://localhost:7000/api/manifest?url=https%3A%2F%2Fcdn1.streamfree.top%2Flive-cdn%2F...&referer=https%3A%2F%2Fstreamfree.top%2F&origin=https%3A%2F%2Fstreamfree.top",
        "score": 95,
        "behaviorHints": {
          "bingeGroup": "nuvio_sport_sf_12345",
          "notWebReady": true,
          "proxyHeaders": {
            "request": {
              "Referer": "https://streamfree.top/",
              "Origin": "https://streamfree.top"
            }
          }
        }
      },
      {
        "name": "🌐 Web Stream",
        "title": "⚽ TimStreams (Stream 1) (Web)\n📺 Quality: Auto",
        "externalUrl": "http://localhost:7000/watch?url=https%3A%2F%2Flogic.icelanders.st%2Fembed%2F...&title=Arsenal%20vs%20Chelsea",
        "score": 45,
        "behaviorHints": {
          "bingeGroup": "nuvio_sport_sf_12345"
        }
      }
    ],
    "cacheMaxAge": 30,
    "staleRevalidate": 30,
    "staleError: 60
  }
  ```
- **Status Codes**: `200 OK`.
- **Load / Bottleneck Profile**:
  - **CRITICAL BOTTLENECK**: Cache miss latency ranges from 800ms to 4500ms due to multi-source external scraping + preflight ping verification + WASM subprocess execution.
  - **Cache Hit Latency**: 1ms – 10ms.
  - Primary target for concurrency and cache hit/miss load testing.

---

### 2.2 Streaming & Proxy Endpoints

#### 2.2.1 HLS Live Manifest Proxy (`/api/manifest`)
- **Route Path**: `GET /api/manifest`
- **Method**: `GET`
- **Query Parameters**:
  - `url` *(required)*: Upstream M3U8 target URL.
  - `referer` *(optional)*: Upstream HTTP Referer header (default: `https://embed.st/`).
  - `origin` *(optional)*: Upstream HTTP Origin header (default: `https://embed.st`).
- **Headers**:
  - Request: Standard HTTP.
  - Response:
    - `Content-Type: application/vnd.apple.mpegurl`
    - `Access-Control-Allow-Origin: *`
    - `X-Manifest-Cache: HIT | MISS | NEGATIVE`
- **Caching Mechanism**:
  - Positive Cache TTL: `3000ms` (3 seconds). Max 100 entries with LRU access eviction.
  - Negative Cache TTL: `15000ms` (15 seconds) for non-m3u8 responses or 404/5xx errors.
  - Request Coalescing: `manifestInFlight` Map ensures only 1 upstream fetch occurs per distinct `${targetUrl}|${referer}|${origin}` key.
  - HTTP Fetcher: Shared `Impit` client with 10s race timeout, falling back to `undici.request`.
- **Rewriting Rules**:
  - Sub-manifest URLs containing `.m3u8` are rewritten to point back to `/api/manifest?url=...`.
  - Query parameters from master manifest are propagated to chunk URLs.
  - Media segment files ending in `.image` or `.js` without `.ts` have `#.ts` appended for mobile player compatibility.
- **Status Codes**:
  - `200 OK`: Valid M3U8 playlist returned.
  - `400 Bad Request`: Missing `?url` parameter.
  - `404 Not Found`: Upstream returned non-M3U8 body or expired stream.
  - `502 Bad Gateway`: Network error, upstream timeout, or fetch failure.
- **Load Profile**:
  - Called continuously every 2–6 seconds per active HLS video player.
  - High concurrency risk: 100 concurrent viewers on 1 live match generate 20–50 req/s to this single endpoint.

---

#### 2.2.2 CORS Embed HTML Proxy (`/api/proxy-embed`)
- **Route Path**: `GET /api/proxy-embed`
- **Method**: `GET`
- **Query Parameters**:
  - `url` *(required)*: URL of embed page to fetch.
  - `referer` *(optional)*: Referer to send to upstream.
- **Security / SSRF Protection**:
  - Domain Allowlist: `embedindia.st`, `embedindia.com`, `embedsport.xyz`, `embed.st`, `embedme.top`, `embedstream.me`, `embedstream.top`, `streamtape.com`, `sportsurge.net`, `vecloud.net`, `viprow.me`, `vipbox.lc`.
  - Non-allowlisted domains return `403 Forbidden`.
  - Protocols must be `http:` or `https:`.
- **Status Codes**:
  - `200 OK`: Returns embed HTML (`Content-Type: text/html; charset=utf-8`).
  - `400 Bad Request`: Missing or invalid URL parameter.
  - `403 Forbidden`: Blocked SSRF attempt.
  - `502 Bad Gateway`: Upstream fetch failure.

---

#### 2.2.3 Web Watch Player (`/watch`)
- **Route Path**: `GET /watch`
- **Method**: `GET`
- **Modes**:
  1. `mode=extract`:
     - Query Parameters: `?mode=extract&embed=<url>&referer=<url>&title=<title>`.
     - Serves standalone HTML player with client-side HLS extraction running in the user's browser via `/api/proxy-embed` + `hls.js`.
  2. Default Iframe Mode:
     - Query Parameters: `?url=<url>&title=<title>`.
     - Serves full-screen iframe or HTML5 video player with P2P Media Loader (`p2p-media-loader-hlsjs`). Auto-proxies `.m3u8` URLs through `/api/hls/playlist.m3u8`.
- **Status Codes**: `200 OK`, `400 Bad Request`.

---

#### 2.2.4 Proxied Resolver Routes (`/api/hls/*` & `/api/stream`)
- **Routing**: Forwarded via `http-proxy-middleware` to internal resolver process on `127.0.0.1:7003`.
- **Endpoints**:
  - `GET /api/hls/playlist.m3u8?url=...&referer=...&embedOrigin=...`: Proxies and rewrites live HLS playlists and segments. Prefetches next TS segment into memory cache.
  - `POST /api/stream`: Body `{ matchId, source, stream }` or `{ url }`. Dynamic source resolution. Max body 1MB. Returns JSON with extracted M3U8 link and relay URL.

---

### 2.3 Application & Media Endpoints

#### 2.3.1 Raw Matches Ingest Cache (`/api/matches`)
- **Route Path**: `GET /api/matches`
- **Method**: `GET`
- **Logic**: Returns current in-memory matches array from `CacheService.getMatches()`.
- **Status Codes**: `200 OK`.

#### 2.3.2 Self-Hosted Image Proxy (`/img`)
- **Route Path**: `GET /img`
- **Method**: `GET`
- **Query Parameters**:
  - `url` *(required for proxy)*: Remote image URL.
  - `text` *(optional fallback)*: Text for SVG placeholder.
  - `color` *(optional fallback)*: Accent color hex.
- **Caching**:
  - `ImageService` in-memory cache: 10 min TTL, max 120 entries, max size 1.5MB per image.
  - Negative cache: 60s for failed/slow images.
  - Falls back to `svgPlaceholder` on dead URLs, timeouts, or non-image responses.
- **Headers**:
  - `Content-Type: image/jpeg | image/png | image/svg+xml`
  - `Cache-Control: public, max-age=600` (on hit) or `public, max-age=60` (on fallback).
- **Status Codes**: `200 OK`.

#### 2.3.3 SVG Placeholder Generator (`/img/placeholder`)
- **Route Path**: `GET /img/placeholder`
- **Method**: `GET`
- **Query Parameters**: `?text=...&color=...`
- **Headers**: `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=300`.
- **Status Codes**: `200 OK`.

#### 2.3.4 Health Check & Cache Stats (`/health`)
- **Route Path**: `GET /health`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "nuvio-live-sports",
    "streamResolveCache": {
      "entries": 42,
      "inFlight": 0,
      "hits": 1820,
      "misses": 85,
      "negativeHits": 12,
      "evictions": 0,
      "learnedTtls": {
        "streamfree": 240000,
        "timstreams": 120000,
        "watchfooty": 480000
      }
    }
  }
  ```
- **Status Codes**: `200 OK`.

---

## 3. Upstream Provider Dependency Matrix

| Provider Name | Ingest Endpoint / Source | Resolution Mechanism | Upstream Protocol | Upstream Domains | Scrape / API / WASM |
|---|---|---|---|---|---|
| **StreamFree** | `https://streamfree.top/streams` | `/embed/...` + `/api/stream-status/...` + `/get-stream-key/...` | HTTPS REST + HTML scraping | `streamfree.top`, `cdn1.streamfree.top` | Scrapes tokens, queries status JSON |
| **Streamed.pk** | `https://streamed.pk/api/matches/all` | `https://streamed.pk/api/stream/:source/:id` | HTTPS JSON API | `streamed.pk` | API + WASM child process (`run_wasm_native.js`) |
| **TimStreams** | `https://timstreams.st/api/live-upcoming` | Scrapes embed, XOR array decoder | HTTPS JSON + HTML | `timstreams.st`, `logic.icelanders.st` | JSON API + Native JS XOR deobfuscation |
| **WatchFooty** | `https://api.watchfooty.st/api/v1/matches/all` | `https://api.watchfooty.st/api/v1/match/:id` + SportsEmbed | HTTPS JSON + HTML | `api.watchfooty.st`, `sportsembed.su`, `watchfooty.st` | REST API + SportsEmbed WASM/API |
| **CDNLiveTV** | `https://api.cdnlivetv.tv/api/v1/events/sports/` | Player HTML scraping + `atob` concat | HTTPS JSON + HTML | `api.cdnlivetv.tv`, `cdnlivetv.tv` | JSON API + HTML atob string assembly |
| **StreamSports99** | `https://api.cdnlivetv.is/api/v1/events/sports/` | Player HTML scraping + `atob` concat | HTTPS JSON + HTML | `api.cdnlivetv.is`, `streamsports99.fun` | VIP REST API + atob concatenation |
| **Streamic** | `https://streamic.st/api/J.php` | Direct embed links (`_embeds`) | HTTPS JSON | `streamic.st`, `streami.fit` | REST JSON API (with retry on 503) |
| **Strims24** | `https://strims24.pl` / `https://1.newsoccers.one/2/x/feed` | Flashscore-style delimited feed parser | HTTPS Delimited Text | `strims24.pl`, `1.newsoccers.one`, `flashscore.com` | Custom text protocol parsing |
| **IptvOrg** | `https://iptv-org.github.io/api/channels.json` & `streams.json` | Direct M3U8 from data | HTTPS Static JSON | `iptv-org.github.io`, `logo.clearbit.com` | Static JSON catalogues |
| **SportyHunter** | `https://sportyhunter.xyz` | Next.js `__NEXT_DATA__` JSON extraction | HTTPS HTML Scrape | `sportyhunter.xyz` | Next.js Page Props scraping |
| **BeinArabic** | Static Channel List | Direct HLS / Yalla Shoot fallback | Static config | `v2.yalla-shoot.tv`, `live.daddylive.stream` | Static metadata + stream proxy |
| **Embed.st** | Direct embed resolver | Native WASM decryption (`run_wasm_native.js`) | Local child_process | `embed.st`, `sportsembed.su` | WASM binary execution via Node |
| **EmbedIndia** | Direct embed resolver | Native WASM decryption (`run_gasm_india.js`) | Local child_process | `embedindia.st`, `embedsport.xyz` | WASM binary execution via Node |

---

## 4. Cache & Load Behavior Analysis

### 4.1 Caching Tiers

```
  User Request (Stremio / Web Player / Test Runner)
                     │
                     ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                    Express Server (Port 7000)               │
  ├─────────────────────────────────────────────────────────────┤
  │ 1. Catalog Tier: CacheService                               │
  │    - TTL: 5 min default, SWR re-sync threshold: 10 min      │
  │    - Storage: In-memory array of MatchEntity                │
  │                                                             │
  │ 2. Stream Resolution Tier: StreamResolveCache               │
  │    - Adaptive TTL: 60s (floor) to 10m (cap)                 │
  │    - Negative TTL: 30s (for dead/empty sources)             │
  │    - Single-flight locking: inFlight Map                    │
  │    - Max entries: 200 (LRU eviction)                        │
  │                                                             │
  │ 3. Manifest Proxy Tier: manifestCache                       │
  │    - Positive TTL: 3000ms (3s)                              │
  │    - Negative TTL: 15000ms (15s)                            │
  │    - Single-flight locking: manifestInFlight Map            │
  │    - Max entries: 100 (LRU eviction)                        │
  │                                                             │
  │ 4. Artwork Tier: ImageService Cache                         │
  │    - TTL: 10 min, Negative TTL: 60s                         │
  │    - Max entries: 120 (LRU eviction), Max size: 1.5MB/image │
  └─────────────────────────────────────────────────────────────┘
```

### 4.2 Latency Expectation Matrix

| Endpoint | Cache State | Target Latency | P95 Target | Notes |
|---|---|---|---|---|
| `/health` | N/A (Instant) | < 5ms | < 15ms | Checks memory stats |
| `/manifest.json` | N/A (In-memory) | < 10ms | < 25ms | Filtered manifest cloning |
| `/catalog/tv/nuvio_sports_live.json` | Warm (`CacheService`) | < 20ms | < 50ms | In-memory sort & map |
| `/catalog/tv/nuvio_sports_live.json` | Stale (SWR Trigger) | < 25ms (served stale) | < 60ms | Sync runs in background |
| `/meta/tv/nuvio_sport_*.json` | Warm | < 15ms | < 40ms | Single match lookup + async prewarm |
| `/stream/tv/nuvio_sport_*.json` | **Cache HIT** (`StreamResolveCache`) | **< 15ms** | **< 40ms** | Prewarmed or recently resolved |
| `/stream/tv/nuvio_sport_*.json` | **Cache MISS** (Cold Resolve) | **800ms – 3500ms** | **< 4500ms** | External scraping + WASM + ping verification |
| `/api/manifest?url=...` | **Cache HIT** (`manifestCache`) | **< 10ms** | **< 25ms** | Rewritten M3U8 served from memory |
| `/api/manifest?url=...` | **Cache MISS** (Cold Fetch) | **200ms – 1200ms** | **< 2000ms** | Upstream Impit/undici fetch + rewrite |
| `/img?url=...` | **Cache HIT** (`ImageService`) | **< 10ms** | **< 20ms** | Buffered image served |
| `/img?url=...` | **Cache MISS** | **150ms – 1500ms** | **< 2000ms** | Undici fetch + size verification |

---

## 5. High-Load Risk Areas & Failure Scenarios

### 5.1 Concurrency Thundering Herd on Stream Resolution
- **Risk**: When a high-profile sporting event starts (e.g., Champions League final), thousands of clients query `/stream/tv/nuvio_sport_<id>.json` in the same second.
- **Protection**: `StreamResolveCache.getOrCreate` uses `inFlight` Map so that only 1 single mint operation executes while all other concurrent requests await that Promise.
- **Verification Need**: Load test must verify that under 50–100 concurrent requests for the exact same match ID, exactly 1 upstream fetch occurs (1 miss, 99 hits / coalesces).

### 5.2 Subprocess Saturation (WASM Decryptors)
- **Risk**: `EmbedStProvider` and `EmbedIndiaProvider` spawn Node.js child processes (`execFile('node', ...)`). Spawning 50 concurrent subprocesses will exhaust Node memory and CPU on 512MB RAM environments (e.g. Render).
- **Protection**: `StreamedPkProvider` chunks child resolutions in batches of 3 (`CHUNK_SIZE = 3`).
- **Verification Need**: Ensure test suite exercises multiple distinct match streams concurrently to verify system does not crash or exhaust file descriptors.

### 5.3 Upstream Network Failures & Dead Streams
- **Risk**: Scraped third-party streams frequently die (404, 403 IP lock, 502).
- **Protection**:
  - `verifyStreams()` drops dead streams and notes failure to halve TTL.
  - Negative caching (30s on `StreamResolveCache`, 15s on `manifestCache`, 60s on `ImageService`).
  - Circuit breakers (`CircuitBreakerService` / Opossum) trip after 3 consecutive errors with 5-minute cooldown.
- **Verification Need**: Test error rate under upstream failures and verify graceful degradation to web player fallbacks (`/watch`).

### 5.4 Live Manifest Reload Frequency
- **Risk**: Active video players reload `/api/manifest` every 2–6 seconds. If cache is broken or has 0 TTL, upstream servers block the IP or rate-limit.
- **Protection**: 3-second cache window with LRU eviction and connection pooling (`Impit`).

---

## 6. Load Test Script Recommendation

For the implementation of the performance & load testing suite, the following scenarios must be covered:
1. **Health & Baseline Check**:
   - Single-connection latency on `/health`, `/manifest.json`.
2. **Catalog Concurrency Test**:
   - 50–200 concurrent requests across `/catalog/tv/*.json` with different categories and search parameters. Measure P95, P99, throughput.
3. **Stream Resolution Cache Miss vs Hit Benchmark**:
   - Cold Request (Cache Miss): Measure cold resolution latency (first hit).
   - Hot Requests (Cache Hit): Measure 100+ concurrent requests on the same match ID to verify `hits`, `misses`, P95 latency < 30ms, and zero subprocess thrashing.
4. **Manifest Proxy Load Test**:
   - Concurrent polling of `/api/manifest?url=...` simulating 50 viewers polling every 2 seconds. Verify `X-Manifest-Cache: HIT` ratio > 80%.
5. **Image Proxy & Placeholder Load Test**:
   - Concurrent image requests testing cache hit ratio and fallback SVG generation.
6. **Metric Reporting**:
   - Metrics to output: Total Requests, Success Rate (%), Error Rate (%), Cache Hit Ratio (%), Cache Miss Ratio (%), P50 Latency (ms), P95 Latency (ms), P99 Latency (ms), Throughput (req/sec).
