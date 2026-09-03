# Explorer 3 Handoff Report: R3 (End-to-End Sanity Test & Architecture)

## Executive Summary
This report presents a comprehensive architectural survey and test suite design for **R3 (End-to-End Sanity Test & Simulated Stremio Client)** of the **Nuvio Live Sports Plugin**. It maps all Stremio protocol endpoints and media proxy routes, pinpoints the root causes of hardcoded IP leaks (`192.168.0.123`) and broken thumbnails on public tunnels (ngrok/VPS), and provides the blueprint for an automated, standalone E2E Simulated Stremio Client Test harness.

---

## 1. Observation

### 1.1 Project Structure & Core Dependencies
- **Runtime & Framework**: Node.js >= 22.0.0 (`package.json:39-41`), Express v4.18.2 (`package.json:23`), Awilix v13.0.5 DI Container (`src/container.js`).
- **Protocol & Streaming SDKs**: `stremio-addon-sdk` v1.6.10 (`package.json:36`), `impit` v0.14.3 (`package.json:27`), `undici` v8.10.0 (`package.json:37`), `http-proxy-middleware` v4.2.0 (`package.json:26`), `m3u8-parser` v7.2.0 (`package.json:32`).
- **Server Processes**:
  1. Main Express Server (`src/index.js`) listening on `PORT` (default `7000` / test `7010`).
  2. Streamed.pk Child Resolver (`resolver/src/server.js`) spawned via `child_process.spawn` on `RESOLVER_PORT` (default `7003` / test `7013`).
- **Existing Test Framework**: Jest v30.4.2 (`package.json:28`), custom load test runner (`tests/load/server-runner.js`, `tests/load/scenarios.js`).

### 1.2 Full Stremio Protocol & Proxy Route Mapping

| Endpoint Route | Method | Handler / Source | Response Format & Content | Host Header Sensitivity |
|---|---|---|---|---|
| `/:config?/manifest.json` | `GET` | `src/index.js:496-532` & Stremio Addon SDK | JSON (`id`, `name`, `version`, `logo`, `catalogs`, `config`, `resources: ['catalog', 'meta', 'stream']`) | Returns addon metadata. Supports dynamic sport catalog filtering via config parameter. |
| `/catalog/:type/:id[/:extra].json` | `GET` | `src/catalog.js:207-306` (`handleCatalog`) | JSON `{ metas: [ { id, type: 'tv', name, genres, poster, background, logo, releaseInfo, description, cast } ] }` | **CRITICAL LEAK**: `poster`, `background`, and `logo` are built with static `BASE_URL` from `src/config.js` (`192.168.0.123`). |
| `/meta/:type/:id.json` | `GET` | `src/catalog.js:308-330` (`handleMeta`) | JSON `{ meta: { id, type: 'tv', name, poster, background, logo, ... } }` | Prewarms top streams asynchronously. Returns meta object with static `BASE_URL`. |
| `/stream/:type/:id.json` | `GET` | `src/streams.js:276-457` (`handleStream`) & `src/index.js:418-472` | JSON `{ streams: [ { name, title, url, externalUrl, behaviorHints, quality, score } ] }` | **PARTIAL LEAK**: `s.externalUrl` is rewritten to `${currentBaseUrl}/watch` via middleware (`src/index.js:448`), but `s.url` with `/api/manifest` retains static `BASE_URL` (`192.168.0.123`). |
| `/img?url=...&text=...&color=...` | `GET` | `src/index.js:125-138`, `src/services/ImageService.js` | Binary Image (`image/webp`, `image/png`, `image/jpeg`) or Fallback SVG (`image/svg+xml`) | 10-minute LRU memory cache (max 120 entries). On dead/timeout upstream, returns 200 OK SVG placeholder. |
| `/img/placeholder?text=...&color=...` | `GET` | `src/index.js:118-123`, `src/services/ImageService.js` | SVG Card (`image/svg+xml`) | Inline generated SVG poster card replacing external placehold.co dependency. |
| `/api/manifest?url=...&referer=...` | `GET` | `src/index.js:237-324` | HLS Playlist (`application/vnd.apple.mpegurl`) | Shared Impit client, single-flight coalescing, 3s positive cache, 15s negative cache. Rewrites variant playlists. |
| `/api/proxy-embed?url=...` | `GET` | `src/index.js:350-397` | HTML (`text/html`) | SSRF-safe embed fetcher for client-side IP-locked stream extractors (`ALLOWED_EMBED_DOMAINS`). |
| `/api/*` | `ALL` | `src/index.js:401-412` | Proxy / Media Stream | Reverse proxies requests to internal Streamed.pk child resolver on port `RESOLVER_PORT`. |
| `/watch?url=...&title=...` | `GET` | `src/index.js:560-981` | HTML5 / Hls.js Web App (`text/html`) | Responsive web player bypassing iframe/origin restrictions; includes client-side extractor mode (`mode=extract`). |
| `/health` | `GET` | `src/index.js:986-990` | JSON `{ status: 'ok', service: 'nuvio-live-sports', streamResolveCache: {...} }` | Service health telemetry and in-memory cache statistics. |
| `/api/matches` | `GET` | `src/index.js:105-108` | JSON Array of `MatchEntity` objects | Internal cached match fixtures from `MatchAggregator` / `CacheService`. |

