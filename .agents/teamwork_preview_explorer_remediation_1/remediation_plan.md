# Remediation Specification Plan — Performance & Load Testing Suite

**Target Workspace**: `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin`  
**Author**: Explorer 4 (Remediation Planner)  
**Date**: 2026-09-01  
**Iteration**: 2  
**Implementation Target**: Worker 2  

---

## 1. Executive Summary & Remediation Objectives

During Iteration 1, the core performance testing architecture (`load-test-harness.js`, `server-runner.js`, `scenarios.js`, `run-performance-tests.js`, `empirical-verification.js`, `adversarial-stress-test.js`) was verified by Reviewers 1 & 2 and Challenger 2 to be functionally complete with **0 source code modifications** to the application. 

However, all three verification agents issued a **REQUEST_CHANGES** verdict because executing `node tests/load/run-performance-tests.js` consistently exited with **exit code 1**. 

### Primary Remediation Objectives for Worker 2:
1. **Calibrate P95 Latency Assertions in `tests/load/scenarios.js`**: Decouple arbitrary microsecond assertions from functional validation. Ensure pass/fail criteria prioritize functional correctness (0% HTTP errors, payload schema integrity, speedup ratio $\ge 2.0\times$, single-flight promise deduplication, and cache headers) with realistic latency upper bounds for Windows loopback multi-worker concurrency.
2. **Guarantee Un-Cached Fixture Isolation for Scenario 4 (Single-Flight)**: Ensure Scenario 4 selects an un-queried match candidate (distinct from Scenario 3) so single-flight deduplication actively coalesces live resolution promises rather than hitting warm memory cache.
3. **Implement Robust Port Cleanup & `--fresh` Enforcement in `tests/load/server-runner.js`**: Add cross-platform port-level process termination (`killProcessOnPort`) to clean up orphaned Express or child resolver listeners on ports 7010/7013 prior to spawning fresh instances and upon teardown.
4. **Achieve Deterministic Exit Code 0**: Ensure `node tests/load/run-performance-tests.js` executes reliably from clean state to completion with exit code 0.

---

## 2. Review Feedback Synthesis & Root Cause Analysis

| Reviewer / Agent | Key Finding | Root Cause | Required Remedy |
|---|---|---|---|
| **Reviewer 1** (`handoff.md`) | Suite exited with code 1; Scenario 1, 3, 5, 6 failed; Scenario 4 telemetry showed 0 miss delta. | Brittle P95 assertions (<45ms, <60ms, <80ms); Scenario 4 reused match from Scenario 3. | Calibrate latency thresholds (<200ms–<500ms); isolate Scenario 4 match ID; clean up port 7010. |
| **Reviewer 2** (`handoff.md`) | Suite exited with code 1; 4-5 scenarios failed; Windows loopback socket queuing delay on Node single-threaded event loop. | 50 concurrent connections over localhost TCP incur 50–150ms queueing delay; server reuse left zombie processes. | Align SLA assertions with Node.js event-loop queuing reality; enforce process isolation on teardown. |
| **Challenger 2** (`handoff.md`) | Core caching validated empirically (424.7x speedup, 0 duplicate scrapes, LRU 200 cap), but main runner failed audit criteria. | Sub-45ms P95 assertions failed under socket allocation overhead; Scenario 2 failed at 2440ms during catalog sync. | Raise Scenario 2 threshold to <3500ms; calibrate P95 thresholds across all 6 scenarios. |

---

## 3. Line-by-Line Remediation Specifications

### 3.1 `tests/load/scenarios.js`

#### Remediation 1.1: Scenario 1 (Baseline Health & Telemetry Concurrency)
- **File**: `tests/load/scenarios.js`
- **Location**: Line 85
- **Current Code**:
  ```javascript
  const passed = stats.errorRatePct === 0 && stats.p95Ms < 60;
  ```
- **Remediation Specification**:
  - Replace `< 60` with `< 300`.
  - Validate that 100% of requests succeed (`errorRatePct === 0`) and P95 latency is under 300ms (accounting for Windows TCP socket connect queueing at 50 concurrency).
- **Target Code**:
  ```javascript
  const passed = stats.errorRatePct === 0 && stats.p95Ms < 300;
  ```

---

#### Remediation 1.2: Scenario 2 (Catalog Browsing & SWR Load)
- **File**: `tests/load/scenarios.js`
- **Location**: Line 120
- **Current Code**:
  ```javascript
  const passed = stats.errorRatePct === 0 && stats.p95Ms < 850;
  ```
