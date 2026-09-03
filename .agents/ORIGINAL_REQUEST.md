# Original User Request

## Initial Request — 2026-09-01T03:36:19+05:30

Build performance and load tests for the Nuvio Live Sports Plugin caching service to measure cache hit/miss behavior and verify the pipeline's stability under load.
Output clear, checkable metrics (e.g., cache hit ratio, miss ratio, P95 latency, throughput, error rates).
CRITICAL CONSTRAINT: Just test. DO NOT make changes to any existing application files or source code. Only create the new test files/scripts in the workspace.
Provide a programmatic test script that starts the server (or connects to it if running) and exercises the endpoints under concurrent load.
Ensure tests execute successfully in the working directory without manual intervention during the run.

## Follow-up — 2026-09-02T20:06:56Z

Fix hardcoded local IP addresses (e.g., 192.168.0.xx) in the catalog/manifest and repair missing thumbnails across the Stremio addon so it works flawlessly on public domains (like ngrok).

Working directory: c:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin
Integrity mode: development

## Requirements

### R1. Dynamic Host Routing
Identify all hardcoded instances of local IPs (e.g., `192.168.0.xx`) in the codebase (manifest, catalog generation, stream resolution) and replace them with dynamic host resolution. The addon should generate URLs based on the incoming request's `Host` header (e.g., `req.get('host')`) so it works seamlessly whether hosted on localhost, ngrok, or a VPS.

### R2. Thumbnail Repair
Investigate and fix missing thumbnails in the catalog view. Ensure image URLs are valid, accessible, and not breaking due to missing base URLs, dead links, or strict upstream CORS policies. If necessary, route images through a local proxy endpoint.

### R3. End-to-End Sanity Test (Simulated Client)
The team must write a programmatic script that simulates a full Stremio client workflow:
1. Fetch the manifest from the dynamic host.
2. Fetch the catalog (e.g. `nuvio_sports_live`).
3. Extract a match and fetch its stream array.
4. Verify the final M3U8 URL resolves correctly without errors.

## Acceptance Criteria

### Verification
- [ ] A test script or curl command confirms that the generated manifest and catalog JSON payloads use the dynamic `Host` header instead of a hardcoded `192.168.0.xx` IP.
- [ ] A test script verifies that thumbnail URLs returned in the catalog JSON are valid, return 200 OK, and have proper CORS headers if proxied locally.
- [ ] The codebase contains zero hardcoded `192.168.0.xx` strings.
- [ ] The end-to-end simulation script runs end-to-end successfully without any 404s, 500s, or hardcoded IPs breaking the flow.

