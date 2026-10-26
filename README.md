# GST Compliance Platform

A secure taxpayer portal to verify identity via GSTN OTP and inspect GSTR-1 (sales), GSTR-2B (purchases & ITC), and GSTR-3B (tax liabilities & net payable) compliance data. Built with Node.js, Express, MongoDB, and React (Vite).

---

## 1. Progress Status

| Component | Task | Description | Status |
|-----------|------|-------------|--------|
| **Backend** | Production hardening | Fail-fast production config, strict CORS, database-first startup, HTTPS TaxPro URL, bounded JSON/urlencoded bodies with a clear 413 response, MongoDB-shared API/OTP limits, and TaxPro-specific sensitive-log redaction | In progress |
| **Backend** | Contact intake | Validated/rate-limited messages stored in MongoDB for 180 days | Implemented; delivery workflow pending |
| **Setup** | S0 - Folder setup | S0 - Folder setup: Done | Done |
| **Backend** | Task 1: Foundation & Utils | Config loader, MongoDB connection, AES-256-GCM crypto, redacted logger, ApiError, GSTIN/period validation | ✅ Complete |
| **Backend** | Task 2: MongoDB Models | Mongoose models with TTL indexes (`Session`, `OtpState`, `GstinCache`, `Return`, `Consent`, `AuditLog`, `User`) | ✅ Complete |
| **Backend** | Task 3: Validation & Middleware | Joi validation schemas, MongoDB-shared rate limiting, cookie-based JWT session auth, centralized error handler | ✅ Complete |
| **Backend** | Task 4: FinAGG Service & Mock Engine | In-memory `FinaggMock` provider and `FinaggService` gateway with confirmation annotations | ✅ Complete |
| **Backend** | Task 5: Domain Services | `session.service.js` & `return.service.js` (data mapper, encrypted DB caching, stale fallback) | ✅ Complete |
| **Backend** | Task 6: Controllers & Routes | API route mounting (`/api/gstin`, `/api/auth`, `/api/returns`, `/api/dashboard`, `/health`) in `app.js` | ✅ Complete |
| **Backend** | Task 7: End-to-End Verification | Full backend integration verification with `test-api.js` under mock mode | ✅ Complete |
| **Backend** | Task 8: TaxPro Provider Adapter | TaxPro GSP transport adapter (`taxpro.js`), hyphenated `auth-token` header, query `gstin` parameter alignment, unique `txn` UUID headers, fail-safe `ip-usr` forwarding (no 127.0.0.1 fallback), confirmed GSTR-2B `rtnprd` query parameter, safe header diagnostics, production-only host enforcement, and tested error mappings/envelopes (GSP101, RET2B1023); return mappers await live success samples | In progress |
| **Backend** | Task 9: GSTIN Search | Mock search is complete; TaxPro `TP` search now uses GetKey sessions and documented response fields, pending sandbox response-envelope verification | In progress |
| **Backend** | Roadmap Step 1: TaxPro API inventory | Pasted API list grouped into an implementation matrix with current code status, version conflicts, and confirmation needed | ✅ Complete |
| **Backend** | Roadmap Step 2: Repeatable mock E2E | Isolated child server, unique guarded test database, health wait, API suite, and cleanup; passed twice consecutively | ✅ Complete |
| **Backend** | Roadmap Step 3: SaaS tenant foundation | One workspace per verified GSTIN, owner/member membership, active-membership checks, tenant-scoped return cache and workspace audit/consent metadata | Implemented; full E2E awaits local MongoDB |
| **Backend** | Task 17: Secret & transport guards | Strict explicit NODE_ENV enforcement, dev fallback scoping, hardened production secret validation, repeated-char/zero key refusal, and fail-closed TAXPRO_DEC_PRODUCTION_APPROVED check | ✅ Complete |
| **Backend** | Task 25: Unified Test Runner | Sequential `test:all` runner executing all 6 test suites with fast-fail stop on first error and clear pass/fail summary | ✅ Complete |
| **Backend** | Task 27: Enterprise Billing & Calculations | MongoDB models (`Customer`, `Item`, `Invoice`, `Bill`), automated CGST/SGST vs IGST calculation utility, workspace-scoped CRUD endpoints, real dashboard aggregations, and `test-billing.js` (7/7 suites passing in `npm run test:all`) | ✅ Complete |
| **Backend** | Task 28: GSP Signing Key Diagnostics | Pinpoint safe diagnostics for missing `TAXPRO_ASPID`, `TAXPRO_PASSWORD`, and `TAXPRO_ASP_PRIVATE_KEY_PATH`, unreadable/relative key paths, malformed PEMs, non-RSA keys, and encrypted passphrase verification (0 credential leaks) | ✅ Complete |
| **Backend** | Task 29: GST Taxpayer Authentication | Full GET-based implementation of `OTPREQUEST`, `AUTHTOKEN`, `REFRESHTOKEN`, and `EVCOTP` on `/taxpayerapi/dec/v1.0/authenticate`. Strict isolation from GSP GetKey signing flow; zero credential leakage; Joi validation; expired-token safe mapping (`AUTH4038`, `GSP052A` -> 401 `SESSION_EXPIRED`); and 100% offline regression coverage | ✅ Complete |
| **Backend** | Task 30: GSP014 Diagnostic & Hardening | In-depth root cause analysis of GSP014 against official TaxPro GetKey API documentation; quote/whitespace sanitization on `TAXPRO_ASPID`; `ipUsr` forwarding; and `GSP014` error mapping (502 `PROVIDER_AUTH`) | ✅ Complete |
| **Backend** | Task 32: TaxPro Read-Only Return Mappers | Full schema mappers in `ReturnService` for live GSTR-1 (`B2B` item-level calculation & `RETSUM`), GSTR-2B (`b2b` inward supplies & `itc_elg`), and GSTR-3B (`sup_details`, `itc_elg`), with 100% offline regression coverage in `test-taxpro.js` | ✅ Complete |
| **Frontend** | CandidTax (Zoho Books Style) | Full customer-facing GST billing application inspired by Zoho Books: collapsible left sidebar, topbar quick actions, Dashboard with real totals, Taxpayer Search, Customers, Items & Services, Sales Invoices with live tax calculation & print, Purchases & Bills, Credit Notes, Expenses, GST Returns (GSTR-1, 2B, 3B, Summary, Filing History), Excel Import, Reports, Settings | ✅ Complete |

