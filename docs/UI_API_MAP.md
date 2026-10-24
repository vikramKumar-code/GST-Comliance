# Frontend UI to API Mapping (`docs/UI_API_MAP.md`)

> Generated as part of `[UI] Task 26`. UI FREEZE applies.
> Complete mapping of frontend pages, routes, API calls, error code handling, visual display, and unhandled conditions.
> Date: October 2026.

---

## 1. Overview and Global Interceptor Architecture

All API requests initiated by the frontend application pass through the centralized Axios client configured in [`Frontend/src/api/client.js`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/api/client.js).

### Global Configuration
- **Base URL**: `import.meta.env.VITE_API_URL || 'http://localhost:4000/api'`
- **Credentials**: `withCredentials: true` (sends and receives `sid` HTTP-only session cookie)
- **Timeout**: `30000ms` (30 seconds)
- **Content-Type**: `application/json`

### Error Normalization Interceptor
The response error interceptor in `client.js` maps raw Axios and network errors into a consistent JavaScript object:
```javascript
{
  code: string,    // Normalized application error code
  message: string, // User-friendly error message
  status: number   // HTTP status code
}
```

#### Friendly Error Message Dictionary (`client.js`):
| Error Code | HTTP Status | Client Message |
|------------|-------------|----------------|
| `INVALID_GSTIN` | 400 | `"Taxpayer GSTIN not found or invalid format."` |
| `VALIDATION_ERROR` | 400 | `"Invalid input parameters. Please check your entries."` |
| `OTP_INVALID` | 400 | `"Invalid or expired OTP. Please check and try again."` |
| `SESSION_EXPIRED` | 401 | `"Please verify OTP again."` |
| `DATA_NOT_AVAILABLE` | 404 | `"Data for this period is not available yet. Try another month."` |
| `RATE_LIMITED` | 429 | `"Too many requests. Please wait and try again."` |
| `PROVIDER_AUTH` | 502 | `"Could not complete the request. Please try again."` |
| `PROVIDER_DOWN` | 503 | `"GST service is unavailable. Please try again later."` |
| `PROVIDER_ERROR` | 502 | `"Could not complete the request. Please try again."` |
| `SERVER_ERROR` | 500 | `"Internal server error. Please try again later."` |
| `TIMEOUT` | 408 / ECONNABORTED | `"Request timed out. Please try again."` |
| `NETWORK_ERROR` | 0 | `"Network connection failed. Please try again."` |
| `API_ACCESS_NOT_ENABLED` | 403 | Preserves backend message: `"API access is not enabled for this GST account. Please enable API access in your GST portal profile and try again."` |

#### Global Redirection Rule (`client.js`):
- If `code === 'SESSION_EXPIRED'`, the client automatically navigates to `/login` via `window.location.href = '/login'`, **unless** the current route is in the whitelist of public paths: `['/login', '/otp', '/', '/privacy', '/terms']`.

---

## 2. Page-by-Page API Mapping & Error Handling

---

### Page 1: Landing Page (`/`)

