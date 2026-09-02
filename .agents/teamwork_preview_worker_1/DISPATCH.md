## 2026-09-01T03:40:19Z
You are Worker 1 for the Nuvio Live Sports Plugin performance & load testing project.
Your working directory is: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_worker_1
The project workspace is: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin
Authoritative specifications to read:
1. ORIGINAL_REQUEST.md: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\ORIGINAL_REQUEST.md
2. PROJECT.md: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\PROJECT.md
3. Explorer 1 Survey: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_explorer_survey_1\survey_report.md
4. Explorer 2 Caching Survey: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_explorer_survey_2\caching_survey.md
5. Explorer 3 Endpoints Survey: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_explorer_survey_3\endpoints_survey.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

CRITICAL FILE OWNERSHIP CONSTRAINTS:
- You exclusively own and may create files inside: `tests/load/` (e.g., `tests/load/load-test-harness.js`, `tests/load/server-runner.js`, `tests/load/scenarios.js`, `tests/load/run-performance-tests.js`).
- DO NOT MODIFY OR DELETE any existing application files or source code (`src/*`, `resolver/*`, `public/*`, `package.json`, `Dockerfile`, etc.).

TASKS TO IMPLEMENT:
1. `tests/load/server-runner.js`:
   - Checks if a server is already running on a specified port (e.g. 7000 or a dedicated test port like 7010).
   - If not running, programmatically spawns `node src/index.js` with isolated test environment variables (`PORT=7010`, `RESOLVER_PORT=7013`, `HOST=127.0.0.1`).
   - Polls `GET http://127.0.0.1:${PORT}/health` until `200 OK` (readiness).
   - Provides a clean shutdown function that sends `SIGTERM`/`SIGINT` and ensures child processes (including resolver) terminate.
2. `tests/load/load-test-harness.js`:
   - High-performance asynchronous HTTP client engine using Node built-in `http`/`undici`.
   - Concurrency controller (executes $N$ workers running $M$ requests or time-based load).
   - Latency recorder and statistical calculator: computes Min, Mean, Median (P50), P90, P95, P99, Max latency, Throughput (req/sec), Status Code distribution, and Error Rates.
3. `tests/load/scenarios.js`:
   - Scenario 1: Baseline Health & Telemetry (`GET /health`, `GET /manifest.json`) under high concurrency (e.g. 50-100 concurrent requests).
   - Scenario 2: Catalog Browsing & SWR (`GET /catalog/tv/nuvio_sports_live.json`, category filters) under concurrent load.
   - Scenario 3: Stream Resolution Cache Miss vs Hit Benchmark (`GET /stream/tv/nuvio_sport_<id>.json`):
     * Measures cold miss latency.
     * Fires 50+ concurrent requests on the same stream to measure warm hit latency (asserting P95 < 30ms) and hit ratio.
   - Scenario 4: Single-Flight Coalescing Stress (50 concurrent requests simultaneously hitting an un-cached fixture; asserts that internal scraper runs exactly once and all 50 succeed).
   - Scenario 5: HLS Manifest Proxy Polling (`GET /api/manifest?url=...` with simulated player loop; verifies `X-Manifest-Cache: HIT` vs `MISS` headers and throughput).
   - Scenario 6: Image Proxy & SVG Placeholder Cache (`GET /img`, `GET /img/placeholder`).
4. `tests/load/run-performance-tests.js`:
   - Standalone CLI runner that boots the server runner, executes all scenarios sequentially/parametrically, fetches final telemetry from `/health`, prints formatted summary tables of all metrics (Cache Hit Ratio, Miss Ratio, P50/P95/P99 latencies, Throughput, Error Rate), and shuts down the server.
5. EXECUTE AND VERIFY:
   - Run `node tests/load/run-performance-tests.js` to verify end-to-end execution without manual intervention.
   - Verify that all tests pass, metrics are generated accurately, and the process exits cleanly with code 0.
6. Write your comprehensive completion report in `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_worker_1\handoff.md` and send a message back when done.