---

## 2. Windows PowerShell Setup & Run Steps

**Production readiness:** Core mock-mode implementation is complete. Production hardening is in progress; verified TaxPro return samples, token-expiry error code, the ASP registered signing certificate/GSP session configuration, sandbox credentials, and a deployment environment are still required before the app can be considered production-ready.

### Prerequisites
- **Node.js**: v18.0.0 or higher (`node -v`)
- **MongoDB**: Community Server running locally on default port `27017`

### Step 1: Clone and Enter Project Directory
```powershell
cd e:\Desktop\Jobs_assignment\GST_Compliance
```

### Step 2: Configure Environment Variables
Copy example files to `.env` (fill in local placeholders if needed; never commit `.env`):
```powershell
Copy-Item Backend\.env.example Backend\.env
Copy-Item Frontend\.env.example Frontend\.env
```

### Step 3: Run Backend Development Server
Open a PowerShell terminal:
```powershell
cd Backend
npm install
npm run dev
```
*Backend server starts at `http://localhost:4000` (or configured `PORT`).*

### Step 4: Run Frontend Development Server
Open a second PowerShell terminal:
```powershell
cd Frontend
npm install
npm run dev
```
*Frontend Vite server starts at `http://localhost:5173`.*

---

## 3. Environment Variables

> **Security Note:** Real keys and secrets must never be committed to Git or printed in logs. `.env` is explicitly ignored.

