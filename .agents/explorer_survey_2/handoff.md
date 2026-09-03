# R2 (Thumbnail Repair) Investigation & Architectural Report

## 1. Observation

Direct investigation of the codebase and test runs revealed the following findings, file paths, line numbers, and exact behaviors:

### 1.1 Hardcoded Static IP in `BASE_URL` & Catalog Metadata
- **File**: `src/config.js`, lines 15–27:
  ```javascript
  function getLocalIp() {
    // Hardcoding the exact Wi-Fi interface IP to guarantee Stremio on the phone connects properly
    return '192.168.0.123';
  }
  ...
  const BASE_URL = (
    process.env.ADDON_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : null) ||
    `http://${getLocalIp()}:${PORT}`
  ).replace(/\/$/, '');
  ```
- **File**: `src/catalog.js`, lines 4, 105, 110–135:
  ```javascript
  const { BASE_URL } = require('./config');
  ...
  const fallbackPoster = imageService.placeholderUrl(BASE_URL, posterText, color);
  const buildImg = (sourceUrl, fbText, c) =>
    imageService.proxyUrl(BASE_URL, sourceUrl, { text: fbText, color: c });
  ```
- **Runtime Test Verification**:
  Running `handleCatalog` with mock data produced:
  ```json
  {
    "id": "nuvio_sport_test1",
    "name": "🔴 LIVE: Arsenal vs Chelsea",
    "poster": "http://192.168.0.123:7000/img?url=https%3A%2F%2Fstreamed.pk%2Fimages%2Fposter.jpg&text=Arsenal%0Avs%0AChelsea&color=10b981",
    "background": "http://192.168.0.123:7000/img?url=https%3A%2F%2Fstreamed.pk%2Fimages%2Fposter.jpg&text=Arsenal%0Avs%0AChelsea&color=10b981",
    "logo": "http://192.168.0.123:7000/img?url=https%3A%2F%2Fcdn.example.com%2Farsenal.png&text=Arsenal%20vs%20Chelsea&color=161616"
  }
  ```
- **Finding**: When accessed over ngrok (`https://xyz.ngrok-free.app`), Cloudflare tunnel, or a public VPS, all thumbnail URLs point directly to `http://192.168.0.123:7000`. Stremio clients on external networks/devices cannot reach `192.168.0.123`, causing 100% of thumbnails, logos, and background images to fail with network connection timeouts / `ERR_CONNECTION_REFUSED`.

### 1.2 Missing Express Response Rewriting for Catalog and Meta Endpoints
- **File**: `src/index.js`, lines 418–472:
  Express only intercepts `/stream/` responses to rewrite relative `/watch` URLs to dynamic `currentBaseUrl`.
  No response rewriting exists for `/catalog/` or `/meta/` endpoints.
- **Finding**: Even if a request arrives with `Host: xyz.ngrok-free.app` and `X-Forwarded-Proto: https`, the Stremio Addon SDK serves the catalog and meta JSON with the static `BASE_URL` (`http://192.168.0.123:7000`).

### 1.3 Scraper Thumbnail Normalization Flaws
- **File**: `src/catalog.js`, lines 122–126:
  ```javascript
  } else if (match.thumbnail_url) {
    const tUrl = match.thumbnail_url.startsWith('http') ? match.thumbnail_url : `https://streamfree.top${match.thumbnail_url}`;
    const isLogo = match.category === 'networks' || tUrl.toLowerCase().includes('logo') || tUrl.toLowerCase().includes('icon');
    poster = buildImg(tUrl, posterText, color) || fallbackPoster;
  ```
  - If `thumbnail_url` is protocol-relative (e.g. `//upload.wikimedia.org/test.png` or `//cdn.streamfree.top/thumb.jpg`), `startsWith('http')` evaluates to `false`. `tUrl` becomes `https://streamfree.top//upload.wikimedia.org/test.png`, creating an invalid malformed URL.
  - If `thumbnail_url` is an empty string `""` or whitespace, `tUrl` evaluates to `https://streamfree.top`, causing `ImageService` to download the HTML homepage.
  - If `thumbnail_url` originated from another provider (e.g. `StreamSports99Provider`, `TimStreamsProvider`, `IptvOrgProvider`), prepending `https://streamfree.top` generates a 404 URL.