- **Component**: [`Frontend/src/pages/LandingPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/LandingPage.jsx)
- **Protection**: Public (no login required)
- **API Calls Made**:

| Action / Trigger | API Function | HTTP Route | Payload / Parameters |
|------------------|--------------|------------|----------------------|
| App initial mount | `getMe()` (via `AuthProvider`) | `GET /api/auth/me` | None (`sid` cookie) |
| Contact Form Submission ("Send Message" button) | `client.post('/contact', contactForm)` | `POST /api/contact` | Body: `{ name, email, subject, message }` |

- **Error Codes Handled**:

| API Call | Error Code | HTTP Status | Visual Representation in UI |
|----------|------------|-------------|-----------------------------|
| `POST /api/contact` | `VALIDATION_ERROR` | 400 | Rendered in alert banner: `<div class="alert alert-danger ...">! [message]</div>` above the form. |
| `POST /api/contact` | `RATE_LIMITED` | 429 | Rendered in alert banner: `"Too many requests. Please wait and try again."`. |
| `POST /api/contact` | `SERVER_ERROR` | 500 / 503 | Rendered in alert banner: `"Internal server error. Please try again later."` (or backend's `"Contact submissions are temporarily unavailable."` if intake disabled). |
| `POST /api/contact` | `NETWORK_ERROR` / `TIMEOUT` | - | Rendered in alert banner with retry guidance. |
| `GET /api/auth/me` | `SESSION_EXPIRED` | 401 | Silently sets `user = null`. Navbar renders unauthenticated `"Taxpayer Login"` CTA. |
| `GET /api/auth/me` | Other errors | - | Stored in `AuthContext.error`; does not block landing page rendering. |

- **Error Codes NOT Handled**:
  - `FORBIDDEN` (403 - Origin Guard): Rendered as generic alert banner without advising the user about cross-origin or proxy issues.
  - `PAYLOAD_TOO_LARGE` (413): If message body exceeds 32kb, displays generic error message; does not specify which input was too large.
  - Field-level validation: Individual input fields (`#contact-email`, `#contact-message`) rely on HTML5 browser validation; backend Joi error details (`details[]`) are not mapped to specific inputs.

---

### Page 2: Taxpayer Login Page (`/login`)

- **Component**: [`Frontend/src/pages/LoginPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/LoginPage.jsx) (renders [`Frontend/src/components/GstinForm.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/components/GstinForm.jsx))
- **Protection**: Public
- **API Calls Made**:

| Action / Trigger | API Function | HTTP Route | Payload / Parameters |
|------------------|--------------|------------|----------------------|
| App initial mount | `getMe()` (via `AuthProvider`) | `GET /api/auth/me` | None (`sid` cookie) |
| Taxpayer clicks "Verify" button | `searchGstin(cleanGstin)` | `POST /api/gstin/search` | Body: `{ gstin: string }` |
| Taxpayer clicks "Send OTP" button | `requestOtp({ gstin, username, consent: true })` | `POST /api/auth/otp/request` | Body: `{ gstin, username, consent: true }` |

- **Success States**:
  - GSTIN Search success: If `legalName` is returned, renders green alert box: `🏢 [legalName] • [tradeName] • Status: [status]`.
  - OTP Request success: Calls `onOtpSent({ gstin, username, legalName })` which navigates to `/otp` with route state.

- **Error Codes Handled**:

| API Call | Error Code | HTTP Status | Visual Representation in UI |
|----------|------------|-------------|-----------------------------|
| Client Validation | `INVALID_GSTIN` | - | Rendered via `<ErrorMessage error={error} />` (`alert alert-danger` with `⚠️`, badge `INVALID_GSTIN`, and message `"Invalid GSTIN format. Must be 15 alphanumeric characters."`). |
| Client Validation | `VALIDATION_ERROR` | - | Rendered via `ErrorMessage`: `"GST Portal Username is required."` or `"Taxpayer consent is mandatory to request OTP."`. |
| `POST /api/gstin/search` | `INVALID_GSTIN` | 400 | Rendered via `ErrorMessage` badge `INVALID_GSTIN`: `"Taxpayer GSTIN not found or invalid format."`. |
| `POST /api/gstin/search` | `PROVIDER_DOWN` | 503 | Rendered via `ErrorMessage` badge `PROVIDER_DOWN`: `"GST service is unavailable. Please try again later."`. |
| `POST /api/gstin/search` | `PROVIDER_AUTH` / `PROVIDER_ERROR` | 502 | Rendered via `ErrorMessage`: `"Could not complete the request. Please try again."`. |
| `POST /api/auth/otp/request` | `API_ACCESS_NOT_ENABLED` | 403 | Rendered via `ErrorMessage` badge `API_ACCESS_NOT_ENABLED`: `"API access is not enabled for this GST account. Please enable API access in your GST portal profile and try again."`. |
| `POST /api/auth/otp/request` | `RATE_LIMITED` | 429 | Rendered via `ErrorMessage` badge `RATE_LIMITED`: `"Too many requests. Please wait and try again."`. |
| `POST /api/auth/otp/request` | `PROVIDER_DOWN` | 503 | Rendered via `ErrorMessage` badge `PROVIDER_DOWN`: `"GST service is unavailable. Please try again later."`. |
| `POST /api/auth/otp/request` | `SERVER_ERROR` | 500 | Rendered via `ErrorMessage` badge `SERVER_ERROR`: `"Internal server error. Please try again later."`. |