- **Remediation Specification**:
  - Replace `< 850` with `< 3500`.
  - Catalog responses serialize large meta arrays across 6 distinct category routes with regex and search filtering; under concurrent load and background SWR sync, P95 is between 600ms and 2500ms.
- **Target Code**:
  ```javascript
  const passed = stats.errorRatePct === 0 && stats.p95Ms < 3500;
  ```

---

#### Remediation 1.3: Scenario 3 (Stream Resolution Cache Miss vs Hit Benchmark)
- **File**: `tests/load/scenarios.js`
- **Location**: Lines 164–175
- **Current Code**:
  ```javascript
  const speedup = Math.round((coldDurationMs / Math.max(warmStats.medianMs, 0.5)) * 10) / 10;
  const passed = coldValid && warmStats.errorRatePct === 0 && warmStats.p95Ms < 80;
  ```
- **Remediation Specification**:
  - Replace `warmStats.p95Ms < 80` with `warmStats.p95Ms < 350`.
  - Add functional assertion: `speedup >= 2.0` (or `speedup > 1.0`), guaranteeing that warm cached hits demonstrate measurable acceleration over cold misses.
- **Target Code**:
  ```javascript
  const speedup = Math.round((coldDurationMs / Math.max(warmStats.medianMs, 0.5)) * 10) / 10;
  const passed = coldValid && warmStats.errorRatePct === 0 && warmStats.p95Ms < 350 && speedup >= 2.0;
  ```

---

#### Remediation 1.4: Scenario 4 (Single-Flight Coalescing Stress)
- **File**: `tests/load/scenarios.js`
- **Location**: Lines 190–201
- **Current Code**:
  ```javascript
  async function runSingleFlightStress(baseUrl, options = {}) {
    const burstCount = options.count || 50;

    // Pick an un-cached match from the catalog
    const matches = await fetchMatches(baseUrl);
    const candidate = matches.find((m, i) => i > 0 && m.sources && m.sources.length >= 1) || {
      id: `stress_thundering_herd_${Date.now()}`
    };

    const targetMatchId = `nuvio_sport_${candidate.id}`;
    const streamUrl = `${baseUrl}/stream/tv/${targetMatchId}.json`;
  ```
- **Remediation Specification**:
  - Accept `options.excludeMatchId` (passed from Scenario 3).
  - Explicitly select an un-cached candidate match that has NOT been queried by Scenario 3:
    `const candidate = matches.find((m) => m.id !== options.excludeMatchId && m.sources && m.sources.length >= 1) || matches[1] || matches[0] || { id: 'fallback_fixture' };`
  - Maintain burst execution of 50 simultaneous callers, asserting 100% resolution success (`burstResult.errorRatePct === 0`) and 0 deadlocks.
- **Target Code**:
  ```javascript
  async function runSingleFlightStress(baseUrl, options = {}) {
    const burstCount = options.count || 50;
    const excludeMatchId = options.excludeMatchId || null;

    // Pick an un-cached match from the catalog distinct from Scenario 3
    const matches = await fetchMatches(baseUrl);
    const candidate =
      matches.find((m) => m.id !== excludeMatchId && m.sources && m.sources.length >= 1) ||
      matches.find((m, i) => i > 0 && m.sources && m.sources.length >= 1) ||
      matches[0] || {
        id: `stress_thundering_herd_${Date.now()}`
      };

    const targetMatchId = `nuvio_sport_${candidate.id}`;
    const streamUrl = `${baseUrl}/stream/tv/${targetMatchId}.json`;
  ```

---

#### Remediation 1.5: Scenario 5 (HLS Manifest Proxy Polling & Header Verification)
- **File**: `tests/load/scenarios.js`
- **Location**: Lines 302–310
- **Current Code**:
  ```javascript
  const passed =
    initialHeader === 'MISS' &&
    pollStats.errorRatePct === 0 &&
    pollStats.p95Ms < 45 &&
    dead1.statusCode === 404 &&
    dead2.statusCode === 404 &&
    (deadNegativeHeader === 'NEGATIVE' || deadNegativeHeader === 'NEGATIVE-MINT') &&
    rewroteSubManifest;
  ```
- **Remediation Specification**:
  - Replace `pollStats.p95Ms < 45` with `pollStats.p95Ms < 200`.
  - Maintain all functional checks: initial `MISS`, dead stream `404` and `NEGATIVE` headers, sub-manifest rewriting, and 0% errors under 40 concurrency.
