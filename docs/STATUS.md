# STATUS: project handoff (update at the end of every task)

Last updated: 25 Oct 2026. Agent in use: **Antigravity only** (Codex retired; see `AGENTS.md`).

## Product
CandidTax: Customer-facing GST billing and compliance application inspired by Zoho Books. Features full sales invoicing with intra-state (CGST+SGST) vs inter-state (IGST) tax calculation, purchase bill tracking, customer and item catalogs, live taxpayer GSTIN verification, and official GST return breakdowns (GSTR-1, GSTR-2B, GSTR-3B). Stack: Node/Express/MongoDB (`Backend/`), React/Vite (`Frontend/`). Provider: TaxPro GSP / Mock Finagg.

## Done
Backend
- Foundation: config loader, safe logger (masks credentials and sensitive data), central error handling, AES-256-GCM encryption for stored returns and tokens.
- MongoDB models with TTL indexes: Session, OtpState, Return, Consent, AuditLog, ContactMessage, Workspace, WorkspaceMember.
- **Enterprise Billing & Compliance Foundation**:
  - Models: `Customer.js`, `Item.js`, `Invoice.js`, `Bill.js` with workspace scoping, compound indexes, and validation.
  - Tax Calculation Utility (`Backend/src/utils/taxCalculator.js`): Line-item and total computation with automated intra-state (50/50 CGST+SGST) vs inter-state (100% IGST) based on seller GSTIN vs Place of Supply.
  - Controllers & Routes: Full CRUD and search for `/api/customers`, `/api/items`, `/api/invoices`, and `/api/bills`.
  - Enhanced Dashboard Controller: Computes real MongoDB sales totals, purchase expenses, receivables, and payables alongside GST return metrics.
  - Test Suite (`Backend/scripts/test-billing.js`): Unit and integration tests for tax calculations, schema validations, and workspace tenancy isolation. Integrated into `npm run test:all` (7/7 suites passing).
- Joi validation; MongoDB-backed shared rate limiting; cookie-based JWT session (HttpOnly, SameSite=Lax); lockout after 3 wrong OTPs.
- Mock mode & TaxPro adapter with safe error handling (`GSP053`, `AUTH4037`, `RET2B1023`, `GSP032`), timeout diagnostics, and zero credential leakage.
- **TaxPro GSP Signing Key Diagnostic Hardening**: Granular safe diagnostic errors for missing `TAXPRO_ASPID`, `TAXPRO_PASSWORD`, and `TAXPRO_ASP_PRIVATE_KEY_PATH`, unreadable key paths, malformed PEMs, non-RSA keys, and encrypted passphrase verification without leaking secrets or credentials.
- **TaxPro GST Taxpayer Authentication Implementation**: Full GET-based implementation for `OTPREQUEST`, `AUTHTOKEN`, `REFRESHTOKEN`, and `EVCOTP` on `/taxpayerapi/dec/v1.0/authenticate`. Strict architectural separation between taxpayer auth and GSP GetKey session signing; zero credential/token leakage; Joi & provider validation; safe error mapping for expired tokens (`AUTH4038`, `GSP052A` -> 401 `SESSION_EXPIRED`); session update support in `SessionService`; and 100% offline regression coverage.
- **GSTR-1 Payload Builder & Dry-Run Save API**: Created `Gstr1Service` that auto-groups workspace sales invoices into official GSTN GSTR-1 schema (Table 4A B2B, Table 7 B2CS, Table 12 HSN, Table 13 DOCISS) with summary calculations. Added `GET /api/returns/gstr1/prepare` and `POST /api/returns/gstr1/save` with strict dry-run protection when `FEATURE_FILING !== 'true'`. Verified with `test-gstr1-builder.js`.
- Unified backend test runner (`Backend/scripts/run-all-tests.js`, `npm run test:all`): 8/8 suites pass 100%.

Frontend (CandidTax — Zoho Books Style Application)
- Professional enterprise layout (`Layout.jsx`, `.zoho-*` design system in `index.css`) with collapsible & sticky left sidebar (`position: sticky; top: 0; height: 100vh`) and sticky top header with quick action `+ New` menu and active GSTIN context.
- **Main Navigation & Business Modules**:
  - **Dashboard** (`/dashboard`): Real sales invoice totals, purchase bills, eligible ITC, net tax payable, and recent transactions.
  - **Taxpayer Search** (`/taxpayer-search`): Live GSTIN verification via `/api/gstin/search`.
  - **Customers** (`/customers`): Searchable table, filter by GST type, and Add/Edit Customer modal with GST details and billing address.
  - **Items & Services** (`/items`): Products and services table with HSN/SAC, pricing, unit, and GST rates.
  - **Sales Invoices** (`/sales/invoices`): Interactive invoice builder with customer selection, line items, real-time CGST/SGST vs IGST calculations, MongoDB persistence, status management, and printable invoice drawer.
  - **Sales Credit Notes** (`/sales/credit-notes`): Business credit notes overview.
  - **Purchases & Bills** (`/purchases/bills`): Purchase bill tracker with expense categorization and ITC reconciliation.
  - **Direct Expenses** (`/purchases/expenses`): Operational expense tracking.
  - **GST Returns**: Clean business views for GSTR-1, GSTR-2B, GSTR-3B (`/returns/:type`), Unified Return Summary (`/returns/summary`), and Filing History (`/returns/filing-history`).
  - **Excel Import** (`/excel-import`): Spreadsheet drag-and-drop import dropzone.
  - **Reports** (`/reports`): Financial and GST reconciliation reports.
  - **Settings** (`/settings`): Business profile and invoice preferences.
- Zero secret exposure: No developer debug tools or raw JSON viewers in primary user navigation.
- Passes ESLint (`npm run lint`: 0 errors, 0 warnings) and Vite build (`npm run build`).

## Decisions
- Customer-facing business workflows inspired by Zoho Books replace raw developer API testing tools.
- Strict workspace isolation: every customer, item, invoice, and bill belongs to an active `workspaceId`.
- Intra-state vs Inter-state supply determined dynamically by comparing the supplier GSTIN state code against the recipient Place of Supply (POS).
- Filing and write APIs to TaxPro remain disabled and dry-run per safety rules.

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