### Backend (`Backend/.env`)
- `PORT` - HTTP server port (default: `4000`)
- `NODE_ENV` - Environment mode (`development` / `production`)
- `MONGO_URI` - MongoDB connection string (e.g. `mongodb://localhost:27017/gstapp`)
- `FRONTEND_URL` - Allowed CORS origin for cookie-based authentication (default: `http://localhost:5173`)
- `USE_MOCK` - Boolean flag toggling mock mode (`true` / `false`; `true` forces mock)
- `PROVIDER` - Provider choice (`mock` | `taxpro`)
- `TAXPRO_BASE_URL` - TaxPro GSP API base URL (default sandbox: `https://gstsandbox.charteredinfo.com`)
- `TAXPRO_ASPID` - TaxPro ASP identifier
- `TAXPRO_PASSWORD` - TaxPro ASP secret, Base64 encoded AES key material for GetKey calls
- `TAXPRO_ASP_GSTIN` - GSTIN registered as the TaxPro ASP caller
- `TAXPRO_ASP_PRIVATE_KEY_PATH` - Absolute path to the registered RSA private key in PEM format
- `TAXPRO_ASP_PRIVATE_KEY_PASSPHRASE` - Optional passphrase for the PEM key
- `TAXPRO_GSP_IP_USR` - Deployment egress IP allowed by TaxPro
- `TAXPRO_APP_VERSION` - Optional app identifier sent to TaxPro GSP
- `TAXPRO_API_PROFILE` - `legacy` for comparing the provider email sandbox examples, or `current` for the latest official routes; production requires `current`
- `TAXPRO_GSTR1_ACTION_REQUIRED` - Current profile only; set to TaxPro-confirmed `Y` or `N`
- `TAXPRO_DEC_PRODUCTION_APPROVED` - Explicit human operator approval flag required in production because encrypted transport is not implemented and the adapter hardcodes `/dec/`
- `DATA_ENCRYPTION_KEY` - 64 hex characters (32 bytes) for AES-256-GCM data encryption
- `JWT_SECRET` - Secret key used for signing session cookies
- `TENANT_IDENTITY_SECRET` - Stable secret (at least 32 characters in production) used to derive local user identity hashes; keep it stable across JWT secret rotations
- `SESSION_HOURS` - Session duration in hours before TTL expiration (default: `1` for TaxPro)
- `TRUST_PROXY_HOPS` - Number of explicitly trusted reverse proxy hops used to identify client IPs (default: `0`)
- `CONTACT_INTAKE_ENABLED` - Enables public contact submissions; defaults off in production until a handling workflow is ready

### Frontend (`Frontend/.env`)
- `VITE_API_URL` - Base URL for the backend API (default: `http://localhost:4000/api`)

---

## 4. Mock Mode Behaviour (`USE_MOCK=true`)

When `USE_MOCK=true` is enabled in `Backend/.env`, `finagg.service.js` operates completely offline via `finagg.mock.js` without requiring external network connectivity or provider credentials:

- **GSTIN Lookup (`POST /api/gstin/search`)**:
  - In **mock mode** (`USE_MOCK=true` or `PROVIDER=mock`): returns fake business details (`legalName`: `"Demo Traders Pvt Ltd"`, `tradeName`: `"Demo Traders"`, `status`: `"Active"`, `verified: true`). GSTIN ending in `0` returns taxpayer not found (`INVALID_GSTIN`, HTTP 400). GSTIN starting with `99` simulates provider downtime (`PROVIDER_DOWN`, HTTP 503).
  - In **taxpro mode** (`PROVIDER=taxpro`, `USE_MOCK=false`): calls TaxPro's public `TP` search using a short-lived signed GetKey session. It returns `verified: true` only when documented GSTIN/legal-name fields match the requested taxpayer; an unknown response envelope fails closed.
