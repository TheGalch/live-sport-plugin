# Empirical Challenge Handoff Report — Challenger 2

**Role**: Challenger 2 (Empirical Client Simulation, Load & Boundary Verification)  
**Date**: 2026-09-03T01:59:15Z  
**Verdict**: `APPROVE`

---

## 1. Observation

### 1.1 Stremio Web / Desktop Client Interactions & CORS Headers
Direct empirical HTTP requests were executed against all critical addon endpoints with simulated Stremio client headers (`Origin: https://web.stremio.com`, `Host: client.stremio.test`):

1. **Manifest Endpoint (`/manifest.json`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`
   - Manifest Schema:
     - `id`: `"community.nuvio.live-sports"` (string)
     - `name`: `"🏆 Nuvio Live Sports"` (string)
     - `version`: `"3.0.0"` (semver compliant)
     - `types`: `["tv"]` (array)
     - `resources`: `["catalog", "meta", "stream"]` (complete Stremio v1 resources)
     - `catalogs`: 17 catalogs with `id`, `type`, `name`, `extra`
2. **Configured Manifest Endpoint (`/:config/manifest.json`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`
   - Filter Test (`sports: "football,basketball"`, `teams: ""`): Correctly filtered down to 5 catalogs (`nuvio_sports_live`, `nuvio_sports_networks`, `nuvio_sports_upcoming`, `nuvio_sports_football`, `nuvio_sports_basketball`), properly omitting unconfigured team catalogs.
3. **Catalog Endpoints (`/catalog/tv/nuvio_sports_live.json`, `/catalog/tv/nuvio_sports_networks.json`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`
4. **Metadata Endpoint (`/meta/tv/:id.json`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`
5. **Stream Endpoint (`/stream/tv/:id.json`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`
6. **Image Proxy & Placeholder Endpoints (`/img`, `/img/placeholder`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`
   - `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`
7. **Watch Embed Proxy (`/watch?url=...`)**:
   - Status: `200 OK`, `Access-Control-Allow-Origin: *`, renders full-screen HTML iframe wrapper.

### 1.2 Image Cache & Memory Performance Under Rapid Query Load
An empirical load test was executed generating **1,000 rapid requests** at concurrency 25 across four distinct query categories:
- **Direct SVG Placeholders** (`/img/placeholder`): 250 requests
- **Repeated Cache Hits** (`/img?url=...`): 250 requests
- **Cache Misses & Eviction** (`/img?url=...` with unique upstream image URLs): 250 requests
- **Dead Upstream Fallback** (`/img?url=...` with 404 upstream image URLs): 250 requests

**Observed Metrics**:
- **Total Requests**: 1,000
- **Duration**: 3,296 ms (~303.4 req/s throughput)
- **Latencies**: Average 52.21 ms, Min 6 ms, Max 171 ms
- **Success Rate**: **100% (1,000 / 1,000 returned HTTP 200 OK)**
- **Error Rate**: 0% (0 errors, 0 timeouts)
- **Memory Boundedness**:
  - Initial Heap Used: 12.83 MB (RSS: 64.95 MB)
  - Post-Load Heap Used: 15.74 MB (RSS: 73.50 MB)
  - Heap Delta: **+2.92 MB** across 1,000 queries
  - `ImageService.js` LRU eviction (`CACHE_MAX_ENTRIES = 120`) successfully constrained in-memory cache size with zero unbounded heap expansion.

### 1.3 Stream URL Resolution & Dynamic Host Rewriting
Tested stream generation across 3 diverse public/tunnel domains (`sports-app.vps-public.org`, `localhost:7010`, `addon.ngrok-app.io`):
- **Dynamic Host Prefix**: 36 streams verified across live matches and 24/7 TV channels.
  - `externalUrl` correctly resolved to `https://sports-app.vps-public.org/watch?url=...`
  - `url` with `/api/manifest` correctly resolved to `https://sports-app.vps-public.org/api/manifest?...`
- **M3U8 Resolution**: Validated HLS playlist resolution (`#EXTM3U: true`).
- **Static IP Scan**: Zero occurrences of `192.168.0.` found in `src/` or generated JSON payloads.

### 1.4 Test Suite Execution Results
- `scripts/test-challenger-2-empirical.js`: **ALL 3 SUITES PASSED (14/14 checks)**
- `npm run test:e2e-client` (`scripts/test-e2e-simulated-client.js`): **ALL 6 PHASES PASSED (17/17 checks)**

---

## 2. Logic Chain

1. **Stremio Web CORS & Spec Conformance**:
   - Stremio Web runs inside browser sandboxes (`https://web.stremio.com`) requiring strict wildcard CORS headers (`Access-Control-Allow-Origin: *`) across all addon routes to avoid `networkError_manifestLoadError` or blocked artwork.
   - Verification across `/manifest.json`, `/:config/manifest.json`, `/catalog/*`, `/meta/*`, `/stream/*`, `/img`, `/img/placeholder`, and `/watch` confirmed universal 200 OK and CORS header delivery.
2. **LRU Cache & Memory Bounds**:
   - Under rapid load (1,000 queries, 303.4 req/s), `ImageService.js` correctly enforces `CACHE_MAX_ENTRIES = 120` via `evictIfNeeded()`.
   - The memory delta remained minimal (+2.92 MB), proving that neither cached buffers nor negative cache entries leak heap memory under high request velocity.
3. **Dynamic Host Resolution & Resilient Stream Routing**:
   - The universal response rewriter in `src/index.js` intercepts all addon JSON buffers and updates `/watch`, `/img`, and `/api/manifest` to match the incoming client's `Host` and `X-Forwarded-*` headers.
   - External clients connecting via custom domains, VPS, or ngrok receive valid, reachable URLs without leaking local IP addresses.

---

## 3. Caveats

1. **Third-Party Upstream Scrapers**:
   - Live fixture scraping depends on external provider availability (e.g. Streamed.pk, StreamFree). When no live fixtures are active, the addon defaults seamlessly to 24/7 sports networks.
2. **Internal Resolver Subprocess**:
   - The internal stream resolver on `RESOLVER_PORT` (default 7003 / test 7013) is bound strictly to `127.0.0.1` for local IPC proxying and is not exposed to public clients.

---

## 4. Conclusion

All requirements for Milestone 1 (Dynamic Host Routing), Milestone 2 (Thumbnail Repair & Proxy), and Milestone 3 (Simulated Client E2E Testing) have been empirically tested and verified under concurrent load.

- **Verdict**: `APPROVE`

---

## 5. Verification Method

To independently reproduce and verify all empirical findings:

1. **Run Challenger 2 Empirical Stress Test**:
   ```bash
   node scripts/test-challenger-2-empirical.js
   ```
   *Expected Result*: All 3 suites PASS (Stremio Client CORS & Manifest Compliance, Image Cache 1000-req load test with LRU memory bounds, Dynamic Host Stream Resolution).

2. **Run E2E Simulated Stremio Client Test Suite**:
   ```bash
   npm run test:e2e-client
   ```
   *Expected Result*: All 6 phases PASS (Server Boot, Dynamic Host Reflection, Thumbnail 200 OK & CORS, Stream Resolution & M3U8, Zero Hardcoded IP Scan).

3. **Verify Zero Hardcoded Local IPs in Codebase**:
   ```pwsh
   Get-ChildItem -Path src, .env -Recurse -File | Select-String "192\.168\."
   ```
   *Expected Result*: 0 matches.