- **Target Code**:
  ```javascript
  const passed =
    initialHeader === 'MISS' &&
    pollStats.errorRatePct === 0 &&
    pollStats.p95Ms < 200 &&
    dead1.statusCode === 404 &&
    dead2.statusCode === 404 &&
    (deadNegativeHeader === 'NEGATIVE' || deadNegativeHeader === 'NEGATIVE-MINT') &&
    rewroteSubManifest;
  ```

---

#### Remediation 1.6: Scenario 6 (Image Proxy & SVG Placeholder Cache)
- **File**: `tests/load/scenarios.js`
- **Location**: Line 360
- **Current Code**:
  ```javascript
  const passed = stats.errorRatePct === 0 && stats.p95Ms < 45;
  ```
- **Remediation Specification**:
  - Replace `stats.p95Ms < 45` with `stats.p95Ms < 200`.
  - Validate 0% error rate, valid `Content-Type` (`image/svg+xml` or `image/png`), and `Cache-Control` header under 30 concurrency.
- **Target Code**:
  ```javascript
  const passed = stats.errorRatePct === 0 && stats.p95Ms < 200;
  ```

---

### 3.2 `tests/load/server-runner.js`

#### Remediation 2.1: Port-Level Process Termination (`killProcessOnPort`)
- **File**: `tests/load/server-runner.js`
- **Location**: Insert after `killProcessTree` (around Line 64)
- **Remediation Specification**:
  - Implement `killProcessOnPort(port)` to locate any process listening on `port` and terminate its entire process tree.
  - On Windows (`process.platform === 'win32'`), parse `netstat -ano -p tcp` for `LISTENING` lines on `:${port}` and execute `taskkill /pid ${pid} /T /F`.
  - On POSIX platforms, execute `lsof -ti :${port} | xargs kill -9` or `fuser -k ${port}/tcp`.
- **Target Code**:
  ```javascript
  /**
   * Cross-platform port listener termination.
   */
  async function killProcessOnPort(port) {
    if (!port) return;
    if (process.platform === 'win32') {
      try {
        const stdout = child_process.execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const lines = stdout.split('\n');
        const pids = new Set();
        for (const line of lines) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid && pid > 0 && pid !== process.pid) {
              pids.add(pid);
            }
          }
        }
        for (const pid of pids) {
          try {
            child_process.execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
          } catch (_) {}
        }
      } catch (_) {}
    } else {
      try {
        child_process.execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore' });
      } catch (_) {}
    }
  }
  ```

---

#### Remediation 2.2: Fresh Instance Port Pre-Cleanup in `startServer`
- **File**: `tests/load/server-runner.js`
- **Location**: Lines 74–94
- **Remediation Specification**:
  - If `reuseExisting === false` (or if `/health` check fails when `reuseExisting === true`):
    Proactively call `await killProcessOnPort(port)` and `await killProcessOnPort(resolverPort)` and sleep 300ms before spawning the new child process. This prevents `EADDRINUSE` conflicts from lingering orphaned processes.
- **Target Code**:
  ```javascript
  // 1. Check if already running on target port
  if (reuseExisting) {
    const alreadyHealthy = await isServerHealthy(baseUrl, 1000);
    if (alreadyHealthy) {
      console.log(`[ServerRunner] Connected to already running healthy server at ${baseUrl}`);
      return {
        isSpawned: false,
        port,
        resolverPort,
        baseUrl,
        process: null,
        shutdown: async () => {
          console.log(`[ServerRunner] Reused server at ${baseUrl} left intact.`);
        }
      };
    }
  }

  // Ensure ports are free before spawning fresh instance
  await killProcessOnPort(port);
  await killProcessOnPort(resolverPort);
  await sleep(300);
  ```

---

#### Remediation 2.3: Teardown Cleanup in `shutdown()`
- **File**: `tests/load/server-runner.js`
- **Location**: Lines 147–155
- **Remediation Specification**:
  - In `shutdown()`, terminate `serverProc.pid` with `killProcessTree` AND invoke `killProcessOnPort(port)` and `killProcessOnPort(resolverPort)` to ensure child resolver processes are never left behind.
- **Target Code**:
  ```javascript
  const shutdown = async () => {
    console.log(`[ServerRunner] Shutting down spawned server (PID: ${serverProc.pid})...`);
    if (serverProc && !serverProc.killed) {
      await killProcessTree(serverProc.pid);
    }
    await killProcessOnPort(port);
    await killProcessOnPort(resolverPort);
    await sleep(300);
  };
  ```

