# Original User Request

## Initial Request — 2026-09-01T03:36:19+05:30

Build performance and load tests for the Nuvio Live Sports Plugin caching service to measure cache hit/miss behavior and verify the pipeline's stability under load.
Output clear, checkable metrics (e.g., cache hit ratio, miss ratio, P95 latency, throughput, error rates).
CRITICAL CONSTRAINT: Just test. DO NOT make changes to any existing application files or source code. Only create the new test files/scripts in the workspace.
Provide a programmatic test script that starts the server (or connects to it if running) and exercises the endpoints under concurrent load.
Ensure tests execute successfully in the working directory without manual intervention during the run.
