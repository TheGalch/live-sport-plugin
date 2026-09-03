# Survey Report & Handoff: R1 — Dynamic Host Routing

## Summary
Comprehensive investigation of hardcoded hostnames, IP addresses, ports, and URL construction mechanisms across the entire Nuvio Live Sports Plugin codebase (`src/`, `public/`, `resolver/`, configuration files, and scripts). The investigation details the root causes of host hardcoding (`192.168.0.123:7000`), traces URL generation across all addon endpoints (`/manifest.json`, `/catalog/*`, `/meta/*`, `/stream/*`), and provides an exact, actionable refactoring specification for request-header-driven dynamic host resolution (`req.get('host')`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `req.protocol`).

---

## 1. Observation

Direct code observations from inspecting the codebase:

### 1.1 Hardcoded IP Addresses & Static Base URL Configuration
* **File**: `c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\src\config.js`
  * **Lines 15–18**:
    ```javascript
    function getLocalIp() {
      // Hardcoding the exact Wi-Fi interface IP to guarantee Stremio on the phone connects properly
      return '192.168.0.123';
    }
    ```
  * **Lines 20–27**:
    ```javascript
    const PORT = parseInt(process.env.PORT, 10) || 7000;

    const BASE_URL = (
      process.env.ADDON_URL ||                                      // Manual override for other hosts
      process.env.RENDER_EXTERNAL_URL ||                            // Render sets this automatically
      (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : null) || // Azure automatically sets this
      `http://${getLocalIp()}:${PORT}`                              // Local dev fallback to LAN IP
    ).replace(/\/$/, '');                                           // Strip trailing slash if any
    ```
  * **Observation**: `getLocalIp()` returns the hardcoded string `'192.168.0.123'`. When `process.env.ADDON_URL` and cloud env variables are unset, `BASE_URL` statically evaluates to `http://192.168.0.123:7000`.

* **File**: `c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.env`
  * **Lines 1–3**:
    ```env
    # Port the addon server will listen on
    PORT=7000
    ADDON_URL=http://192.168.0.123:7000
    ```
  * **Observation**: `.env` explicitly overrides `ADDON_URL` with `http://192.168.0.123:7000`, forcing `BASE_URL` to the hardcoded Wi-Fi IP across all environments that load `.env`.