- **OTP Generation (`requestOtp`)**:
  - Requires mandatory consent (`consent: true`).
  - Returns `{ status_cd: "1" }` matching real TaxPro sample shape.
- **OTP Verification (`verifyOtp`)**:
  - OTP `123456` succeeds and returns `{ status_cd: "1", auth_token: <fake>, expiry: "", sek: "" }`.
  - Any other OTP returns `OTP_INVALID` (HTTP 400).
- **Return Payloads (`getReturn`)**:
  - Returns realistic raw provider payloads for `GSTR1` (B2B, B2C, export tables), `GSTR2B` (ITC categories and available summary), and `GSTR3B` (outward liability, eligible ITC, and tax payable).
  - Period `012022` for `GSTR2B` simulates `RET2B1023` returning `DATA_NOT_AVAILABLE` (HTTP 404).
- **Returns Summary (`getReturnsSummary`)**:
  - Returns filing status for recent financial periods (`092026`, `082026`, `072026`, etc.).

---

## 5. Test Scripts & Automated Verification

### 0. Unified Backend Test Suite (`npm run test:all`)
Runs all backend test suites sequentially in order, stopping immediately on the first failure (fast-fail) and printing a clear PASS or FAIL status per suite:
1. `test-config` (`node scripts/test-config.js`): Fail-closed production secrets, remote URL validation, and transport guard checks.
2. `test-middleware` (`node scripts/test-middleware.js`): Joi validation schemas, centralized error handler, and session cookie authentication.
3. `test-taxpro` (`node scripts/test-taxpro.js`): Offline TaxPro adapter, response mapping, sample payload handling from `doc/`, and credential leak prevention.
4. `test-tenancy` (`node --require ./scripts/e2e-no-dotenv.js scripts/test-tenancy.js`): SaaS tenant isolation, unique workspace per GSTIN, and membership roles.
5. `test-rate-limit-store` (`node scripts/test-rate-limit-store.js`): Distributed rate-limit store concurrency, atomic increments, decrement, reset, and window expiry.
6. `test:e2e` (`node scripts/run-e2e.js`): End-to-end functional API suite against an isolated mock server and ephemeral guarded test database.

```powershell
cd Backend
npm run test:all
```

### 1. Middleware & Validation Suite
Run the unit test suite verifying Joi schemas, MongoDB-shared rate limiting, centralized error handling, and cookie authentication:
```powershell
cd Backend
node scripts/test-middleware.js
```

