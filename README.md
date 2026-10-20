# GST Compliance Platform

A secure taxpayer portal to verify identity via GSTN OTP and inspect GSTR-1 (sales), GSTR-2B (purchases & ITC), and GSTR-3B (tax liabilities & net payable) compliance data. Built with Node.js, Express, MongoDB, and React (Vite).

---

## 1. Progress Status

| Component | Task | Description | Status |
|-----------|------|-------------|--------|
| **Setup** | S0 - Folder setup | S0 - Folder setup: Done | Done |
| **Backend** | Task 1: Foundation & Utils | Config loader, MongoDB connection, AES-256-GCM crypto, redacted logger, ApiError, GSTIN/period validation | ✅ Complete |
| **Backend** | Task 2: MongoDB Models | Mongoose models with TTL indexes (`Session`, `OtpState`, `GstinCache`, `Return`, `Consent`, `AuditLog`, `User`) | ✅ Complete |
| **Backend** | Task 3: Validation & Middleware | Joi validation schemas, in-memory rate limiting, cookie-based JWT session auth, centralized error handler | ✅ Complete |
| **Backend** | Task 4: FinAGG Service & Mock Engine | In-memory `FinaggMock` provider and `FinaggService` gateway with confirmation annotations | ✅ Complete |
| **Backend** | Task 5: Domain Services | `session.service.js` & `returns.service.js` (data mapper, encrypted DB caching, stale fallback) | ⏳ In Progress |
| **Backend** | Task 6: Controllers & Routes | API route mounting (`/api/gstin`, `/api/auth`, `/api/returns`, `/api/dashboard`, `/health`) in `app.js` | ⏳ Pending |
| **Backend** | Task 7: End-to-End Verification | Full backend integration verification under mock mode | ⏳ Pending |
| **Frontend** | Task 1: Pages & Components | Landing page, LoginPage, OtpPage, DashboardPage, ReturnDetailPage, AuthContext, Axios client | ✅ Complete |
| **Frontend** | Task 2: Live Integration | End-to-end integration with live backend API endpoints | ⏳ Pending |

---

## 2. Windows PowerShell Setup & Run Steps

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
- `USE_MOCK` - Boolean flag toggling mock mode (`true` / `false`)
- `FINAGG_BASE_URL` - Base URL of the FinAGG GSP gateway
- `FINAGG_API_KEY` - FinAGG API authentication key
- `DATA_ENCRYPTION_KEY` - 64 hex characters (32 bytes) for AES-256-GCM data encryption
- `JWT_SECRET` - Secret key used for signing session cookies
- `SESSION_HOURS` - Session duration in hours before TTL expiration (default: `6`)

### Frontend (`Frontend/.env`)
- `VITE_API_URL` - Base URL for the backend API (default: `http://localhost:4000/api`)

---

## 4. Mock Mode Behaviour (`USE_MOCK=true`)

When `USE_MOCK=true` is enabled in `Backend/.env`, `finagg.service.js` operates completely offline via `finagg.mock.js` without requiring external network connectivity or FinAGG credentials:

- **GSTIN Lookup (`searchGstin`)**:
  - Any valid 15-character GSTIN returns demo business data (`legalName`: `"Demo Traders Pvt Ltd"`, `tradeName`: `"Demo Traders"`, `status`: `"Active"`).
  - GSTIN ending in `0` simulates a taxpayer not found / cancelled status (`INVALID_GSTIN`, HTTP 400).
  - GSTIN starting with `99` simulates provider / GSTN downtime (`PROVIDER_DOWN`, HTTP 503).
- **OTP Generation (`requestOtp`)**:
  - Requires mandatory consent (`consent: true`).
  - Always returns success with a generic dispatch message (`SMS/Email`).
- **OTP Verification (`verifyOtp`)**:
  - OTP `123456` succeeds and issues a mock GST session token.
  - Any other OTP returns `OTP_INVALID` (HTTP 400).
- **Return Payloads (`getReturn`)**:
  - Returns realistic raw provider payloads for `GSTR1` (B2B, B2C, export tables), `GSTR2B` (ITC categories and available summary), and `GSTR3B` (outward liability, eligible ITC, and tax payable).
- **Returns Summary (`getReturnsSummary`)**:
  - Returns filing status for recent financial periods (`092026`, `082026`, `072026`, etc.).

---

## 5. Test Scripts & Automated Verification

### Middleware & Validation Suite
Run the automated test suite testing Joi schemas, in-memory rate limiting, centralized error handling, and cookie authentication:
```powershell
cd Backend
node scripts/test-middleware.js
```

### Verification Checks Performed:
1. **Validation**: Rejects invalid GSTIN formats (`INVALID_GSTIN`), malformed OTPs (`VALIDATION_ERROR`), invalid month periods (`132026`), future periods, and missing consent flags.
2. **Rate Limiting**: Verifies that the 6th OTP request from the same IP within the window returns `429 RATE_LIMITED`.
3. **Error Handling**: Verifies `ApiError` status mapping and ensures unhandled 500 errors return a generic message without exposing stack traces or internal details.
4. **Authentication**: Verifies that missing cookies, corrupted JWTs, nonexistent sessions, and expired sessions return `401 SESSION_EXPIRED`, while valid sessions pass with HTTP 200.

---

## 6. Known Gaps & Next Steps

1. **Domain Services Integration (Task 5)**:
   - `session.service.js` must be wired to issue signed `sid` cookies upon OTP verification.
   - `returns.service.js` must map raw FinAGG mock data to internal `Dashboard` and `ReturnData` shapes, store encrypted payloads in MongoDB (`Return` model), and return cached data with `stale: true` when the provider is down.
2. **Controller & Route Wiring (Task 6)**:
   - Wire controllers (`auth.controller.js`, `gstin.controller.js`, `returns.controller.js`, `dashboard.controller.js`) to routes in `src/routes/` and mount under `/api` in `src/app.js`.
3. **Frontend E2E Connection (Task 7)**:
   - Connect the active frontend UI (`LoginPage`, `OtpPage`, `DashboardPage`) to the live Express server endpoints to complete the end-to-end user journey.
4. **Real FinAGG GSP Integration**:
   - Production/sandbox FinAGG API paths, headers, and response formats to be confirmed and documented in `docs/FINAGG_TODO.md`.