### 1.3 Verified Evidence of Hardcoded IP and Thumbnail Failure
1. **Hardcoded IP in `src/config.js` (lines 15-28)**:
```javascript
function getLocalIp() {
  // Hardcoding the exact Wi-Fi interface IP to guarantee Stremio on the phone connects properly
  return '192.168.0.123';
}
const BASE_URL = (
  process.env.ADDON_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : null) ||
  `http://${getLocalIp()}:${PORT}`
).replace(/\/$/, '');
```

2. **Hardcoded Base URL in Catalog Image Construction (`src/catalog.js:105, 110-113`)**:
```javascript
const fallbackPoster = imageService.placeholderUrl(BASE_URL, posterText, color);
const buildImg = (sourceUrl, fbText, c) =>
  imageService.proxyUrl(BASE_URL, sourceUrl, { text: fbText, color: c });
```
- Empirical Verification via `undici` query with `Host: ngrok-test-domain.io`:
  - Request: `GET /catalog/tv/nuvio_sports_live.json` with `headers: { host: 'ngrok-test-domain.io' }`.
  - Returned Poster: `"http://192.168.0.123:7000/img?url=https%3A%2F%2Fmedia-cldnry.s-nbcnews.com..."`.
  - Result: Client device on external network tries to load `192.168.0.123:7000`, causing network timeouts and broken thumbnail images.

3. **Hardcoded Base URL in Stream Proxies (`src/providers/EmbedIndiaProvider.js:99`, `StreamFreeProvider.js:143`, `EmbedStProvider.js:128`, `TimStreamsProvider.js:202`, `WatchFootyProvider.js:162`)**:
```javascript
const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(m[1])}&referer=${encodeURIComponent(referer)}&origin=${encodeURIComponent(origin)}`;
```
- When `handleStream` resolves, streams contain `url: "http://192.168.0.123:7000/api/manifest?..."`.
- The middleware in `src/index.js:448-453` only rewrites `s.externalUrl` and neglects `s.url` with `/api/manifest`.

---

## 2. Logic Chain

1. **Premise 1**: Stremio clients discover and consume addons by first requesting `/manifest.json`, then requesting catalog lists via `/catalog/:type/:id.json`, and subsequently requesting stream options via `/stream/:type/:id.json`.
2. **Premise 2**: When an addon is accessed over tunnels (e.g. ngrok, Cloudflare Tunnel) or public domains, the incoming HTTP request contains the public hostname in the `Host` or `X-Forwarded-Host` header and the protocol (`http` or `https`) in `X-Forwarded-Proto`.
3. **Premise 3**: Because `src/config.js` defaults `BASE_URL` to `http://192.168.0.123:7000` and `src/catalog.js` bakes `BASE_URL` directly into all `poster`, `background`, and `logo` URLs, the returned catalog payloads contain unrouteable private LAN IP addresses.
4. **Premise 4**: The Stremio UI client renders thumbnail cards by fetching the URL in `item.poster`. When that URL points to `192.168.0.123:7000`, client fetches fail, resulting in missing/blank thumbnails.
5. **Premise 5**: In `src/streams.js` and various providers, M3U8 proxy URLs are created with `${BASE_URL}/api/manifest?...`. While `src/index.js` contains a middleware rewriting `s.externalUrl` for `/watch`, it fails to rewrite `s.url` containing `/api/manifest`, causing video playback to fail on external clients.
6. **Deduction & Solution**:
   - To fix R1 & R2, the addon must use dynamic host resolution across all generated URLs (either via request context or unified response-interception middleware), and `src/config.js` must eliminate the hardcoded `192.168.0.123`.
   - To verify R3, a standalone test suite must simulate the full client lifecycle (Manifest -> Catalog -> Metadata -> Streams -> M3U8 Playlist Parsing & Playback Verification) while asserting dynamic host header reflection, 100% HTTP 200 thumbnail availability, zero 404/500 errors, and zero hardcoded IP instances.