### 2. TaxPro Provider Adapter Test Suite (Offline)
Run the unit test suite verifying the TaxPro provider adapter, response mapping, sample payload handling from `doc/`, network error translation, and credential leak prevention:
```powershell
cd Backend
node scripts/test-taxpro.js
```
Production configuration checks are also available with `npm run test:config` from `Backend/`; they confirm that remote MongoDB URLs load and local IPv4/IPv6 loopback URLs are rejected.
The shared rate-limit store has a concurrency and window-expiry check with `npm run test:rate-limit-store` from `Backend/` (requires the configured MongoDB instance).
#### Checks Verified:
1. `doc/otprequest-success.json` parses successfully and builds the GET call with `action=OTPREQUEST` in axios `params`; ASP credentials are sent in headers rather than the URL.
2. `doc/authtoken-success.json` returns `{ token: response.auth_token }` and never stores or returns `sek`.
3. `doc/gstr2b-error-RET2B1023.json` maps to `DATA_NOT_AVAILABLE` (404) with `ret_period` and `rtnprd` same value.
4. `doc/error-AUTH4041.json` maps to `PROVIDER_ERROR` (502) without leaking raw message; its source call is unknown, so the test does not attribute it to any endpoint.
5. Unknown `error_cd` maps to `PROVIDER_ERROR` (502).
6. Request timeout (`ECONNABORTED`) maps to `PROVIDER_DOWN` (503).
7. Network connection error (`ECONNREFUSED`) maps to `PROVIDER_DOWN` (503).
8. Upstream HTTP 5xx maps to `PROVIDER_DOWN` (503).
9. Upstream HTTP 429 maps to `RATE_LIMITED` (429).
10. `HTTP 401` and `HTTP 403` map to `PROVIDER_AUTH` (502).
11. Official TaxPro GSP authentication/rate-limit/outage codes map to `PROVIDER_AUTH`, `RATE_LIMITED`, and `PROVIDER_DOWN`; nested logger metadata redacts ASP credentials, taxpayer IDs, usernames, sessions, and contact details.
12. `error_cd` listed in `SESSION_ERROR_CODES` maps to `SESSION_EXPIRED` (401).
13. GetKey uses RSA-SHA256 signing, Base64 AES-ECB/PKCS7 key unwrap, transaction binding, encrypted `asp-secret`, early refresh, and in-memory session caching.
14. `searchGstin` calls TaxPro `TP` and maps documented flat result fields; unknown wrappers and mismatched GSTINs fail closed.
15. `getReturnsSummary` calls TaxPro `RETTRACK` with the computed financial year, then fails closed until a sanitized success sample establishes the status mapper.
16. ReturnService mappers in TaxPro mode throw `PROVIDER_ERROR` (502) with `// TODO: mapper needs real sample`.
17. Controller in TaxPro mode calls configured TaxPro search, rejects bad format with `INVALID_GSTIN` (400), and marks only a recognized provider response verified.
18. **Strengthened Security Leak Test**: Feeds (a) status_cd "2" with token, (b) non-object response with token, (c) status_cd "0" unknown error with password in message, and (d) thrown Axios error with full params. Confirms `TESTASP`, `TESTPASS`, `TESTTOKEN` never appear in logger output, thrown errors, or error JSON.
19. **Safe Network Diagnostics & Timeout Guard**: Formats network errors distinguishing client timeout (`ECONNABORTED`), cancellation (`ERR_CANCELED`), socket aborts, DNS lookup failures, and TCP timeouts; tracks elapsed request time against configured timeout; sanitizes sensitive tokens and taxpayer identifiers; and confirms `requestOtp` never executes automated retries on timeout or provider error.

To collect missing TaxPro sandbox responses, set the sandbox URL and ASP credentials in `Backend/.env` locally, then run `node scripts/capture-taxpro-samples.js` from `Backend/`. It supports both current official paths and the older sandbox paths in the TaxPro email, keeps OTP/token and raw responses in memory, and writes only sanitized samples under `doc/`. Review [`doc/_TO_FILL.md`](doc/_TO_FILL.md) first, then inspect each output for unstructured personal data. Never paste credentials, taxpayer OTPs, tokens, or real taxpayer data into chat or commit them. The sanitizer masks secret fields, GSTIN/PAN, names, email, phone, and invoice-number fields while retaining response structure.

### 3. Isolated Mock End-to-End API Suite
Prerequisites: local MongoDB is running on `127.0.0.1:27017`. From `Backend/`, run:
```powershell
npm run test:e2e
```
The runner starts a mock server on a free port, gives that server a unique `gstapp_e2e_...` database URI in its child-process environment, waits for `/health`, runs `test-api.js`, stops the server, and drops only the uniquely prefixed test database. It does not load `.env`; the test child processes use an explicit environment. The suite retains the configured rate limits and sends synthetic forwarded IPs for test isolation. `test-api.js` defaults to `http://127.0.0.1:4000`; the runner supplies `TEST_API_BASE_URL` for its free port.

### Production Dependency Advisory Check
Run before deployment from each application directory:
```powershell
cd Backend
npm audit --omit=dev
cd ..\Frontend
npm audit --omit=dev
```
Last checked on 2026-10-22: npm reported no known advisories in production dependencies for either application.