- **Error Codes NOT Handled**:
  - `FORBIDDEN` (403 - Disallowed Origin): Displayed in generic error banner.
  - Rate limit cooldown: For `otpLimiter` (5 req / 10m), user is shown the rate limit error but no remaining lockout countdown timer is provided on `/login` (the countdown timer exists only on `/otp`).

---

### Page 3: OTP Verification Page (`/otp`)

- **Component**: [`Frontend/src/pages/OtpPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/OtpPage.jsx) (renders [`Frontend/src/components/OtpForm.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/components/OtpForm.jsx))
- **Protection**: Public (requires navigation state `{ gstin, username, legalName }`)
- **API Calls Made**:

| Action / Trigger | API Function | HTTP Route | Payload / Parameters |
|------------------|--------------|------------|----------------------|
| App initial mount | `getMe()` (via `AuthProvider`) | `GET /api/auth/me` | None (`sid` cookie) |
| Taxpayer clicks "Verify & Open Dashboard" | `verifyOtp({ gstin, username, otp })` | `POST /api/auth/otp/verify` | Body: `{ gstin, username, otp }` |
| Taxpayer clicks "Resend OTP" | `requestOtp({ gstin, username, consent: true })` | `POST /api/auth/otp/request` | Body: `{ gstin, username, consent: true }` |
| Immediately upon OTP verify success | `checkAuth()` (via `AuthContext`) | `GET /api/auth/me` | None (reads newly set `sid` cookie) |

- **Success States**:
  - OTP Verify success: `loginSuccess(userData)` updates context, `checkAuth()` confirms session, and navigates to target URL or `/dashboard`.
  - Resend OTP success: Sets visible 30s countdown timer and renders blue alert: `ℹ️ A fresh OTP has been dispatched to your GST mobile/email.`.

- **Error Codes Handled**:

| API Call | Error Code | HTTP Status | Visual Representation in UI |
|----------|------------|-------------|-----------------------------|
| Client Validation | `OTP_INVALID` | - | Rendered via `ErrorMessage` badge `OTP_INVALID`: `"OTP must be 4 to 8 digits."`. |
| `POST /api/auth/otp/verify` | `OTP_INVALID` | 400 | Rendered via `ErrorMessage` badge `OTP_INVALID`: `"Invalid or expired OTP. Please check and try again."` (or provider lockout message). |
| `POST /api/auth/otp/verify` | `VALIDATION_ERROR` | 400 | Rendered via `ErrorMessage` badge `VALIDATION_ERROR`. |
| `POST /api/auth/otp/verify` | `API_ACCESS_NOT_ENABLED` | 403 | Rendered via `ErrorMessage` badge `API_ACCESS_NOT_ENABLED`: `"API access is not enabled for this GST account..."`. |
| `POST /api/auth/otp/verify` | `RATE_LIMITED` | 429 | Rendered via `ErrorMessage` badge `RATE_LIMITED`: `"Too many requests. Please wait and try again."` (triggered by `otpVerifyLimiter` 10 req / 10m). |
| `POST /api/auth/otp/verify` | `SESSION_EXPIRED` | 401 | Triggered if workspace or member status is inactive (`DISABLED`); rendered via `ErrorMessage` badge `SESSION_EXPIRED`. Not auto-redirected because `/otp` is in public whitelist. |
| `POST /api/auth/otp/verify` | `PROVIDER_DOWN` | 503 | Rendered via `ErrorMessage` badge `PROVIDER_DOWN`. |
| `POST /api/auth/otp/verify` | `PROVIDER_AUTH` / `PROVIDER_ERROR` | 502 | Rendered via `ErrorMessage` with friendly fallback. |
| `POST /api/auth/otp/request` | (Resend errors) | 4xx / 5xx | Rendered via `ErrorMessage` with "Retry" button. |

- **Error Codes NOT Handled**:
  - Missing state guard: If `/otp` is opened directly without `location.state.gstin`, it navigates immediately to `/login` via `<Navigate to="/login" replace />` without displaying an error to explain why navigation occurred.
  - Attempt Counter: Backend locks out after 3 failed OTP attempts, but frontend does not display remaining attempt count (e.g., "1 attempt remaining").

