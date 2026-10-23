# AGENTS.md: rules for the AI agent (Antigravity, single-agent edition)

Codex is no longer used. Antigravity is the only coding agent. Because nobody else reviews its work, the safety rules below are stricter than before. The human reviews every change.

Read in this order before any task: `AGENTS.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TAXPRO_ADDENDUM.md`, `docs/TAXPRO_API_LIST.md`, and `SAAS_TENANCY.md` if the task touches workspaces. If files disagree, `STATUS.md` decisions win, then `TAXPRO_ADDENDUM.md`, then `ARCHITECTURE.md`. If something is unclear, ask the human; never pick silently.

Folder names on disk: `Backend/` and `Frontend/`. Product name in the UI: CandidTax.

## 1. One task at a time

- Work on exactly one task per conversation. Start a **new conversation for every task**, so old context does not leak into new work.
- Tag each task `[UI]`, `[BACKEND]` or `[AUDIT]`.
- `[UI]` tasks edit only `Frontend/`. `[BACKEND]` tasks edit only `Backend/`. If a task needs both, do the backend part first, stop, and wait for the human to start the frontend part.
- `[AUDIT]` tasks are report-only: change nothing.
- Plan first: before writing code, write a short plan (files to change, tests to add, risks) and wait for the human to approve it.

## 2. UI freeze (the UI must stay exactly as it is today)

- Do NOT change layout, colours, fonts, spacing, copy, icons, images or the markup of existing components and pages.
- Do NOT add or upgrade CSS frameworks, UI libraries or fonts. Do not touch global CSS (`index.css`, `landing.css`) except to add new classes with a new prefix that do not alter existing ones.
- New UI uses only existing components and CSS classes, in the same visual style.
- Before any `[UI]` task save baseline screenshots (landing, login, otp, dashboard, a return page) at 1280px, 768px and 360px in `docs/ui-baseline/`. After the task, take them again and list every visible difference. Undo any difference that was not requested.
- Backend work must not change the response shapes the frontend uses (`docs/ARCHITECTURE.md` sections 6 and 7) without updating those docs first.

## 3. Secrets and data

- Never read, print, log or commit `.env` files, RSA/private keys, TaxPro `aspid`/`password`, tokens, OTPs, cookies or real GST data. Never run a command that prints them (for example `cat .env`, `type .env`, `Get-Content .env`, `printenv`).
- Secrets live only in the host's secret store or a local `.env`. `.env`, keys, `cookies.txt`, `raw*.json` and the sample collector's raw output stay in `.gitignore`.
- Samples in `doc/` must be sanitized and checked by the human before commit. Never store real GSTINs, names or amounts.
- Never log URLs, query params, request config, headers with credentials, or whole error objects.

## 4. Security-sensitive areas (extra care)

Auth and session, cookies, rate limiting, encryption (AES-GCM), the TaxPro transport and GetKey session code, logging, workspace/tenancy rules, consent. For any change here:
- Explain the change and its risk in the plan and wait for approval.
- Add or extend tests, and never weaken or delete a test to make it pass.
- Do not change cryptographic algorithms, modes or key handling, except exactly as TaxPro's published protocol requires. AES-ECB exists only for TaxPro's session-key unwrap; never use ECB anywhere else.
- Keep tenant isolation: one verified GSTIN is one workspace; a user must never read another workspace's data.

## 5. Provider rules (TaxPro)

- Never guess endpoints, methods, bodies or response fields. Use `TAXPRO_API_LIST.md` and real samples. Unknown = `// [CONFIRM] from TaxPro docs` plus a TODO.
- Production accepts only the production host and rejects the sandbox host. Do not weaken this guard.
- The `/dec/` endpoints in production are **not approved** by TaxPro. Encrypted transport is not implemented in the codebase; the adapter currently hardcodes the decrypted `/dec/` transport. Therefore, production startup strictly refuses unless the human operator explicitly sets `TAXPRO_DEC_PRODUCTION_APPROVED=true` in the environment after written provider approval. Never set this flag in any repository file or script.
- Write APIs (save, submit, file, offset, EVCOTP, gstrptf, SAVEPREF, DOCUPLD) are always disabled and dry-run. Never set `FEATURE_FILING` or `FILING_PROD_APPROVED` in any env file or script. No refund calls.

## 6. Process for every task

1. Create a branch `agent/antigravity/<short-task-name>`. Small commits. Never merge to `main`.
2. Tests: write or update tests with the code. The agent's sandbox may block sockets; if a test fails with EACCES or EPERM, report it and stop. **The human runs the final tests** in their own terminal.
   - Backend: `npm run test:e2e`, `node scripts/test-middleware.js`, `node scripts/test-taxpro.js`, `node scripts/test-config.js`.
   - Frontend: `npm run lint` and `npm run build`.
3. Never weaken a check. If a test seems wrong, say so and explain.
4. Update `README.md` (Progress, Known gaps) and `docs/STATUS.md`.
5. Final report: files changed, what was fixed (one line each), test output, what you could not verify, and what the human must check.
6. Stop and wait for the human.

## 7. Review without a second agent

Since no other agent reviews the work:
- The human reads the full diff (`git diff main...HEAD`), always including every file in a security-sensitive area.
- For `[BACKEND]` tasks the human may start a **fresh `[AUDIT]` conversation** (ideally with a different model if available) that reads the diff and reports only: secrets, logging, security rules above, UI freeze, contract changes, tenant isolation. It edits nothing.
- The human runs a secret scan before every merge (see `docs/STATUS.md` commands).