### 1.2 Catalog & Meta Endpoints: Hardcoded URL Construction
* **File**: `c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\src\catalog.js`
  * **Lines 4, 104–137**:
    ```javascript
    const { BASE_URL } = require('./config');
    // ...
    // Self-hosted fallback poster (replaces the external placehold.co dependency)
    const fallbackPoster = imageService.placeholderUrl(BASE_URL, posterText, color);

    // Self-hosted image proxy: serves the upstream image from cache and falls
    // back to a generated placeholder when the source is dead, so the client
    // never sees a broken image.
    const buildImg = (sourceUrl, fbText, c) =>
      imageService.proxyUrl(BASE_URL, sourceUrl, { text: fbText, color: c });

    let poster = fallbackPoster;
    let logo = match.logo || (match.team1 && match.team1.logo ? match.team1.logo : null);

    const channelLogo = getChannelLogo(match.title);
    if (match.poster) {
      poster = buildImg(match.poster, posterText, color) || fallbackPoster;
    } else if (channelLogo) {
      poster = buildImg(channelLogo, match.title, '161616') || fallbackPoster;
      logo = channelLogo;
    } else if (match.thumbnail_url) {
      const tUrl = match.thumbnail_url.startsWith('http') ? match.thumbnail_url : `https://streamfree.top${match.thumbnail_url}`;
      const isLogo = match.category === 'networks' || tUrl.toLowerCase().includes('logo') || tUrl.toLowerCase().includes('icon');
      
      poster = buildImg(tUrl, posterText, color) || fallbackPoster;
      
      if (isLogo) {
        logo = tUrl;
      }
    }

    if (logo && !logo.startsWith(BASE_URL)) {
      logo = buildImg(logo, match.title || 'TV', '161616') || logo;
    }
    
    let background = match.background ? (buildImg(match.background, posterText, color) || poster) : poster;
    ```
  * **Observation**: `mapMatchToMetaPreview` generates `meta.poster`, `meta.background`, and `meta.logo` by passing the static `BASE_URL` to `imageService.placeholderUrl` and `imageService.proxyUrl`. Consequently, every item in `/catalog/tv/*.json` and `/meta/tv/*.json` contains URLs prefixed with `http://192.168.0.123:7000/img?...`.
  * **Observation**: There is NO response rewriting middleware on `/catalog/` or `/meta/` endpoints.

### 1.3 Stream Resolution & Provider URLs
* **Files**:
  * `src/providers/EmbedIndiaProvider.js` (lines 98–99):
    ```javascript
    const { BASE_URL } = require('../config');
    const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(m[1])}&referer=${encodeURIComponent(referer)}&origin=${encodeURIComponent(origin)}`;
    ```
  * `src/providers/EmbedStProvider.js` (lines 127–128, 148–149):
    ```javascript
    const { BASE_URL } = require('../config');
    const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(referer)}&origin=${encodeURIComponent(new URL(referer).origin)}`;
    // ...
    const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent('https://sportsembed.su/')}&origin=${encodeURIComponent('https://sportsembed.su')}`;
    ```
  * `src/providers/StreamFreeProvider.js` (lines 142–143):
    ```javascript
    const { BASE_URL } = require('../config');
    const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&origin=https://streamfree.top`;
    ```
  * `src/providers/TimStreamsProvider.js` (lines 201–202):
    ```javascript
    const { BASE_URL } = require('../config');
    const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(referer)}&origin=${encodeURIComponent(new URL(referer).origin)}`;
    ```
  * `src/providers/WatchFootyProvider.js` (lines 158, 162):
    ```javascript
    const { BASE_URL } = require('../config');
    const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent('https://sportsembed.su/')}&origin=${encodeURIComponent('https://sportsembed.su')}`;
    ```
  * `src/providers/SportyHunterProvider.js` (line 7):
    `const { BASE_URL } = require('../config');` (unused import).

* **Observation**: All M3U8 proxy URLs are constructed using the static `BASE_URL`. When resolved, these stream entities are saved in `StreamResolveCache`.

### 1.4 Existing Middleware URL Rewrite Limitations
* **File**: `c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\src\index.js`
  * **Lines 418–472**:
    ```javascript
    app.use((req, res, next) => {
      if (!req.path.includes('/stream/')) return next();
      // ...
      let proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      if (proto.includes(',')) proto = proto.split(',')[0].trim();
      
      let host = req.headers['x-forwarded-host'] || req.headers.host;
      if (host && host.includes(',')) host = host.split(',')[0].trim();
      
      const currentBaseUrl = host ? `${proto}://${host}` : BASE_URL;

      body.streams.forEach(s => {
        if (s.externalUrl && s.externalUrl.startsWith('/watch')) {
          s.externalUrl = `${currentBaseUrl}${s.externalUrl}`;
          modified = true;
        }
      });
      // ...
    ```
  * **Observations**:
    1. The middleware is restricted solely to paths matching `/stream/`.
    2. Within `/stream/`, it ONLY modifies `s.externalUrl` when `s.externalUrl.startsWith('/watch')`.
    3. It does NOT rewrite `s.url` (e.g. `http://192.168.0.123:7000/api/manifest?...` or `/api/manifest?...`).
    4. It leaves `/catalog/` and `/meta/` responses completely un-intercepted, leaking `192.168.0.123` image URLs.
    5. `app.set('trust proxy', true)` is missing from `src/index.js`, preventing Express from automatically decoding `X-Forwarded-*` headers.

### 1.5 Client Web UI & Configure Pages
* **File**: `c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\public\configure.html`
  * Lines 434, 453: Uses `window.location.origin + '/manifest.json'` and `window.location.origin + '/' + encoded + '/manifest.json'`.
* **File**: `c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\public\index.html`
  * Lines 107, 150, 210: Uses relative fetches `/manifest.json`, `/catalog/tv/${catalogId}.json`, `/stream/tv/${id}.json`.
  * **Observation**: Client-side frontends in `public/` already use dynamic relative/origin paths in the browser.

---

## 2. Logic Chain

1. **Failure Mode on Public Domains & Alternate Hosts**:
   * When an external client accesses the addon through an ngrok tunnel (e.g. `https://sports.ngrok-free.app`), reverse proxy (e.g. `https://nuvio.mysite.com`), or `localhost:7000`:
   * The client requests `GET /catalog/tv/nuvio_sports_live.json`.
   * `handleCatalog` renders the catalog and embeds `BASE_URL` (`http://192.168.0.123:7000`) into every poster, background, and logo URL.
   * The client receives `{ metas: [ { poster: "http://192.168.0.123:7000/img?url=..." } ] }`.
   * The client's browser/app attempts to fetch images from `192.168.0.123:7000`. This causes immediate connection timeouts, mixed-content security blocks (HTTPS page requesting HTTP LAN IP), and broken thumbnails.

2. **Failure Mode on Stream Playback**:
   * The client requests `GET /stream/tv/nuvio_sport_123.json` via `https://sports.ngrok-free.app`.
   * Stream providers return `url: "http://192.168.0.123:7000/api/manifest?url=..."`.
   * The existing middleware only rewrites `s.externalUrl` starting with `/watch`. `s.url` is NOT rewritten.
   * Stremio attempts to play the stream from `http://192.168.0.123:7000/api/manifest` instead of `https://sports.ngrok-free.app/api/manifest`, causing fatal playback failure outside the local Wi-Fi subnet.

3. **Required Resolution Mechanism**:
   * **Base URL Detection**: Must dynamically extract the protocol and host on every incoming request:
     * Protocol: `req.headers['x-forwarded-proto']` (or `req.headers['cf-visitor']`, `req.headers['x-forwarded-ssl']`, fallback to `req.protocol` / `'http'`).
     * Host: `req.headers['x-forwarded-host']` or `req.get('host')` or `req.headers.host`.
     * Clean formatting: Take the first comma-separated entry, trim whitespace, strip trailing slashes.
   * **Dynamic Local IP Fallback (Zero Hardcoding)**:
     * In `src/config.js`, replace the hardcoded string with dynamic OS network interface enumeration (`os.networkInterfaces()`) to discover the active non-internal IPv4 address at runtime.
     * In `.env`, remove `ADDON_URL=http://192.168.0.123:7000`.
   * **Universal Response Rewriter Middleware**:
     * An Express middleware intercepting all Stremio routes (`/manifest.json`, `/:config/manifest.json`, `/catalog/*`, `/meta/*`, `/stream/*`).
     * Dynamically replaces internal routes (`/img...`, `/img/placeholder...`, `/watch...`, `/api/manifest...`) and any existing occurrences of `BASE_URL` or LAN IPs with the request's dynamic base URL `${proto}://${host}`.

---

## 3. Detailed Architecture & Refactoring Design

### 3.1 Trust Proxy Configuration
Enable Express proxy trust at the top of `src/index.js` immediately after initializing `app = express()`:
```javascript
app.set('trust proxy', true);
```
This enables Express to automatically parse `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host`.

### 3.2 Dynamic Base URL Utility (`src/config.js`)
Refactor `src/config.js` to:
1. Detect local IPv4 interfaces dynamically without any hardcoded IP.
2. Provide a `getRequestBaseUrl(req)` helper.
3. Retain a fallback `BASE_URL` for CLI/worker scripts where `req` is absent.

```javascript
const os = require('os');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const PORT = parseInt(process.env.PORT, 10) || 7000;

function getRequestBaseUrl(req) {
  if (!req) return BASE_URL;

  // Protocol extraction (handles reverse proxies, Cloudflare, ngrok)
  let proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  if (typeof proto === 'string' && proto.includes(',')) {
    proto = proto.split(',')[0].trim();
  }
  if (req.headers['x-forwarded-ssl'] === 'on') {
    proto = 'https';
  }
  if (req.headers['cf-visitor']) {
    try {
      const visitor = JSON.parse(req.headers['cf-visitor']);
      if (visitor && visitor.scheme) proto = visitor.scheme;
    } catch (_) {}
  }

  // Host extraction (handles X-Forwarded-Host, Host header)
  let host = req.headers['x-forwarded-host'] || (req.get && req.get('host')) || req.headers.host;
  if (typeof host === 'string' && host.includes(',')) {
    host = host.split(',')[0].trim();
  }

  if (host) {
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  return BASE_URL;
}

const BASE_URL = (
  process.env.ADDON_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : null) ||
  `http://${getLocalIp()}:${PORT}`
).replace(/\/$/, '');

module.exports = { PORT, BASE_URL, getLocalIp, getRequestBaseUrl };
```

### 3.3 Universal Dynamic Response Rewriter Middleware (`src/index.js`)
Replace lines 418–472 in `src/index.js` with a universal interceptor middleware placed before the Stremio routes:

```javascript
// ─── Universal Dynamic Base URL Response Rewriter ─────────────────────────────
// Intercepts /manifest.json, /catalog/*, /meta/*, and /stream/* responses to
// dynamically rewrite all internal proxy URLs (/img, /watch, /api/manifest)
// to match the client's incoming Host and Protocol.
app.use((req, res, next) => {
  const isAddonRoute = req.path === '/manifest.json' || 
                       req.path.endsWith('/manifest.json') ||
                       req.path.includes('/catalog/') || 
                       req.path.includes('/meta/') || 
                       req.path.includes('/stream/');
  
  if (!isAddonRoute) return next();

  const currentBaseUrl = getRequestBaseUrl(req);
  const originalWrite = res.write;
  const originalEnd = res.end;
  const chunks = [];

  res.write = function (chunk) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  res.end = function (chunk, encoding, callback) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

    if (chunks.length > 0) {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyString = bodyBuffer.toString('utf8');

      try {
        const body = JSON.parse(bodyString);
        let modified = false;

        const rewriteUrl = (url) => {
          if (!url || typeof url !== 'string') return url;
          // Relative URLs
          if (url.startsWith('/img') || url.startsWith('/watch') || url.startsWith('/api/manifest')) {
            modified = true;
            return `${currentBaseUrl}${url}`;
          }
          // Absolute URLs with legacy/static base or localhost/LAN IP
          const match = url.match(/^(?:https?:\/\/[^\/]+)(\/(?:img|watch|api\/manifest)(?:[?\/].*)?)$/);
          if (match) {
            modified = true;
            return `${currentBaseUrl}${match[1]}`;
          }
          return url;
        };

        // 1. Streams payload (/stream/tv/*.json)
        if (body && Array.isArray(body.streams)) {
          body.streams.forEach(s => {
            if (s.url) s.url = rewriteUrl(s.url);
            if (s.externalUrl) s.externalUrl = rewriteUrl(s.externalUrl);
          });
        }

        // 2. Catalog payload (/catalog/tv/*.json)
        if (body && Array.isArray(body.metas)) {
          body.metas.forEach(meta => {
            if (meta.poster) meta.poster = rewriteUrl(meta.poster);
            if (meta.background) meta.background = rewriteUrl(meta.background);
            if (meta.logo) meta.logo = rewriteUrl(meta.logo);
          });
        }

        // 3. Meta detail payload (/meta/tv/*.json)
        if (body && body.meta) {
          if (body.meta.poster) body.meta.poster = rewriteUrl(body.meta.poster);
          if (body.meta.background) body.meta.background = rewriteUrl(body.meta.background);
          if (body.meta.logo) body.meta.logo = rewriteUrl(body.meta.logo);
        }

        if (modified) {
          const newBodyString = JSON.stringify(body);
          const newBuffer = Buffer.from(newBodyString, 'utf8');
          res.setHeader('Content-Length', newBuffer.length);
          return originalEnd.call(res, newBuffer, 'utf8', callback);
        }
      } catch (_) {
        // Not JSON or parse failure; fall through
      }
    }

    const finalBuffer = Buffer.concat(chunks);
    originalEnd.call(res, finalBuffer, encoding, callback);
  };

  next();
});
```

### 3.4 Provider & Service Alignment
To maintain clean internal representations:
1. In `src/catalog.js`: `imageService.proxyUrl` and `imageService.placeholderUrl` can generate relative paths or default paths; the response interceptor guarantees they are rewritten to `currentBaseUrl`.
2. In stream providers (`EmbedIndiaProvider.js`, `EmbedStProvider.js`, `StreamFreeProvider.js`, `TimStreamsProvider.js`, `WatchFootyProvider.js`): Providers can continue returning `/api/manifest?...` or `${BASE_URL}/api/manifest?...`; the response interceptor guarantees dynamic conversion.
3. In `src/providers/SportyHunterProvider.js`: Clean up the unused `const { BASE_URL } = require('../config');` import.

---

## 4. Exact Inventory of Files Requiring Changes

| # | File Path | Line Range | Nature of Change |
|---|---|---|---|
| 1 | `src/config.js` | 13–30 | Replace hardcoded `'192.168.0.123'` with dynamic `os.networkInterfaces()` enumeration. Add and export `getRequestBaseUrl(req)` helper. |
| 2 | `.env` | 3 | Remove or empty out `ADDON_URL=http://192.168.0.123:7000` to prevent forcing a static IP. |
| 3 | `src/index.js` | 90–93 | Add `app.set('trust proxy', true);` to enable Express proxy header parsing. |
| 4 | `src/index.js` | 25 | Import `getRequestBaseUrl` from `./config`. |
| 5 | `src/index.js` | 414–472 | Replace the partial stream rewrite middleware with the Universal Dynamic Base URL Response Rewriter interceptor covering `/manifest.json`, `/catalog/*`, `/meta/*`, and `/stream/*`. |
| 6 | `src/providers/SportyHunterProvider.js` | 7 | Remove unused `BASE_URL` import. |

---

## 5. Caveats

* **Internal Child Process Proxy**: `resolver/src/server.js` binds to loopback (`127.0.0.1:RESOLVER_PORT`) and is proxied via `createProxyMiddleware({ target: 'http://127.0.0.1:${RESOLVER_PORT}/api' })`. This internal IPC communication is intended to remain on loopback and is not exposed to external clients.
* **Compiled Bundle (`dist/index.js`)**: The project includes a pre-bundled `dist/index.js` generated by `@vercel/ncc`. Any changes in `src/` must be followed by `npm run build` so `dist/` is refreshed in lockstep.

---

## 6. Conclusion

* The root cause of the hardcoded IP issue is localized to `src/config.js` (line 17 `return '192.168.0.123'`), `.env` (`ADDON_URL=http://192.168.0.123:7000`), and the lack of a universal response-rewriting middleware across `/catalog/`, `/meta/`, and `/stream/` endpoints.
* By implementing `os.networkInterfaces()` auto-detection in `src/config.js` and the Universal Dynamic Base URL Response Rewriter middleware in `src/index.js`, all generated JSON payloads (manifest, catalog, meta, stream) will dynamically adopt the incoming request's `Host` and `X-Forwarded-Proto`/`X-Forwarded-Host` headers.
* This ensures flawless operation across `localhost`, ngrok tunnels, LAN IPs, and reverse-proxied VPS domains with zero hardcoded `192.168.0.xx` strings remaining in the codebase.

---

## 7. Verification Method

To independently verify the findings and proposed solution:

1. **Static Code Scan (Zero Hardcoded IP Strings)**:
   ```bash
   grep -rn "192.168" src/ .env
   ```
   *Pass Condition*: Zero occurrences of `192.168` in `src/` and `.env`.

2. **Dynamic Host Header Verification via cURL**:
   Start the server:
   ```bash
   node src/index.js
   ```
   Test with custom `Host` and `X-Forwarded-Proto` headers simulating an ngrok tunnel or VPS:
   ```bash
   curl -s -H "Host: mytunnel.ngrok-free.app" -H "X-Forwarded-Proto: https" http://localhost:7000/catalog/tv/nuvio_sports_live.json | grep -o "https://mytunnel.ngrok-free.app/img"
   ```
   *Pass Condition*: Catalog items contain `https://mytunnel.ngrok-free.app/img?...` and zero `192.168.0.xx` or `localhost:7000` strings.

   Test stream endpoint with simulated VPS reverse proxy:
   ```bash
   curl -s -H "X-Forwarded-Host: nuvio.mysite.com" -H "X-Forwarded-Proto: https" http://localhost:7000/stream/tv/nuvio_sport_<match_id>.json | grep -o "https://nuvio.mysite.com"
   ```
   *Pass Condition*: Returned `url` and `externalUrl` properties use `https://nuvio.mysite.com/...`.

3. **Existing Test Suite Verification**:
   ```bash
   node test-health.js
   node test-e2e.js
   ```
   *Pass Condition*: All health checks and e2e stream resolutions pass without regression.