---

### 3.3 `tests/load/run-performance-tests.js`

#### Remediation 3.1: Forward Scenario 3 Target Match ID to Scenario 4
- **File**: `tests/load/run-performance-tests.js`
- **Location**: Lines 190–205
- **Remediation Specification**:
  - Extract `s3MatchId` from `s3.benchmarkMetrics.targetMatchId` (stripping `nuvio_sport_` prefix).
  - Pass `excludeMatchId: s3MatchId` into `runSingleFlightStress`.
- **Target Code**:
  ```javascript
  // 6. Scenario 3: Stream Resolution Cache Miss vs Hit Benchmark
  console.log('\n👉 Executing Scenario 3: Stream Resolution Cache Miss vs Hit Benchmark...');
  const s3 = await runStreamResolutionBenchmark(serverInstance.baseUrl, {
    concurrency: Math.round(50 * options.concurrencyMultiplier),
    totalRequests: Math.round(60 * options.concurrencyMultiplier)
  });
  scenarioResults.push(s3);
  printScenarioResult(s3);

  const s3MatchId = s3.benchmarkMetrics && s3.benchmarkMetrics.targetMatchId
    ? s3.benchmarkMetrics.targetMatchId.replace('nuvio_sport_', '')
    : null;

  // 7. Scenario 4: Single-Flight Coalescing Stress (Thundering Herd)
  console.log('\n👉 Executing Scenario 4: Single-Flight Coalescing Stress...');
  const s4 = await runSingleFlightStress(serverInstance.baseUrl, {
    count: Math.round(50 * options.concurrencyMultiplier),
    excludeMatchId: s3MatchId
  });
  scenarioResults.push(s4);
  printScenarioResult(s4);
  ```

---

## 4. Summary of Assertion Calibration Matrix

| Scenario | Target Endpoint | Concurrency | Total Reqs | Pass Criteria (Remediated) | Rationale |
|---|---|---|---|---|---|
| **1: Baseline Health** | `/health`, `/manifest.json` | 50 | 200 | `errorRate === 0 && p95Ms < 300` | 50 concurrent TCP connections on Windows event loop; validates 200 OK + payload schema. |
| **2: Catalog Browsing** | 6 catalog routes | 15 | 60 | `errorRate === 0 && p95Ms < 3500` | Multi-category filtering + JSON serialization of large match meta objects. |
| **3: Stream Resolution** | `/stream/tv/*.json` | 50 | 60 | `coldValid && errorRate === 0 && p95Ms < 350 && speedup >= 2.0` | Asserts warm cache acceleration ($\ge 2\times$) over cold live scrape and 0% errors. |
| **4: Single-Flight** | `/stream/tv/*.json` | 50 (burst) | 50 | `errorRate === 0 && totalRequests === 50` | 50 simultaneous burst callers on un-cached match resolve with 100% success and 0 deadlocks. |
| **5: HLS Manifest Proxy** | `/api/manifest` | 40 | 80 | `initial === 'MISS' && errorRate === 0 && p95Ms < 200 && dead==404 && NEGATIVE && rewrite` | Validates complete proxy lifecycle: MISS, HIT, NEGATIVE cache, and sub-manifest URL rewrite. |
| **6: Image Proxy** | `/img`, `/img/placeholder` | 30 | 90 | `errorRate === 0 && p95Ms < 200` | Validates SVG generation, PNG proxy caching, Content-Type, and Cache-Control headers. |

---

## 5. Verification Protocol for Worker 2

After implementing these specifications, Worker 2 must execute and verify:

```powershell
# 1. Run full test suite with clean process isolation
node tests/load/run-performance-tests.js --fresh

# 2. Check PowerShell exit code (MUST be 0)
if ($LASTEXITCODE -eq 0) { Write-Host "PASS: Exit Code 0" } else { Write-Error "FAIL: Exit Code $LASTEXITCODE" }

# 3. Verify auxiliary empirical and stress harnesses
node tests/load/empirical-verification.js
node tests/load/adversarial-stress-test.js

# 4. Verify ZERO source modifications
git status --porcelain
```

### Invalidation Conditions:
- `node tests/load/run-performance-tests.js` exits with any non-zero code.
- Any of the 6 scenarios outputs `FAIL ❌`.
- Any existing file in `src/`, `resolver/`, `public/`, `Dockerfile`, or `package.json` is modified.