---

### Page 4: Taxpayer Compliance Dashboard (`/dashboard`)

- **Component**: [`Frontend/src/pages/DashboardPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/DashboardPage.jsx) (uses [`Frontend/src/hooks/useReturns.js`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/hooks/useReturns.js))
- **Protection**: Protected (`ProtectedRoute` verifies `user` via `GET /api/auth/me`; redirects unauthenticated requests to `/login`)
- **API Calls Made**:

| Action / Trigger | API Function | HTTP Route | Payload / Parameters |
|------------------|--------------|------------|----------------------|
| Mount & period changes | `getDashboard(period)` | `GET /api/dashboard` | Query: `?period=MMYYYY` |
| Mount & period changes | `getReturnsSummary(period)` | `GET /api/returns/summary` | Query: `?period=MMYYYY` |
| Taxpayer clicks "Logout" in Navbar | `logout()` | `POST /api/auth/logout` | None (`sid` cookie cleared) |

- **Data States**:
  - Loading: Renders `<Loader message="Fetching return summaries and dashboard metrics..." />`.
  - Normal Success: Renders `<SummaryCards data={dashboardData} />` (Sales, Purchases, ITC, Net Tax Payable) and return breakdown cards for GSTR-1, GSTR-2B, and GSTR-3B.
  - Stale Cache (`stale: true`): Renders warning banner above metrics:
    `⚠️ Showing cached data from [Formatted Date]. Live GST service is currently unavailable.`

- **Error Codes Handled**:

| API Call | Error Code | HTTP Status | Visual Representation in UI |
|----------|------------|-------------|-----------------------------|
| `GET /api/dashboard` | `DATA_NOT_AVAILABLE` | 404 | Intercepted in `useReturns.js`: sets `isDataNotAvailable = true`. Renders calm `<EmptyState title="Return Data Not Available" message="Data for this period is not available yet. Try another month." action={<button>Check Again</button>} />`. `PeriodSelector` remains mounted and interactive. |
| `GET /api/dashboard` | `SESSION_EXPIRED` | 401 | Intercepted by `client.js`: since `/dashboard` is a protected route, triggers automatic redirection to `/login` (`window.location.href = '/login'`). |
| `GET /api/dashboard` | `PROVIDER_DOWN` | 503 | When no cached fallback return exists: renders `<ErrorMessage error={error} onRetry={refresh} />` with "Retry" button. |
| `GET /api/dashboard` | `PROVIDER_AUTH` / `PROVIDER_ERROR` | 502 | Rendered via `ErrorMessage` with friendly text and "Retry" button. |
| `GET /api/dashboard` | `RATE_LIMITED` | 429 | Rendered via `ErrorMessage` with "Retry" button. |
| `GET /api/dashboard` | `VALIDATION_ERROR` | 400 | Rendered via `ErrorMessage` with "Retry" button (e.g. if invalid period parameter is passed). |
| `GET /api/dashboard` | `SERVER_ERROR` | 500 | Rendered via `ErrorMessage` with "Retry" button. |

- **Error Codes NOT Handled**:
  - `FORBIDDEN` (403 - Workspace Role / Tenant Isolation): If user session is valid but membership role does not permit access (`workspaceRole` check), Express returns 403 `FORBIDDEN`. Dashboard displays generic `ErrorMessage` banner, but does not provide tenant/workspace switching actions.
  - Granular return failure: In backend `dashboard.controller.js`, `Promise.all` fails if any component return throws `DATA_NOT_AVAILABLE`, resulting in the entire dashboard displaying 404 rather than displaying partial metrics for available returns.

---

### Page 5: Return Detail Page (`/returns/:type`)

- **Component**: [`Frontend/src/pages/ReturnDetailPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/ReturnDetailPage.jsx)
- **Protection**: Protected (`ProtectedRoute`)
- **Supported Return Types**: `:type` = `gstr1`, `gstr2b`, `gstr3b`
- **API Calls Made**:

| `:type` Param | API Function | HTTP Route | Payload / Parameters |
|---------------|--------------|------------|----------------------|
| `gstr1` | `getGstr1(period)` | `GET /api/returns/gstr1` | Query: `?period=MMYYYY` |
| `gstr2b` | `getGstr2b(period)` | `GET /api/returns/gstr2b` | Query: `?period=MMYYYY` |
| `gstr3b` | `getGstr3b(period)` | `GET /api/returns/gstr3b` | Query: `?period=MMYYYY` |
| Any | `logout()` | `POST /api/auth/logout` | None (Navbar button) |

- **Data States**:
  - Loading: Renders `<Loader message="Fetching [TYPE] return data for period [PERIOD]..." />`.
  - Normal Success: Renders `<ReturnTable rows={returnData.rows} totals={returnData.totals} />` with line items, tax slabs (Taxable, IGST, CGST, SGST, Cess), row count, and last synchronized timestamp.
  - Stale Cache (`stale: true`): Renders warning banner:
    `⚠️ Showing cached return data from [Formatted Date]. Live GST service is currently unavailable.`

- **Error Codes Handled**:

| API Call | Error Code | HTTP Status | Visual Representation in UI |
|----------|------------|-------------|-----------------------------|
| Client Validation | `VALIDATION_ERROR` | - | If `:type` is not `gstr1`, `gstr2b`, or `gstr3b`, `getReturnByType` throws `{ code: 'VALIDATION_ERROR', message: 'Unknown return type...' }`, rendered via `ErrorMessage`. |
| `GET /api/returns/*` | `DATA_NOT_AVAILABLE` | 404 | Intercepted in `ReturnDetailPage.jsx`: sets `isDataNotAvailable = true`. Renders calm `<EmptyState title="No [TYPE] Data Available" message="Data for this period is not available yet. Try another month." action={<button>Retry Period</button>} />`. `PeriodSelector` remains mounted. |
| `GET /api/returns/*` | `SESSION_EXPIRED` | 401 | Intercepted by `client.js`: automatic redirect to `/login`. |
| `GET /api/returns/*` | `PROVIDER_DOWN` | 503 | When no cached return exists: renders `<ErrorMessage error={error} onRetry={retry} />`. |
| `GET /api/returns/*` | `PROVIDER_AUTH` / `PROVIDER_ERROR` | 502 | Rendered via `ErrorMessage` with friendly fallback and "Retry" button. |
| `GET /api/returns/*` | `RATE_LIMITED` | 429 | Rendered via `ErrorMessage`. |
| `GET /api/returns/*` | `VALIDATION_ERROR` | 400 | Rendered via `ErrorMessage` (invalid period format). |
| `GET /api/returns/*` | `SERVER_ERROR` | 500 | Rendered via `ErrorMessage`. |

- **Error Codes NOT Handled**:
  - Unrecognized route param: If `:type` is an invalid string (e.g. `/returns/invalid`), it displays an error banner inside the layout rather than redirecting to a proper 404 page.
  - `FORBIDDEN` (403): Rendered as generic `ErrorMessage` banner.

---

### Pages 6 & 7: Privacy Policy (`/privacy`) and Terms of Service (`/terms`)

- **Components**: [`Frontend/src/pages/PrivacyPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/PrivacyPage.jsx), [`Frontend/src/pages/TermsPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/TermsPage.jsx)
- **Protection**: Public
- **API Calls Made**:
  - `GET /api/auth/me` on mount via `AuthProvider`.
- **Error Codes Handled**:
  - `SESSION_EXPIRED` (401): Silently ignored (public pages).
- **Error Codes NOT Handled**: None (static text pages).

---

### Page 8: 404 Not Found Page (`*`)

