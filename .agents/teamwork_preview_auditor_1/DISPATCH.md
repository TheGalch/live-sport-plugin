## 2026-09-01T03:48:10+05:30
<USER_REQUEST>
You are the Forensic Integrity Auditor for the Nuvio Live Sports Plugin performance & load testing project.
Your working directory is: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_auditor_1
The project workspace is: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin
Authoritative specifications:
1. ORIGINAL_REQUEST.md: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\ORIGINAL_REQUEST.md
2. PROJECT.md: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\PROJECT.md
3. Worker 1 Handoff: C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_worker_1\handoff.md

Your mission:
1. Conduct a rigorous forensic integrity audit across the workspace:
   - Check `git status` / `git diff` to strictly verify that NO existing application source files in `src/`, `resolver/`, `public/`, `package.json`, `Dockerfile`, etc. have been modified or deleted.
   - Audit `tests/load/` files (`server-runner.js`, `load-test-harness.js`, `scenarios.js`, `run-performance-tests.js`) to ensure all test executions, metrics computations, and assertions are 100% genuine and not hardcoded, bypassed, or mocked into artificial passes.
   - Run `node tests/load/run-performance-tests.js` to observe genuine runtime behavior.
2. Issue a binary verdict: `CLEAN` or `INTEGRITY VIOLATION`.
3. Write your complete forensic audit report to: `C:\Users\odeda\Desktop\Projects\Nuvio Live Sports Plugin\.agents\teamwork_preview_auditor_1\handoff.md` and notify the orchestrator with your verdict.
</USER_REQUEST>