- **File**: `src/providers/StreamedPkProvider.js`, lines 117–119:
  ```javascript
  poster: item.poster ? (item.poster.startsWith('http') ? item.poster : `https://streamed.pk${item.poster}`) : '',
  logo: item.teams && item.teams.home && item.teams.home.badge ? `https://streamed.pk/api/images/proxy/${item.teams.home.badge}` : '',
  background: item.poster ? (item.poster.startsWith('http') ? item.poster : `https://streamed.pk${item.poster}`) : '',
  ```
  - If `item.poster` does not have a leading slash (e.g. `images/abc.jpg`), it becomes `https://streamed.pkimages/abc.jpg`.
  - If `item.poster` starts with `//`, `startsWith('http')` is false and it becomes `https://streamed.pk//...`.
- **File**: `src/providers/WatchFootyProvider.js`, line 59:
  - Similar naive `startsWith('http')` check with `https://api.watchfooty.st${item.poster}`.
- **File**: `src/providers/IptvOrgProvider.js`, line 58:
  - Constructs `https://logo.clearbit.com/${hostname}`. The unauthenticated Clearbit API is deprecated/blocked and returns 403/404/429.

### 1.4 ImageService Regex Rejection of Protocol-Relative URLs
- **File**: `src/services/ImageService.js`, lines 78 and 156:
  ```javascript
  function proxyUrl(baseUrl, sourceUrl, { text = '', color = '333333' } = {}) {
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
    return `${baseUrl}/img?url=${encodeURIComponent(sourceUrl)}&text=${encodeURIComponent(text)}&color=${color}`;
  }
  async function getImage(url) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    ...
  ```
- **Runtime Test Verification**:
  ```
  proxyUrl with //: null
  getImage with //: null
  ```
- **Finding**: Any protocol-relative `//` URL is immediately rejected as invalid by `proxyUrl`, causing `catalog.js` to discard the image and drop to the text placeholder.

### 1.5 Thumbnail / Team Logo Loss during Match Aggregation Deduplication
- **File**: `src/services/MatchAggregator.js`, lines 228–234:
  ```javascript
  if (match.popular === '1') existing.popular = '1';
  if (!existing.poster && match.poster) existing.poster = match.poster;
  if (existing.description === 'No description' && match.description && match.description !== 'No description') {
    existing.description = match.description;
  }
  if (!existing.logo && match.logo) existing.logo = match.logo;
  ```
- **Finding**: When `StreamedPkProvider` (which supplies title and streams but no team logos or thumbnail_url) is merged with `StreamFreeProvider` or `StreamSports99Provider` (which supply `thumbnail_url`, `team1.logo`, and `team2.logo`), `MatchAggregator.js` fails to copy `thumbnail_url`, `team1.logo`, `team2.logo`, and `background`. The resulting unified event loses all scraper-provided team logos and thumbnails.

### 1.6 Missing Team Logo Fallback in Catalog Preview
- **File**: `src/catalog.js`, lines 113–131:
  When `match.poster`, `channelLogo`, and `match.thumbnail_url` are absent, `poster` defaults to `fallbackPoster` (text SVG), completely ignoring `match.team1?.logo` and `match.team2?.logo` which are present on the match entity.

---

## 2. Logic Chain

1. **Premise 1 (Dynamic Host)**: Stremio is an API-driven client running on desktops, web browsers (`web.stremio.com`), and mobile/TV devices. It does not resolve relative image URLs against the addon server, but rather against its own origin or parses them as absolute URLs. Therefore, all `poster`, `background`, and `logo` fields must be absolute URLs containing the scheme and hostname of the current request.
2. **Premise 2 (Zero Hardcoded IPs)**: `src/config.js` sets `BASE_URL` to `http://192.168.0.123:7000` at startup. When Stremio fetches the catalog through ngrok (`https://xyz.ngrok-free.app`), the returned JSON contains `http://192.168.0.123:7000/img?...`. Because `192.168.0.123` is unroutable outside the local LAN, all thumbnail downloads time out and fail.
3. **Premise 3 (Upstream CDN Hotlinking & Dead Links)**: Scraped images from sports providers frequently fail due to:
   - Upstream CORS blocks or 403 Forbidden hotlink prevention (e.g. Wikimedia, StreamFree, StreamedPk).
   - Ephemeral or expired token URLs.
   - Non-existent Clearbit logos.
   - Malformed protocol-relative (`//`) or relative paths (`/images/...`).