### Verification Checks Performed:
1. **Health Check**: `GET /health` returns `{ ok: true }`.
2. **GSTIN Lookup**: Valid format returns taxpayer details with `verified: true` and present names; bad format returns `INVALID_GSTIN` (400); ending in `0` returns `INVALID_GSTIN` (400); starting with `99` returns `PROVIDER_DOWN` (503).
3. **OTP Flow, Validation & Lockout**: Missing/false consent returns `VALIDATION_ERROR` (400); invalid OTP formats ("12ab", "12") return `VALIDATION_ERROR` (400); wrong OTP returns `OTP_INVALID` (400); 4th attempt after 3 failures is blocked with `OTP_INVALID` (400); correct OTP (`123456`) issues encrypted session and sets cookie `sid`.
4. **Cookie Security Attributes**: Confirms `Set-Cookie` header for `sid` contains `HttpOnly` and `SameSite=Lax` in development mode (`NODE_ENV=development`).
5. **Session Authentication**: `GET /api/auth/me` without cookie returns `SESSION_EXPIRED` (401); with cookie returns taxpayer GSTIN and expiration timestamp.
6. **Input Boundaries & Validation**: `GET /api/returns/gstr1` with month "132026" or a future year/month returns `VALIDATION_ERROR` (400).
7. **Returns & Dashboard Data**: `GET /api/returns/summary`, `/api/returns/gstr1`, `/api/returns/gstr2b`, `/api/returns/gstr3b`, and `/api/dashboard` return data strictly matching Section 7 `ReturnData` and `Dashboard` schemas; `GET /api/returns/gstr2b?period=012022` returns `DATA_NOT_AVAILABLE` (404).
8. **Encrypted Caching & Stale Fallback**: Returns data is stored encrypted in MongoDB (`Return` model) using AES-256-GCM; when provider fails, cached returns and dashboard are served with `stale: true` and `fetchedAt` (HTTP 200, not 503).
9. **Protected Route Rejection**: Accessing returns or dashboard endpoints without cookie returns `SESSION_EXPIRED` (401).
10. **Logout Lifecycle**: `POST /api/auth/logout` clears the `sid` cookie and destroys the session in MongoDB, rendering subsequent `/auth/me` requests `SESSION_EXPIRED` (401).
11. **Rate Limiting**: Enforces separate OTP-request and OTP-verification limits plus general API and contact limits through a MongoDB-shared store. Client keys are HMAC-hashed; counters expire at the window boundary, with MongoDB TTL cleanup occurring asynchronously.
12. **Request Body Limits**: The API end-to-end suite confirms both JSON and URL-encoded request bodies above 32 KB receive `PAYLOAD_TOO_LARGE` (413).

---

## 6. Known Gaps & Next Steps

1. **TaxPro API Contract Confirmation**:
   - The pasted API list is inventoried in [`Backend/docs/TAXPRO_API_MATRIX.md`](Backend/docs/TAXPRO_API_MATRIX.md). It contains mixed endpoint versions and does not fully establish methods, request bodies, response shapes, or transport approval. Confirm the matrix with current TaxPro documentation and the account owner before enabling additional calls. The matrix is an inventory, not a provider contract.
2. **Repeatable Isolated E2E**:
   - `npm run test:e2e` starts a mock server on a free port, supplies a unique `gstapp_e2e_...` database only to the server child, waits for health, runs the API suite, then stops the server and drops only that prefixed database. It passed twice consecutively. The test child environment bypasses dotenv, so `.env` is not loaded. Rate limits are unchanged.
3. **TaxPro Real Return Success Shapes**:
   - Mappers for TaxPro GSTR-1, GSTR-2B, and GSTR-3B success responses are awaiting verified sample files in `doc/` (`gstr1-retsum.json`, `gstr2b-success.json`, `gstr3b-retsum.json`). Current-profile collection also saves `gstr1-b2b.json` for detail-shape evidence. The legacy adapter profile matches the paths and period query parameters in the TaxPro sandbox email. The current profile uses official v4.1/v4.2/v7.0 routes, documented common headers (including `ret_prd`), and requires a confirmed GSTR-1 `action_required` value. Both profiles still need successful sandbox samples before mapper implementation.
