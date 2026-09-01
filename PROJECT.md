# Project: Nuvio Live Sports Plugin — Performance & Load Testing Suite

## 1. Architecture Overview
The Nuvio Live Sports Plugin is an Express-based Stremio/Nuvio sports aggregation and streaming proxy service featuring a multi-tiered in-memory caching architecture:
1. **Catalog Cache (`CacheService`)**: In-memory match entities with Stale-While-Revalidate (SWR) revalidation.
2. **Stream Resolution Cache (`StreamResolveCache`)**: In-memory cache for resolved stream tokens featuring single-flight promise coalescing, adaptive TTL scaling (60s to 10m), negative caching (30s), LRU capacity capping (200 entries), and lifecycle pruning.
3. **Manifest Proxy Cache (`manifestCache`)**: In-memory cache for live HLS M3U8 playlists (3s positive TTL, 15s negative TTL, single-flight coalescing).
4. **Artwork & Image Cache (`ImageService`)**: Image buffer caching (10m TTL, 1.5MB max size) with SVG fallback generator.
5. **Observability Hook (`GET /health`)**: Direct real-time telemetry exposing `hits`, `misses`, `negativeHits`, `evictions`, `inFlight`, and `learnedTtls`.

## 2. Feature & Test Inventory
Every testing requirement must be assigned to a milestone and rigorously verified.

| # | Feature / Test Requirement | Description | Milestone | Source | Status |
|---|-----------------------------|-------------|-----------|--------|--------|
| 1 | Programmatic Server Lifecycle | Automatically start server (or connect if already running on port), wait for `/health` readiness, and cleanly terminate sub-processes after tests. | M1 | ORIGINAL_REQUEST §4 | DONE |
| 2 | High-Concurrency Load Engine | Asynchronous load generator capable of firing parameterized concurrent requests across endpoints without external dependencies. | M1 | ORIGINAL_REQUEST §1, §4 | DONE |
| 3 | Healthcheck & Baseline Concurrency | High-throughput baseline testing on `/health` and `/manifest.json`. | M2 | Survey §8.2 | DONE |
| 4 | Catalog Concurrency & SWR Behavior | Concurrent requests to `/catalog/tv/*.json` measuring throughput, latency, and verifying non-blocking SWR background sync. | M2 | Survey §8.2 | DONE |
| 5 | Stream Resolution Cold vs. Warm Latency | Measure first-call cache miss latency vs repeated concurrent cache hit latency on `/stream/tv/*.json` (asserting P95 < 30ms on hit). | M2 | ORIGINAL_REQUEST §1, §2 | DONE |
| 6 | Single-Flight Thundering Herd Test | Fire 50–100 simultaneous requests for an un-cached stream key; assert that exactly 1 upstream scrape/mint is executed and all requests resolve successfully. | M2 | Survey §6.2, §8.2 | DONE |
| 7 | Manifest Proxy Load & Header Verification | Simulate concurrent HLS player polling loops on `/api/manifest` measuring throughput and verifying `X-Manifest-Cache: HIT` vs `MISS`. | M2 | ORIGINAL_REQUEST §1, §2 | DONE |
| 8 | Image Service Cache & SVG Generation Load | Test `/img` and `/img/placeholder` under concurrent requests verifying image caching and fallback behavior. | M2 | Survey §2 | DONE |
| 9 | Comprehensive Metrics & Reporting | Compute and format checkable metrics: Total Requests, Success/Error Rate (%), Throughput (req/s), P50/P90/P95/P99/Max Latency (ms), Server & Client Cache Hit/Miss Ratios. | M2 | ORIGINAL_REQUEST §2 | DONE |
| 10 | Zero Source Modification & Execution Verification | Strict verification that 0 existing application/source files are modified and tests run completely self-contained. | M3 | ORIGINAL_REQUEST §3, §5 | DONE |

## 3. Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Server Lifecycle & Load Test Harness | Standalone load generator, port manager, server process manager, and HTTP client harness in `tests/`. | none | DONE |
| M2 | Performance Scenarios & Metrics Collector | Complete test scenarios (Baseline, Catalog, Stream Resolution Hit/Miss, Single-Flight, Manifest Proxy, Image Proxy) and metrics reporting. | M1 | DONE |
| M3 | Execution, Multi-Agent Verification & Forensic Audit | Run load tests, collect verification results from Reviewers, Challengers, and Forensic Auditor (Zero code modification check). | M2 | DONE |

## 4. Code Layout & File Boundaries
**CRITICAL RESTRICTION**: Existing files in `src/`, `resolver/`, `public/`, `Dockerfile`, `package.json` were strictly untouched.

Created Test Suite in `tests/load/`:
- `tests/load/load-test-harness.js` — Standalone HTTP load generation engine with `undici` connection pooling, concurrency queue, microsecond timers, and percentile statistics calculator.
- `tests/load/server-runner.js` — Programmatic server starter, port manager, health poller, cross-platform port-level process termination (`killProcessOnPort`), and ephemeral mock upstream server.
- `tests/load/scenarios.js` — 6 modular load test scenarios exercising all endpoints and caching layers.
- `tests/load/run-performance-tests.js` — Main CLI runner that executes the entire performance and load test pipeline and outputs tabular metrics.
- `tests/load/empirical-verification.js` — Dedicated empirical validation of cache hit speedups, single-flight thundering-herd deduplication, manifest cache headers, and `/health` telemetry deltas.
- `tests/load/adversarial-stress-test.js` — Dedicated stress validation of LRU capacity bounds (200 cap, 50 evictions), 100-caller promise coalescing, and negative cache TTL recovery.
