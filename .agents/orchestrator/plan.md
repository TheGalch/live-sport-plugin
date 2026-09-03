# Implementation Plan - Caching Removal & Backup

## Objectives
1. **R1**: Create branch `with-cache` from current state and push to remote origin.
2. **R2**: On `main` branch, completely strip out all caching logic, caching stores, cache decorators/middlewares, and cache dependencies across the plugin so that every match/stream query goes directly to upstream.
3. **Verification**: Write and run programmatic tests that send consecutive stream/match requests and assert that the upstream endpoint is contacted every single time.
4. **Verification & Audit**: Review, Challenger verification, and Forensic Audit verification for clean non-cached architecture.

## Milestones
- **M0: Survey & Codebase Analysis**: Explorers inspect repository git state, remote config, caching implementation details, stream fetching paths, and existing test setups.
- **M1: Branch Backup (R1)**: Create `with-cache` branch containing current state with cache, push to origin.
- **M2: Caching Removal (R2)**: Switch to `main`, remove all caching mechanisms, cache storage/files, invalidation/TTL logic, and any cache imports/config.
- **M3: Test Script Implementation & Execution**: Write and execute programmatic verification test making multiple stream requests and proving upstream hits each time.
- **M4: Review, Challenge & Forensic Audit**: Independent review, adversarial challenge, and forensic integrity audit.