4. **Premise 4 (Built-in Image Proxy & SVG Fallback Guarantee)**:
   - `src/services/ImageService.js` provides `getImage(url)` (fetching with browser User-Agent and caching) and `svgPlaceholder(text, color)` (generating custom SVG cards).
   - `src/index.js` routes `/img` and `/img/placeholder` serve cached binary images on success and category-colored SVG cards on failure.
   - Because the proxy endpoint returns `200 OK` with valid image data (either JPEG/PNG or SVG) in all scenarios, routing catalog images through `/img` ensures Stremio receives 100% 200 OK delivery with zero broken thumbnails.
5. **Synthesis**:
   To guarantee 100% reliable 200 OK thumbnail delivery across all environments (localhost, LAN, ngrok, VPS):
   - Replace hardcoded `192.168.0.123` in `src/config.js` with dynamic local interface detection and fallback to `http://localhost:${PORT}`.
   - Implement an Express response interception middleware in `src/index.js` that dynamically rewrites `BASE_URL` in `/catalog/`, `/meta/`, `/stream/`, and `/manifest.json` responses using `req.headers['x-forwarded-host'] || req.headers.host`.
   - Normalize all provider image URLs (handling `//`, leading slashes, and provider base URLs).
   - In `MatchAggregator.js`, preserve `thumbnail_url`, `team1.logo`, `team2.logo`, and `background` during match deduplication.
   - In `catalog.js`, expand the poster fallback hierarchy to check `team1.logo` before generating text SVGs.
   - In `ImageService.js` and `index.js`, add protocol-relative `//` support, optimize timeouts (3000ms), and set explicit CORS and Cache-Control headers.

---

## 3. Caveats

1. **Stremio Web vs Stremio Native Client SVG Handling**:
   - Stremio Web and Stremio Desktop render inline `image/svg+xml` flawlessly.
   - Certain older Android TV Glide builds may require proper SVG dimensions (`width="800" height="450" viewBox="0 0 800 450"`), which `ImageService.svgPlaceholder` already includes.
2. **Reverse Proxy Header Trust**:
   - When deploying behind proxies like ngrok or Cloudflare, `X-Forwarded-Proto` and `X-Forwarded-Host` must be parsed with fallback to `req.headers.host` and `req.protocol`. If multiple comma-separated values exist, the first value must be extracted (`split(',')[0].trim()`).
3. **Memory Footprint of Image Cache**:
   - `ImageService.js` has `CACHE_MAX_ENTRIES = 120` and `IMAGE_MAX_BYTES = 1.5 * 1024 * 1024` with LRU eviction. This keeps peak image memory under ~180MB, well within the 512MB limit.

---

## 4. Conclusion & Recommended Fix Strategy

### 4.1 Required Changes by File