4. **Real Token-Expiry Error Code Still Unknown**:
   - `doc/authtoken-success.json` confirms `auth_token`; its `expiry` and `sek` fields are empty. TaxPro's AuthToken guide states validity up to six hours; this app caps its own session at one hour pending account-specific sandbox verification. The provider error code representing an expired or invalid GST session token is not yet confirmed. Provider HTTP 401 and 403 map to `PROVIDER_AUTH` (502). `SESSION_ERROR_CODES = []` is defined in `taxpro.js` awaiting the exact `error_cd` from TaxPro documentation.
5. **TaxPro Public API Verification**:
   - TaxPro taxpayer search (`TP`) and filed-return tracking (`RETTRACK`) now use the RSA/AES GetKey session helper. GSTIN search maps documented flat response fields and fails closed if the response envelope differs; RETTRACK's request is wired but its available-period mapper remains gated on a successful sanitized sample. Production requires the ASP GSTIN and registered RSA private key PEM path. Current return endpoint versions and parameters still need sandbox confirmation; see `docs/TAXPRO_ADDENDUM.md`.
6. **Landing Page Contact Form**:
   - `POST /api/contact` validates and rate-limits submissions, stores messages in MongoDB, and expires them after 180 days. Delivery notifications still require an email provider configuration.
7. **Real Provider Sandbox Integration**:
   - Once real TaxPro return response samples are received in `doc/`, finalize the ReturnService mappers and transition from mock mode to live sandbox testing.
8. **Closed Test Gaps (Mock Mode)**:
   - All mock mode test gaps have been verified in `Backend/scripts/test-api.js`: 4th OTP attempt lockout (max 3 attempts), invalid OTP formats ("12ab", "12"), invalid/future period formats ("132026", future year), Set-Cookie `HttpOnly` and `SameSite=Lax` headers, and stale cache fallback returning saved data with `stale: true` and `fetchedAt` (HTTP 200).
9. **Server Deployment Rule (`NODE_ENV=production`)**:
   - Production-mode startup strictly requires `NODE_ENV=production` (fails if unset or unrecognized; dev fallback secrets are restricted strictly to `development` and `test`), `PROVIDER=taxpro`, `USE_MOCK=false`, `TAXPRO_API_PROFILE=current`, HTTPS frontend URL, the exact TaxPro production origin `https://gstapi.charteredinfo.com`, TaxPro credentials, the registered ASP GSTIN/RSA PEM and allowlisted deployment IP, and `SESSION_HOURS=1`. Current profile requires the TaxPro-confirmed GSTR-1 action flag.
   - Secrets validation refuses unset, shorter than 32 characters, dev default values, placeholder tokens (`dev_secret`, `do_not_use`, `change_me`, `changeme`, `your_`, `example`, `password`), identical `JWT_SECRET` and `TENANT_IDENTITY_SECRET`, and `DATA_ENCRYPTION_KEY` consisting of a single repeated character or all zeros.
   - Transport guard: Encrypted transport is not implemented in the codebase; the adapter currently hardcodes the decrypted `/dec/` transport. Production startup strictly refuses unless `TAXPRO_DEC_PRODUCTION_APPROVED=true` is explicitly set in the deployment environment by the operator after written provider approval. Test hooks are disabled in production. Real credentials and sandbox E2E are also still required.
10. **Contact Message Handling**:
   - Contact submissions are retained in MongoDB for 180 days, but there is no staff inbox or configured email provider. Add and review a message delivery/handling workflow before enabling the public form in production.
11. **Deployment and Live Verification**:
   - A hosted HTTPS frontend/backend, managed MongoDB with backups, monitoring, reverse-proxy query-string redaction for taxpayer identifiers/periods, and a credentialed TaxPro sandbox run are still required.
