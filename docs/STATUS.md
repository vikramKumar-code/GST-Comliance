# STATUS: project handoff (update at the end of every task)

Last updated: 24 Oct 2026. Agent in use: **Antigravity only** (Codex retired; see `AGENTS.md`).

## Product
CandidTax: web app where a taxpayer verifies with a GST OTP and views GSTR-1, GSTR-2B and GSTR-3B data. Filing is a later phase. Stack: Node/Express/MongoDB (`Backend/`), React/Vite (`Frontend/`). Provider: TaxPro GSP. The client's users are the client's customers, each with their own GSTIN, consent and OTP.

## Done
Backend
- Foundation: config loader, safe logger (masks credentials and sensitive data), central error handling, AES-256-GCM encryption for stored returns and tokens.
- MongoDB models with TTL indexes: Session, OtpState, Return, Consent, AuditLog, ContactMessage.
- Joi validation (GSTIN, period); MongoDB-backed shared rate limiting (API, OTP, contact form); cookie-based JWT session (HttpOnly, SameSite=Lax); lockout after 3 wrong OTPs.
- Mock mode: offline engine with GSTIN search, test OTP 123456, GSTR-1/2B/3B data, 404/503 simulations.
- TaxPro adapter (`taxpro.js`): GetKey session (RSA-SHA256 signature, AES-ECB unwrap per TaxPro's published protocol, in-memory session cache), header-based auth, leak-guard tests, error mapping (AUTH, RATE_LIMIT, SESSION_EXPIRED, DATA_NOT_AVAILABLE), sanitized sample collector `capture-taxpro-samples.js`. Production accepts only the production host, rejects the sandbox host, and validates credentials, RSA key, allow-listed IP and security settings.
- SaaS tenancy foundation: one verified GSTIN = one Workspace (`SAAS_TENANCY.md`); Workspace and WorkspaceMember (OWNER, MEMBER); workspace-scoped return caching.
- Task 17: production secret and transport guards (`Backend/src/config/env.js`, `Backend/scripts/test-config.js`). Explicit `NODE_ENV` required (fails if unset or unrecognized; dev fallbacks strictly restricted to development/test); production refuses unset/short/<32/placeholder/dev-default/identical secrets, repeated-char/all-zero data keys, and refuses live TaxPro startup unless `TAXPRO_DEC_PRODUCTION_APPROVED=true`.
- Task 25: unified backend test runner (`Backend/scripts/run-all-tests.js`, `npm run test:all`) executing all 6 test suites (`test-config`, `test-middleware`, `test-taxpro`, `test-tenancy`, `test-rate-limit-store`, `test:e2e`) in order, stopping on first failure, with clear PASS/FAIL reporting.
- Tests: `test-middleware.js`, `test-taxpro.js`, `test-config.js` (including full production secret and transport guard suite), `test-tenancy.js`, `test-rate-limit-store.js`, and the isolated E2E runner `npm run test:e2e` (own test database, cleaned afterwards). All unified via `npm run test:all`.

Frontend (CandidTax UI)
- Landing (branding, features, contact form), Login (GSTIN, live validation, taxpayer details), OTP (mandatory consent, 6-digit OTP, resend timer), Dashboard (filing summary cards, recent period status, return cards), Return detail (GSTR-1/2B/3B tables, summary, calm EmptyState for DATA_NOT_AVAILABLE), Privacy and Terms pages.
- AuthContext and ProtectedRoute; saved data shown with a "stale" badge when the provider is down. UI freeze respected.
- Task 26: Baseline screenshots (21 images across 3 viewports: 1280px, 768px, 360px) in `docs/ui-baseline/`; comprehensive UI to API map in `docs/UI_API_MAP.md`; `getReturnsSummary` query param contract mismatch resolved in `returns.api.js`; ESLint and Vite production build passed; UI freeze strictly respected.

## Decisions
- UI is frozen (`AGENTS.md` section 2).
- Customers log in themselves with their own OTP (flow A). Staff-driven access is not built.
- Filing and refund are out of scope. Write APIs stay disabled and dry-run.
- The `/dec/` routes are not approved for production by TaxPro. Encrypted transport is not implemented in the codebase (/dec/ is hardcoded in the adapter). Production startup strictly refuses unless `TAXPRO_DEC_PRODUCTION_APPROVED=true` is explicitly set by the human operator after written approval. Never set this flag in any repository file or script.

## Blockers (external, need the human)
1. Local `Backend/.env` lacks the TaxPro sandbox settings (human fills; never share values).
2. No successful sandbox response samples yet for GSTR-1, 2B, 3B; return mappers cannot be finished without them.
3. TaxPro approval for `/dec/` in production, or details of the encrypted end-to-end API; known-answer test values for GetKey.
4. Static IP allow-listing and server deployment.
5. Sandbox access error AUTH4037 on some pairs.

## Next tasks (in order)
1. Human: baseline check (tests, UI screenshots, secret scan) and tag `codex-handoff`.
2. `[AUDIT]` report-only review of current state.
3. `[BACKEND]` API registry and all read-only TaxPro APIs (mock-first, mappers only where a sample exists).
4. `[BACKEND]` disabled, dry-run scaffold for write APIs.
5. `[UI]` show the new read-only data inside the existing UI.
6. Staging deploy with static IP; privacy, terms and consent text reviewed by a CA or lawyer.
7. When TaxPro answers: transport decision, real samples, mappers.

## Needs human decision
(none)

## Commands
- Backend (human runs): `npm run test:all` (runs all 6 test suites), or individually: `npm run test:e2e`, `node scripts/test-middleware.js`, `node scripts/test-taxpro.js`, `node scripts/test-config.js`, `node scripts/test-rate-limit-store.js`.
- Frontend: `npm run lint`, `npm run build`.
- Secret scan before merge (PowerShell, from the repo root):
  `git ls-files | Select-String -Pattern "BEGIN (RSA )?PRIVATE KEY" -List`
  `git grep -nIE "aspid|password|api[_-]?key|secret" -- . ":!*.md" ":!*lock.json"` (read each hit; names are fine, values are not)
- Never run a command that reads `.env`.