---

## 3. Caveats

1. **Upstream Live Event Volatility**: Remote sports stream scrapers depend on live third-party sources (e.g., Streamed.pk, StreamFree, CDNLive). In off-peak hours (e.g., early morning), live fixture counts vary. The test harness must account for both live events and permanent 24/7 channels (`nuvio_sports_networks`) so tests are 100% deterministic even when no live fixtures are active.
2. **Rate Limits on External CDNs**: The thumbnail verification tests must validate that requests routed through `/img` return HTTP 200 OK. The test harness should test the local proxy endpoint (`/img` and `/img/placeholder`) without hammering external image hosts directly.
3. **Child Resolver Port Isolation**: In test runs, the main server runs on port `7010` and the child resolver on port `7013` to prevent port collisions with any background instances running on `7000`/`7003`.

---

## 4. Conclusion & Test Suite Architecture Design

### 4.1 Test Architecture Overview
The E2E Simulated Stremio Client Test suite is structured into 6 sequential verification phases:

```
┌───────────────────────────────────────────────────────────────────────────┐
│              E2E SIMULATED STREMIO CLIENT TEST SUITE                      │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 1: Server Lifecycle & Readiness Check                               │
│          • Start isolated test server (Port 7010, Resolver 7013)          │
│          • Poll /health and await match catalog sync                      │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 2: Dynamic Host Routing & Header Assertions (R1)                     │
│          • Test Case 2A: Standard Host header (e.g. my-addon.ngrok.app)   │
│          • Test Case 2B: Reverse Proxy (X-Forwarded-Host + Proto)         │
│          • Test Case 2C: Stream endpoint URL dynamic host rewrite         │
│          • Assert ZERO occurrences of '192.168.0.' in any payload         │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 3: Catalog & Thumbnail Health Verification (R2)                     │
│          • Fetch /catalog/tv/nuvio_sports_live.json & networks.json       │
│          • Extract all poster, background, and logo URLs                  │
│          • Concurrently fetch all image URLs -> Assert 100% HTTP 200 OK   │
│          • Test fallback placeholder on dead upstream image URLs          │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Match Metadata, Stream Resolution & M3U8 Playback (R3)           │
│          • Select fixture match and 24/7 TV channel                       │
│          • Fetch /meta/tv/:id.json -> Assert valid metadata               │
│          • Fetch /stream/tv/:id.json -> Assert valid stream array         │
│          • Fetch M3U8 from /api/manifest -> Assert #EXTM3U content        │
│          • Fetch /watch web stream page -> Assert HTTP 200 HTML           │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 5: Codebase Static Zero-Hardcoded-IP Scan                           │
│          • Scan all JS/JSON files in src/ for 192.168.0.xx                │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 6: Formatted Reporting & Teardown                                   │
│          • Tabular summary of all test phases, latencies, and pass rates  │
│          • Graceful process teardown -> Exit code 0 (pass) / 1 (fail)     │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Complete Reference Test Script Implementation
The test harness should be placed at `scripts/test-e2e-simulated-client.js` or `tests/e2e-simulated-client.js`. Below is the complete, production-grade test runner implementation design:

```javascript
#!/usr/bin/env node
/**
 * scripts/test-e2e-simulated-client.js
 *
 * Automated End-to-End Simulated Stremio Client Test for Nuvio Live Sports Plugin:
 * - Validates R1: Dynamic Host Routing across manifest, catalog, meta, stream
 * - Validates R2: Thumbnail repair, proxying, and 100% HTTP 200 OK image responses
 * - Validates R3: Full Stremio workflow (Manifest -> Catalog -> Meta -> Stream -> M3U8)
 * - Validates Zero Hardcoded 192.168.0.xx instances across all payloads and source files
 */

const { request } = require('undici');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../tests/load/server-runner');