- **Component**: [`Frontend/src/pages/NotFoundPage.jsx`](file:///e:/Desktop/Jobs_assignment/GST_Compliance/Frontend/src/pages/NotFoundPage.jsx)
- **Protection**: Public catch-all
- **API Calls Made**: None directly.
- **Error Codes Handled**: None (static 404 page).

---

## 3. Summary Matrix: API Routes vs Frontend Handling

| Backend API Route | Method | Called By Page(s) | Handled Status Codes & UI Representation | Unhandled Codes / Gaps |
|-------------------|:------:|-------------------|------------------------------------------|------------------------|
| `/api/gstin/search` | POST | Login (`/login`) | 200 (Green business banner), 400 `INVALID_GSTIN` (`ErrorMessage`), 502 `PROVIDER_AUTH`/`PROVIDER_ERROR` (`ErrorMessage`), 503 `PROVIDER_DOWN` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`) | 403 `FORBIDDEN` (disallowed origin), 413 `PAYLOAD_TOO_LARGE` |
| `/api/auth/otp/request` | POST | Login (`/login`), OTP (`/otp`) | 200 (Navigate to `/otp` / Reset 30s countdown), 400 `VALIDATION_ERROR` (`ErrorMessage`), 403 `API_ACCESS_NOT_ENABLED` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`), 502 `PROVIDER_AUTH`/`PROVIDER_ERROR`, 503 `PROVIDER_DOWN` | 403 `FORBIDDEN` (disallowed origin) |
| `/api/auth/otp/verify` | POST | OTP (`/otp`) | 200 (Navigate to `/dashboard`), 400 `OTP_INVALID` (`ErrorMessage`), 400 `VALIDATION_ERROR`, 401 `SESSION_EXPIRED` (`ErrorMessage`), 403 `API_ACCESS_NOT_ENABLED` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`), 502 `PROVIDER_AUTH`/`PROVIDER_ERROR`, 503 `PROVIDER_DOWN` | Remaining attempts counter not rendered before 3-attempt lockout |
| `/api/auth/me` | GET | All (`AuthProvider`, `ProtectedRoute`) | 200 (Authenticated state), 401 `SESSION_EXPIRED` (Auto-redirect to `/login` for protected pages; silent ignore for public pages) | None |
| `/api/auth/logout` | POST | Dashboard (`/dashboard`), Return Detail (`/returns/:type`) | 200 (Clears user context & cookie, navigates to `/login`) | Logout network error silently ignored |
| `/api/returns/summary` | GET | Dashboard (`/dashboard`) | 200 (Populates available periods in `useReturns`), `stale: true` (Warning alert) | Failures in summary fetch are caught and swallowed (`.catch(() => null)`) to prevent blocking dashboard render |
| `/api/returns/gstr1` | GET | Return Detail (`/returns/gstr1`) | 200 (Render `ReturnTable`), `stale: true` (Warning alert), 404 `DATA_NOT_AVAILABLE` (Calm `EmptyState`), 401 `SESSION_EXPIRED` (Redirect `/login`), 503 `PROVIDER_DOWN` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`) | 403 `FORBIDDEN` (role mismatch) |
| `/api/returns/gstr2b` | GET | Return Detail (`/returns/gstr2b`) | 200 (Render `ReturnTable`), `stale: true` (Warning alert), 404 `DATA_NOT_AVAILABLE` (Calm `EmptyState`), 401 `SESSION_EXPIRED` (Redirect `/login`), 503 `PROVIDER_DOWN` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`) | 403 `FORBIDDEN` (role mismatch) |
| `/api/returns/gstr3b` | GET | Return Detail (`/returns/gstr3b`) | 200 (Render `ReturnTable`), `stale: true` (Warning alert), 404 `DATA_NOT_AVAILABLE` (Calm `EmptyState`), 401 `SESSION_EXPIRED` (Redirect `/login`), 503 `PROVIDER_DOWN` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`) | 403 `FORBIDDEN` (role mismatch) |
| `/api/dashboard` | GET | Dashboard (`/dashboard`) | 200 (Render `SummaryCards`), `stale: true` (Warning alert), 404 `DATA_NOT_AVAILABLE` (Calm `EmptyState`), 401 `SESSION_EXPIRED` (Redirect `/login`), 503 `PROVIDER_DOWN` (`ErrorMessage`), 429 `RATE_LIMITED` (`ErrorMessage`) | 403 `FORBIDDEN` (role mismatch) |
| `/api/contact` | POST | Landing (`/`) | 201 (Green success alert), 400 `VALIDATION_ERROR` (Danger alert), 429 `RATE_LIMITED` (Danger alert), 500 / 503 `SERVER_ERROR` (Danger alert) | 403 `FORBIDDEN`, 413 `PAYLOAD_TOO_LARGE`, field-level validation mapping |
