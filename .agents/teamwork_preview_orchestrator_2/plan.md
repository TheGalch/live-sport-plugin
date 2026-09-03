# Orchestration Plan: Dynamic Host, Thumbnail Repair, & E2E Sanity Testing

## Objective
Implement dynamic host routing across all endpoints, repair catalog thumbnail loading and resolution, and create a comprehensive automated end-to-end simulated Stremio client test suite.

## Phase 0: Survey & Discovery
1. Spawn 3 `teamwork_preview_explorer` subagents:
   - **Explorer 1**: Survey R1 (Dynamic Host Routing) - locate all hardcoded IP instances (`192.168.0.xx`, local IP bindings, host headers, manifest/catalog/stream generation, baseUrl logic).
   - **Explorer 2**: Survey R2 (Thumbnail Repair) - inspect catalog generation, poster/logo/thumbnail URL sources, static asset handling, missing protocol/base URLs, CORS, or proxy requirements.
   - **Explorer 3**: Survey R3 (E2E Sanity Testing Architecture) - inspect existing tests, server startup scripts, endpoints (`/manifest.json`, `/catalog/...`, `/stream/...`), stream resolution pipeline, and test harness design.
2. Merge survey reports into `PROJECT.md` with Feature Inventory, Architecture, and Milestone definitions.

## Phase 1: Implementation & Milestones
- **Milestone 1**: Dynamic Host Routing Implementation.
- **Milestone 2**: Thumbnail Repair & Proxy Implementation.
- **Milestone 3**: E2E Simulated Stremio Client Test Suite Implementation.

## Phase 2: Verification, Review, Challenge & Audit
- Worker implementation and verification.
- Reviewer checks (code quality, completeness, adherence to specifications).
- Challenger stress-testing (dynamic hosts, localhost, remote IPs, reverse proxy headers, missing thumbnail fallback, full simulated stream fetch).
- Forensic Integrity Audit (`teamwork_preview_auditor`).
- Gate check and final delivery.