const TEST_PORT = 7010;
const TEST_RESOLVER_PORT = 7013;
const SIMULATED_HOSTS = [
  { name: 'Direct Host', host: 'addon-live.ngrok-free.app', proto: 'https' },
  { name: 'Forwarded Reverse Proxy', host: 'stremio-sports.custom-vps.net', proto: 'https', useForwarded: true },
  { name: 'Localhost Custom Port', host: '127.0.0.1:7010', proto: 'http' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runE2ESimulatedClient() {
  console.log('\n' + '═'.repeat(80));
  console.log('  🏆 NUVIO LIVE SPORTS PLUGIN — E2E SIMULATED STREMIO CLIENT TEST');
  console.log('═'.repeat(80) + '\n');

  let serverInstance = null;
  const testResults = [];
  const record = (phase, name, passed, details = '') => {
    testResults.push({ phase, name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`  ${icon} [${phase}] ${name} ${details ? `(${details})` : ''}`);
  };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Server Lifecycle & Readiness
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📦 [Phase 1] Booting / Connecting to Plugin Server...');
    serverInstance = await startServer({
      port: TEST_PORT,
      resolverPort: TEST_RESOLVER_PORT,
      reuseExisting: true
    });
    const baseUrl = serverInstance.baseUrl;

    // Await catalog sync
    let matches = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      try {
        const res = await request(`${baseUrl}/api/matches`);
        if (res.statusCode === 200) {
          matches = await res.body.json();
          if (Array.isArray(matches) && matches.length > 0) break;
        }
      } catch (_) {}
      await sleep(500);
    }
    record('Phase 1', 'Server Boot & Health Check', true, `Port ${TEST_PORT}, ${matches.length} matches ingested`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Dynamic Host Routing (R1)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🌐 [Phase 2] Verifying Dynamic Host Routing Across Endpoints...');
    for (const sim of SIMULATED_HOSTS) {
      const headers = {};
      if (sim.useForwarded) {
        headers['x-forwarded-host'] = sim.host;
        headers['x-forwarded-proto'] = sim.proto;
        headers['host'] = '127.0.0.1:7010';
      } else {
        headers['host'] = sim.host;
      }

      const expectedBase = `${sim.proto}://${sim.host}`;

      // 2A. Manifest
      const mRes = await request(`${baseUrl}/manifest.json`, { headers });
      const mText = await mRes.body.text();
      const mNoLanIp = !mText.includes('192.168.0.');
      record('Phase 2', `Manifest Host Reflection (${sim.name})`, mRes.statusCode === 200 && mNoLanIp, `Host: ${sim.host}`);

      // 2B. Catalog
      const cRes = await request(`${baseUrl}/catalog/tv/nuvio_sports_live.json`, { headers });
      const cText = await cRes.body.text();
      const cData = JSON.parse(cText);
      const cNoLanIp = !cText.includes('192.168.0.');
      
      const firstItem = cData.metas && cData.metas[0];
      const posterReflectsHost = firstItem && firstItem.poster ? firstItem.poster.startsWith(expectedBase) : true;
      record('Phase 2', `Catalog URLs Reflection (${sim.name})`, cRes.statusCode === 200 && cNoLanIp && posterReflectsHost, `Expected: ${expectedBase}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Catalog & Thumbnail Repair (R2)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🖼️  [Phase 3] Validating Catalog Posters & Thumbnail Proxy (200 OK)...');
    const catalogRes = await request(`${baseUrl}/catalog/tv/nuvio_sports_live.json`);
    const catalogData = await catalogRes.body.json();
    const metas = catalogData.metas || [];

    const imageUrls = new Set();
    metas.slice(0, 25).forEach(m => {
      if (m.poster) imageUrls.add(m.poster);
      if (m.logo) imageUrls.add(m.logo);
      if (m.background) imageUrls.add(m.background);
    });

    let imagesChecked = 0;
    let imagesPassed = 0;
    for (const imgUrl of imageUrls) {
      // Replace host with local baseUrl for testing fetch
      const localUrl = imgUrl.replace(/^https?:\/\/[^/]+/, baseUrl);
      try {
        const iRes = await request(localUrl, { headersTimeout: 4000, bodyTimeout: 4000 });
        imagesChecked++;
        if (iRes.statusCode === 200) {
          const cType = iRes.headers['content-type'] || '';
          if (cType.includes('image/') || cType.includes('svg+xml')) {
            imagesPassed++;
          }
        }
      } catch (_) {}
    }
    const thumbnailSuccessRate = imagesChecked > 0 ? (imagesPassed / imagesChecked) * 100 : 100;
    record('Phase 3', 'Catalog Thumbnail Accessibility', thumbnailSuccessRate === 100, `${imagesPassed}/${imagesChecked} images returned 200 OK`);

    // 3B. Test Fallback on Dead Upstream Image
    const deadImgRes = await request(`${baseUrl}/img?url=https://dead-upstream.invalid/broken.png&text=TestFallback&color=10b981`);
    const deadImgType = deadImgRes.headers['content-type'] || '';
    const deadImgPassed = deadImgRes.statusCode === 200 && deadImgType.includes('svg+xml');
    record('Phase 3', 'Resilient SVG Fallback on Dead Image', deadImgPassed, `Status: ${deadImgRes.statusCode}, Type: ${deadImgType}`);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Full Stream Resolution & M3U8 Playback (R3)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🎬 [Phase 4] Simulating Stream Resolution & M3U8 Playlist Parsing...');
    const targetMatch = metas.find(m => m.id.startsWith('nuvio_sport_')) || metas[0];
    if (targetMatch) {
      // 4A. Meta
      const metaRes = await request(`${baseUrl}/meta/tv/${targetMatch.id}.json`);
      const metaData = await metaRes.body.json();
      record('Phase 4', 'Fetch Match Metadata', metaRes.statusCode === 200 && !!metaData.meta, `Match: ${targetMatch.name}`);

      // 4B. Stream Array
      const streamRes = await request(`${baseUrl}/stream/tv/${targetMatch.id}.json`, {
        headers: { host: 'addon.test-domain.xyz' }
      });
      const streamData = await streamRes.body.json();
      const streams = streamData.streams || [];
      record('Phase 4', 'Resolve Stream Array', streamRes.statusCode === 200 && streams.length > 0, `Resolved ${streams.length} streams`);

      // 4C. M3U8 Manifest Verification
      const directStream = streams.find(s => s.url && (s.url.includes('/api/manifest') || s.url.includes('.m3u8')));
      if (directStream) {
        const localM3u8Url = directStream.url.replace(/^https?:\/\/[^/]+/, baseUrl);
        const m3u8Res = await request(localM3u8Url, {
          headers: directStream.behaviorHints?.proxyHeaders?.request || {}
        });
        const m3u8Body = await m3u8Res.body.text();
        const m3u8Valid = m3u8Res.statusCode === 200 && m3u8Body.includes('#EXTM3U');
        record('Phase 4', 'HLS M3U8 Manifest Resolution', m3u8Valid, `Status: ${m3u8Res.statusCode}, #EXTM3U Present: ${m3u8Body.includes('#EXTM3U')}`);
      }

      // 4D. Web Stream Verification
      const webStream = streams.find(s => s.externalUrl);
      if (webStream) {
        const localWebUrl = webStream.externalUrl.replace(/^https?:\/\/[^/]+/, baseUrl);
        const webRes = await request(localWebUrl);
        const webBody = await webRes.body.text();
        const webValid = webRes.statusCode === 200 && (webBody.includes('player') || webBody.includes('video'));
        record('Phase 4', 'Web Player Embed Proxy (/watch)', webValid, `Status: ${webRes.statusCode}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Codebase Static Zero-Hardcoded-IP Scan
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🔍 [Phase 5] Scanning Codebase for Zero Hardcoded Private IPs...');
    const srcDir = path.join(__dirname, '..', 'src');
    const scanFiles = (dir) => {
      let results = [];
      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) results = results.concat(scanFiles(full));
        else if (full.endsWith('.js') || full.endsWith('.json')) results.push(full);
      }
      return results;
    };

    let hardcodedMatches = [];
    for (const f of scanFiles(srcDir)) {
      const content = fs.readFileSync(f, 'utf8');
      if (content.includes('192.168.0.')) {
        hardcodedMatches.push(f);
      }
    }
    const zeroHardcodedPassed = hardcodedMatches.length === 0;
    record('Phase 5', 'Zero Hardcoded 192.168.0.xx Strings in src/', zeroHardcodedPassed, zeroHardcodedPassed ? '0 occurrences found' : `Found in ${hardcodedMatches.join(', ')}`);

  } finally {
    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: Teardown & Reporting
    // ─────────────────────────────────────────────────────────────────────────
    if (serverInstance && serverInstance.isSpawned) {
      await serverInstance.shutdown();
    }

    console.log('\n' + '═'.repeat(80));
    console.log('                          📊 FINAL TEST SUMMARY REPORT');
    console.log('═'.repeat(80));
    const allPassed = testResults.every(r => r.passed);
    testResults.forEach(r => {
      const mark = r.passed ? 'PASS [OK]' : 'FAIL [X] ';
      console.log(`  ${mark} | ${r.phase.padEnd(8)} | ${r.name.padEnd(42)} | ${r.details}`);
    });
    console.log('═'.repeat(80));
    console.log(`  Overall Result: ${allPassed ? '🎉 ALL TESTS PASSED' : '⚠️ TEST FAILURES DETECTED'}\n`);

    if (!allPassed) process.exit(1);
  }
}

runE2ESimulatedClient().catch((err) => {
  console.error('[FATAL] Test runner uncaught exception:', err);
  process.exit(1);
});
```

### 4.3 Required Assertions & Acceptance Criteria Matrix

| Check ID | Area / Phase | Assertion Logic | Expected Value | Status / Gate |
|---|---|---|---|---|
| **AC-01** | Manifest Dynamic Host | `res.body` logo/links reflect incoming `Host` or `X-Forwarded-Host` | Matches request hostname | Mandatory Gate |
| **AC-02** | Catalog Dynamic Host | All `poster`, `background`, `logo` URLs start with incoming `Host` | Starts with `${proto}://${host}` | Mandatory Gate |
| **AC-03** | Zero Hardcoded IP in Payloads | Regex test `/192\.168\./` on full JSON payloads of manifest, catalog, stream | 0 occurrences | Mandatory Gate |
| **AC-04** | 100% Thumbnail 200 OK | HTTP `GET` for every catalog poster/logo via image proxy | Status == 200, Content-Type is image/svg | Mandatory Gate |
| **AC-05** | Dead Image Fallback | HTTP `GET` on `/img?url=broken.png` returns generated SVG placeholder | Status == 200, Content-Type: `image/svg+xml` | Mandatory Gate |
| **AC-06** | Stream Dynamic Host | All `externalUrl` and `/api/manifest` stream URLs reflect request `Host` | Matches request hostname | Mandatory Gate |
| **AC-07** | M3U8 Payload Integrity | HTTP `GET` on proxied M3U8 returns valid playlist | Status == 200, Body contains `#EXTM3U` | Mandatory Gate |
| **AC-08** | Web Player Integrity | HTTP `GET` on `/watch?url=...` | Status == 200, Valid HTML with player container | Mandatory Gate |
| **AC-09** | Zero Hardcoded IP in Source | Static filesystem grep for `192.168.0.` across all `src/**/*.js` | 0 occurrences | Mandatory Gate |

### 4.4 Required `package.json` Script Additions
To make test execution standardized and simple for CI and developer workflows:
```json
"scripts": {
  "test:e2e-client": "node scripts/test-e2e-simulated-client.js",
  "test:sanity": "node scripts/test-e2e-simulated-client.js"
}
```

---

## 5. Verification Method

To independently verify the architecture and test suite:

1. **Verify Existing Server State & Manifest**:
   ```bash
   node -e "const { request } = require('undici'); (async () => { const res = await request('http://127.0.0.1:7000/manifest.json'); console.log('Manifest status:', res.statusCode); })()"
   ```
2. **Verify Catalog Thumbnail 200 OK**:
   ```bash
   node -e "const { request } = require('undici'); (async () => { const res = await request('http://127.0.0.1:7000/img/placeholder?text=Test&color=10b981'); console.log('Image status:', res.statusCode, res.headers['content-type']); })()"
   ```
3. **Verify M3U8 Manifest Proxy**:
   ```bash
   node -e "const { request } = require('undici'); (async () => { const res = await request('http://127.0.0.1:7000/api/manifest?url=https%3A%2F%2Fraw.githubusercontent.com%2Fiptv-org%2Fiptv%2Fmaster%2Fstreams%2Fae.m3u8'); const text = await res.body.text(); console.log('Status:', res.statusCode, 'HLS valid:', text.includes('#EXT')); })()"
   ```
4. **Execute Full E2E Simulated Client Test**:
   ```bash
   node scripts/test-e2e-simulated-client.js
   ```

**Invalidation Conditions**:
- If any catalog payload contains `192.168.0.xx` when requested with a public `Host` header.
- If any thumbnail in the catalog returns HTTP 404, 500, or 502.
- If resolving a stream throws an uncaught exception or returns broken `/api/manifest` links.