#### 1. `src/config.js`
- **Action**: Eliminate hardcoded `'192.168.0.123'`.
- **Implementation**:
  ```javascript
  const os = require('os');
  const PORT = parseInt(process.env.PORT, 10) || 7000;

  function getLocalIp() {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
    } catch (_) {}
    return 'localhost';
  }

  const BASE_URL = (
    process.env.ADDON_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : null) ||
    `http://localhost:${PORT}`
  ).replace(/\/$/, '');

  module.exports = { PORT, BASE_URL, getLocalIp };
  ```

#### 2. `src/index.js`
- **Action**: Replace the stream-only URL rewrite middleware (lines 418–472) with a unified **Dynamic Host & Asset Rewriter Middleware** for `/catalog/`, `/meta/`, `/stream/`, and `manifest.json`.
- **Implementation**:
  ```javascript
  function getRequestBaseUrl(req) {
    if (process.env.ADDON_URL) return process.env.ADDON_URL.replace(/\/$/, '');
    let proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    if (proto.includes(',')) proto = proto.split(',')[0].trim();
    let host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host && host.includes(',')) host = host.split(',')[0].trim();
    return host ? `${proto}://${host}`.replace(/\/$/, '') : BASE_URL;
  }

  function rewriteUrl(url, baseUrl) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('/img') || url.startsWith('/watch') || url.startsWith('/api/manifest')) {
      return `${baseUrl}${url}`;
    }
    // Replace old static BASE_URL or local IP prefixes
    const match = url.match(/^https?:\/\/[^\/]+(\/(?:img|watch|api\/manifest).*)$/);
    if (match) {
      return `${baseUrl}${match[1]}`;
    }
    return url;
  }

  app.use((req, res, next) => {
    const isAddonResource = req.path.includes('/catalog/') ||
                            req.path.includes('/meta/') ||
                            req.path.includes('/stream/') ||
                            req.path.endsWith('/manifest.json');
    if (!isAddonResource) return next();

    const currentBaseUrl = getRequestBaseUrl(req);
    const originalWrite = res.write;
    const originalEnd = res.end;
    let chunks = [];

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

          if (body.metas && Array.isArray(body.metas)) {
            body.metas.forEach(meta => {
              ['poster', 'background', 'logo'].forEach(field => {
                if (meta[field]) { meta[field] = rewriteUrl(meta[field], currentBaseUrl); modified = true; }
              });
            });
          }
          if (body.meta && typeof body.meta === 'object') {
            ['poster', 'background', 'logo'].forEach(field => {
              if (body.meta[field]) { body.meta[field] = rewriteUrl(body.meta[field], currentBaseUrl); modified = true; }
            });
          }
          if (body.streams && Array.isArray(body.streams)) {
            body.streams.forEach(s => {
              if (s.externalUrl) { s.externalUrl = rewriteUrl(s.externalUrl, currentBaseUrl); modified = true; }
              if (s.url && s.url.startsWith('/api/manifest')) { s.url = rewriteUrl(s.url, currentBaseUrl); modified = true; }
            });
          }
          if (modified) {
            const newBuf = Buffer.from(JSON.stringify(body), 'utf8');
            res.setHeader('Content-Length', newBuf.length);
            return originalEnd.call(res, newBuf, 'utf8', callback);
          }
        } catch (_) {}
      }
      const finalBuf = Buffer.concat(chunks);
      originalEnd.call(res, finalBuf, encoding, callback);
    };
    next();
  });
  ```
- **CORS & Cache Headers on `/img` and `/img/placeholder`**:
  ```javascript
  app.get('/img/placeholder', (req, res) => {
    const svg = imageService.svgPlaceholder(req.query.text || 'Live Sports', req.query.color || '333333');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.send(svg);
  });

  app.get('/img', async (req, res) => {
    const text = req.query.text || 'Live Sports';
    const color = req.query.color || '333333';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const entry = await imageService.getImage(req.query.url);
    if (entry) {
      res.setHeader('Content-Type', entry.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(entry.buffer);
    }
    const svg = imageService.svgPlaceholder(text, color);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  });
  ```

#### 3. `src/services/ImageService.js`
- **Action**: Add protocol-relative URL normalization (`//` -> `https://`), trim whitespace, shorten timeouts to 3000ms.
- **Implementation**:
  ```javascript
  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let u = url.trim();
    if (!u) return null;
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u)) return null;
    return u;
  }

  function proxyUrl(baseUrl, sourceUrl, { text = '', color = '333333' } = {}) {
    const validUrl = normalizeUrl(sourceUrl);
    if (!validUrl) return null;
    return `${baseUrl}/img?url=${encodeURIComponent(validUrl)}&text=${encodeURIComponent(text)}&color=${color}`;
  }

  async function getImage(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    ...
    // AbortSignal timeout: 3000ms fetch + 2000ms deadline
    const res = await request(url, {
      headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8' },
      headersTimeout: 3000,
      bodyTimeout: 3000,
      signal: AbortSignal.timeout(4000)
    });
    ...
  }
  ```

#### 4. `src/catalog.js`
- **Action**: Implement robust URL resolution, expanded fallback chain (Poster -> ChannelLogo -> Thumbnail -> Team1 Logo -> SVG Fallback), and dynamic base URL usage.
- **Implementation**:
  ```javascript
  function normalizeImageUrl(url, defaultHost = 'https://streamfree.top') {
    if (!url || typeof url !== 'string') return null;
    let u = url.trim();
    if (!u) return null;
    if (u.startsWith('//')) return `https:${u}`;
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    if (u.startsWith('/')) return `${defaultHost}${u}`;
    return `${defaultHost}/${u}`;
  }
  ```
  In `mapMatchToMetaPreview`:
  ```javascript
  const channelLogo = getChannelLogo(match.title);
  const team1Logo = match.team1?.logo ? normalizeImageUrl(match.team1.logo) : null;
  const matchPoster = match.poster ? normalizeImageUrl(match.poster) : null;
  const matchThumb = match.thumbnail_url ? normalizeImageUrl(match.thumbnail_url) : null;

  if (matchPoster) {
    poster = buildImg(matchPoster, posterText, color) || fallbackPoster;
  } else if (channelLogo) {
    poster = buildImg(channelLogo, match.title, '161616') || fallbackPoster;
    logo = channelLogo;
  } else if (matchThumb) {
    const isLogo = match.category === 'networks' || matchThumb.toLowerCase().includes('logo') || matchThumb.toLowerCase().includes('icon');
    poster = buildImg(matchThumb, posterText, color) || fallbackPoster;
    if (isLogo && !logo) logo = matchThumb;
  } else if (team1Logo) {
    poster = buildImg(team1Logo, posterText, color) || fallbackPoster;
    if (!logo) logo = team1Logo;
  }
  ```

#### 5. `src/services/MatchAggregator.js`
- **Action**: Ensure all thumbnail, logo, and background attributes survive deduplication.
- **Implementation**:
  ```javascript
  if (!existing.poster && match.poster) existing.poster = match.poster;
  if (!existing.logo && match.logo) existing.logo = match.logo;
  if (!existing.thumbnail_url && match.thumbnail_url) existing.thumbnail_url = match.thumbnail_url;
  if (!existing.background && match.background) existing.background = match.background;
  if (!existing.league && match.league) existing.league = match.league;
  if (!existing.team1 && match.team1) existing.team1 = match.team1;
  else if (existing.team1 && !existing.team1.logo && match.team1?.logo) existing.team1.logo = match.team1.logo;
  if (!existing.team2 && match.team2) existing.team2 = match.team2;
  else if (existing.team2 && !existing.team2.logo && match.team2?.logo) existing.team2.logo = match.team2.logo;
  ```

#### 6. Provider Scrapers (`StreamedPkProvider`, `WatchFootyProvider`, `StreamSports99Provider`, `IptvOrgProvider`, `TimStreamsProvider`)
- **Action**: Clean up leading slashes, protocol-relative URLs, and replace dead Clearbit references.

---

## 5. Verification Method

To verify the thumbnail repair and dynamic host routing independently:

1. **Hardcoded IP Verification**:
   ```pwsh
   Get-ChildItem -Recurse -File -Include *.js,*.json,*.html -Exclude package-lock.json,bun.lock | Select-String "192\.168\."
   ```
   *Expected Result*: 0 matches found in all application source files.

2. **Catalog Dynamic Host & Thumbnail URL Verification**:
   Send a request with a custom `Host` header to simulate ngrok / public domain access:
   ```pwsh
   $res = Invoke-RestMethod -Uri "http://localhost:7000/catalog/tv/nuvio_sports_live.json" -Headers @{ "Host" = "test-domain.ngrok-free.app"; "X-Forwarded-Proto" = "https" }
   $sampleMeta = $res.metas[0]
   Write-Host "Poster URL:" $sampleMeta.poster
   Write-Host "Background URL:" $sampleMeta.background
   Write-Host "Logo URL:" $sampleMeta.logo
   ```
   *Expected Result*: All URLs start with `https://test-domain.ngrok-free.app/img` or `https://test-domain.ngrok-free.app/img/placeholder` and contain zero instances of `192.168.0.xx` or `localhost:7000`.

3. **Proxy 200 OK & Fallback Resiliency Test**:
   - Fetch a valid proxied image URL from the catalog:
     ```pwsh
     $imgRes = Invoke-WebRequest -Uri $sampleMeta.poster -SkipHttpErrorCheck
     Write-Host "Status Code:" $imgRes.StatusCode
     Write-Host "Content-Type:" $imgRes.Headers["Content-Type"]
     Write-Host "CORS Origin:" $imgRes.Headers["Access-Control-Allow-Origin"]
     ```
     *Expected Result*: `200 OK`, valid `image/*` or `image/svg+xml`, and `Access-Control-Allow-Origin: *`.
   - Fetch a proxied dead URL (`/img?url=https://dead-domain-12345.xyz/img.jpg`):
     ```pwsh
     $deadRes = Invoke-WebRequest -Uri "http://localhost:7000/img?url=https://dead-domain-12345.xyz/img.jpg&text=Arsenal%20vs%20Chelsea" -SkipHttpErrorCheck
     Write-Host "Status Code:" $deadRes.StatusCode
     Write-Host "Content-Type:" $deadRes.Headers["Content-Type"]
     ```
     *Expected Result*: `200 OK`, `Content-Type: image/svg+xml` containing custom rendered match SVG (never 404 or 500).

4. **Invalidation Conditions**:
   - Any `poster`, `background`, or `logo` containing `192.168.0.xx`.
   - Any thumbnail returning HTTP 404, 500, or hanging past 5 seconds.
   - Any broken image icon displaying in the Stremio catalog view.
