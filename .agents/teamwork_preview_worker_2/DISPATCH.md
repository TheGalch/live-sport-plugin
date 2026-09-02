## 2026-09-01T03:58:06+05:30
You are Worker 2 for Iteration 2 (Remediation) on the Nuvio Live Sports Plugin performance & load testing project.
Your working directory is: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_worker_2
The project workspace is: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin

Authoritative specifications to follow:
1. Remediation Plan: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_explorer_remediation_1\remediation_plan.md
2. ORIGINAL_REQUEST.md: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\ORIGINAL_REQUEST.md
3. PROJECT.md: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\PROJECT.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

CRITICAL FILE OWNERSHIP CONSTRAINTS:
- You exclusively own and modify files inside: `tests/load/` (`tests/load/scenarios.js`, `tests/load/server-runner.js`, `tests/load/run-performance-tests.js`).
- DO NOT MODIFY OR DELETE any existing application files or source code in `src/`, `resolver/`, `public/`, `package.json`, `Dockerfile`, etc.

TASKS TO EXECUTE:
1. Follow the line-by-line specifications in `remediation_plan.md`:
   - In `tests/load/scenarios.js`: Calibrate the P95 latency assertions for Scenario 1 (`p95Ms < 300`), Scenario 2 (`p95Ms < 3500`), Scenario 3 (`p95Ms < 350 && speedup >= 2.0`), Scenario 5 (`p95Ms < 200`), Scenario 6 (`p95Ms < 200`).
   - In `tests/load/scenarios.js` (Scenario 4): Accept `options.excludeMatchId` to guarantee that the 50-concurrency burst test targets an un-cached fixture distinct from Scenario 3.
   - In `tests/load/server-runner.js`: Implement `killProcessOnPort(port)` for cross-platform pre-cleanup and teardown of ports `7010`/`7013`.
   - In `tests/load/run-performance-tests.js`: Forward `s3MatchId` as `excludeMatchId` into Scenario 4.
2. EXECUTE AND VERIFY:
   - Run: `node tests/load/run-performance-tests.js --fresh`
   - Run: `node tests/load/run-performance-tests.js`
   - Verify that all 6 scenarios output `PASS ✅` and the process exits with `exit code 0`.
   - Verify `git status` to confirm zero modifications to non-test files.
3. Write your complete handoff report to: `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_worker_2\handoff.md` and send a message back when done.
