const { request } = require('undici');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../../tests/load/server-runner');

async function runAudit() {
  console.log('='.repeat(80));
  console.log('  🔍 FORENSIC AUDITOR INDEPENDENT VERIFICATION RUN');
  console.log('='.repeat(80));

  const TEST_PORT = 7025;
  const TEST_RESOLVER_PORT = 7028;
  let serverInstance = null;

  const results = [];
  const log = (id, title, pass, details) => {
    results.push({ id, title, pass, details });
    const mark = pass ? 'PASS [OK]' : 'FAIL [X] ';
    console.log(`  ${mark} | ${id.padEnd(6)} | ${title.padEnd(45)} | ${details}`);
  };

  try {
    // 0. Boot server
    serverInstance = await startServer({
      port: TEST_PORT,
      resolverPort: TEST_RESOLVER_PORT,
      reuseExisting: false
    });
    const BASE = serverInstance.baseUrl;

    // Await match ingestion
    const t0 = Date.now();
    let matchCount = 0;
    while (Date.now() - t0 < 30000) {
      try {
        const mRes = await request(`${BASE}/api/matches`);
        if (mRes.statusCode === 200) {
          const mList = await mRes.body.json();
          if (Array.isArray(mList) && mList.length > 0) {
            matchCount = mList.length;
            break;
          }
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 1000));
    }

    // 1. Health check
    try {
      const res = await request(`${BASE}/health`);
      const data = await res.body.json();
      log('A1', 'Health Endpoint Check', res.statusCode === 200 && data.status === 'ok', `Status: ${res.statusCode}, Ingested: ${matchCount} matches`);
    } catch (err) {
      log('A1', 'Health Endpoint Check', false, err.message);
    }

    // 2. Zero hardcoded IP scan in src/ and .env
    try {
      const srcDir = path.resolve(__dirname, '../../src');
      const scanDir = (dir) => {
        let files = [];
        for (const item of fs.readdirSync(dir)) {
          const full = path.join(dir, item);
          if (fs.statSync(full).isDirectory()) files = files.concat(scanDir(full));
          else if (full.endsWith('.js') || full.endsWith('.json')) files.push(full);
        }
        return files;
      };
      const allFiles = scanDir(srcDir);
      allFiles.push(path.resolve(__dirname, '../../.env'));

      const leaks = [];
      for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('192.168.0.') || content.includes('192.168.1.')) {
          leaks.push(path.basename(file));
        }
      }
      log('A2', 'Zero Hardcoded Private IPs in Codebase', leaks.length === 0, leaks.length === 0 ? `0 leaks across ${allFiles.length} files` : `Leaks in ${leaks.join(', ')}`);
    } catch (err) {
      log('A2', 'Zero Hardcoded Private IPs in Codebase', false, err.message);
    }

    // 3. Dynamic Host Header Variations (R1)
    const testHeaders = [
      {
        label: 'Direct Ngrok HTTPS',
        headers: { host: 'test-addon.ngrok-free.app', 'x-forwarded-proto': 'https' },
        expected: 'https://test-addon.ngrok-free.app'
      },
      {
        label: 'Reverse Proxy with X-Forwarded-Host',
        headers: { 'x-forwarded-host': 'sports.my-custom-vps.io', 'x-forwarded-proto': 'https', host: `127.0.0.1:${TEST_PORT}` },
        expected: 'https://sports.my-custom-vps.io'
      },
      {
        label: 'Cloudflare cf-visitor scheme',
        headers: { host: 'cf-sports.domain.com', 'cf-visitor': JSON.stringify({ scheme: 'https' }) },
        expected: 'https://cf-sports.domain.com'
      },
      {
        label: 'Comma-separated X-Forwarded-Host chain',
        headers: { 'x-forwarded-host': 'client-entry.com, intermediate-proxy.com', 'x-forwarded-proto': 'https, http', host: `127.0.0.1:${TEST_PORT}` },
        expected: 'https://client-entry.com'
      }
    ];

    for (const th of testHeaders) {
      try {
        const res = await request(`${BASE}/manifest.json`, { headers: th.headers });
        const body = await res.body.json();
        const noLanIp = !JSON.stringify(body).includes('192.168.0.');
        log('A3', `Manifest Host: ${th.label}`, res.statusCode === 200 && noLanIp, `Status: ${res.statusCode}`);

        const catRes = await request(`${BASE}/catalog/tv/nuvio_sports_live.json`, { headers: th.headers });
        const catBody = await catRes.body.json();
        let dynamicOk = true;
        if (catBody.metas && catBody.metas.length > 0) {
          const item = catBody.metas[0];
          if (item.poster && !item.poster.startsWith(th.expected)) dynamicOk = false;
          if (item.background && !item.background.startsWith(th.expected)) dynamicOk = false;
        }
        log('A4', `Catalog Host: ${th.label}`, catRes.statusCode === 200 && dynamicOk, `Expected: ${th.expected}`);
      } catch (err) {
        log('A3/A4', `Host Test Failed: ${th.label}`, false, err.message);
      }
    }

    // 4. Thumbnail & Image Proxy Verification (R2)
    try {
      const catRes = await request(`${BASE}/catalog/tv/nuvio_sports_networks.json`);
      const catBody = await catRes.body.json();
      const metas = (catBody.metas || []).slice(0, 10);

      let imagesOk = 0;
      let corsOk = 0;

      for (const m of metas) {
        if (m.poster) {
          const localImg = m.poster.replace(/^https?:\/\/[^/]+/, BASE);
          const imgRes = await request(localImg, { headersTimeout: 5000, bodyTimeout: 5000 });
          const cType = imgRes.headers['content-type'] || '';
          const acao = imgRes.headers['access-control-allow-origin'];
          await imgRes.body.dump();

          if (imgRes.statusCode === 200 && (cType.includes('image/') || cType.includes('svg+xml'))) {
            imagesOk++;
          }
          if (acao === '*') {
            corsOk++;
          }
        }
      }
      log('A5', 'Catalog Thumbnail Accessibility (200 OK)', imagesOk === metas.length, `${imagesOk}/${metas.length} valid images`);
      log('A6', 'Thumbnail Proxy CORS Header (ACAO: *)', corsOk === metas.length, `${corsOk}/${metas.length} headers verified`);
    } catch (err) {
      log('A5/A6', 'Thumbnail Verification', false, err.message);
    }

    // 5. SVG Fallback Tests
    try {
      const pRes = await request(`${BASE}/img/placeholder?text=TestPoster&color=0ea5e9`);
      const pType = pRes.headers['content-type'] || '';
      const pAcao = pRes.headers['access-control-allow-origin'];
      const pBody = await pRes.body.text();
      const pOk = pRes.statusCode === 200 && pType.includes('svg+xml') && pAcao === '*' && pBody.includes('<svg') && pBody.includes('TestPoster');
      log('A7', 'Direct /img/placeholder Generation', pOk, `Status: ${pRes.statusCode}, SVG valid: ${pBody.includes('<svg')}`);

      const deadRes = await request(`${BASE}/img?url=https://dead-domain-404.nonexistent/img.jpg&text=FallbackTitle&color=ef4444`);
      const deadType = deadRes.headers['content-type'] || '';
      const deadAcao = deadRes.headers['access-control-allow-origin'];
      const deadBody = await deadRes.body.text();
      const deadOk = deadRes.statusCode === 200 && deadType.includes('svg+xml') && deadAcao === '*' && deadBody.includes('FallbackTitle');
      log('A8', 'Dead Upstream Resilient SVG Fallback', deadOk, `Status: ${deadRes.statusCode}, Fallback Rendered: ${deadOk}`);
    } catch (err) {
      log('A7/A8', 'Fallback Generation Test', false, err.message);
    }

    // 6. Stream Resolution & M3U8 Manifest Verification (R3)
    try {
      const liveRes = await request(`${BASE}/catalog/tv/nuvio_sports_live.json`);
      const liveData = await liveRes.body.json();
      const targetMatch = (liveData.metas || [])[0];

      if (targetMatch) {
        const simDomain = 'nuvio-stream.custom-domain.org';
        const sRes = await request(`${BASE}/stream/tv/${targetMatch.id}.json`, {
          headers: { host: simDomain, 'x-forwarded-proto': 'https' }
        });
        const sData = await sRes.body.json();
        const streams = sData.streams || [];
        let streamUrlsDynamic = streams.length > 0;
        streams.forEach(s => {
          if (s.url && s.url.includes('/api/manifest') && !s.url.startsWith(`https://${simDomain}`)) streamUrlsDynamic = false;
          if (s.externalUrl && s.externalUrl.includes('/watch') && !s.externalUrl.startsWith(`https://${simDomain}`)) streamUrlsDynamic = false;
        });
        log('A9', 'Stream Resolution & Dynamic Host', sRes.statusCode === 200 && streamUrlsDynamic, `Streams: ${streams.length}`);

        const direct = streams.find(s => s.url && s.url.includes('/api/manifest'));
        if (direct) {
          const localM3u8 = direct.url.replace(/^https?:\/\/[^/]+/, BASE);
          const mRes = await request(localM3u8, { headers: direct.behaviorHints?.proxyHeaders?.request || {} });
          const mBody = await mRes.body.text();
          const mOk = mRes.statusCode === 200 && mBody.includes('#EXTM3U');
          log('A10', 'HLS M3U8 Proxy Playback Verification', mOk, `Status: ${mRes.statusCode}, #EXTM3U: ${mBody.includes('#EXTM3U')}`);
        }

        const web = streams.find(s => s.externalUrl);
        if (web) {
          const localWatch = web.externalUrl.replace(/^https?:\/\/[^/]+/, BASE);
          const wRes = await request(localWatch);
          const wBody = await wRes.body.text();
          const wOk = wRes.statusCode === 200 && (wBody.includes('<video') || wBody.includes('<iframe') || wBody.includes('player'));
          log('A11', 'Web Embed Proxy /watch Verification', wOk, `Status: ${wRes.statusCode}`);
        }
      }
    } catch (err) {
      log('A9-A11', 'Stream Verification', false, err.message);
    }

  } finally {
    if (serverInstance && serverInstance.isSpawned) {
      await serverInstance.shutdown();
    }

    console.log('='.repeat(80));
    const allPassed = results.every(r => r.pass);
    console.log(`  FINAL VERDICT: ${allPassed ? '🎉 VICTORY CONFIRMED (100% PASS)' : '❌ VICTORY REJECTED'}`);
    console.log('='.repeat(80));
    if (!allPassed) process.exit(1);
  }
}

runAudit().catch(e => {
  console.error(e);
  process.exit(1);
});
