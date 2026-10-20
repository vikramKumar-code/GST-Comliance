# Provider response samples (TaxPro GSP sandbox)

These files are the ground truth for the TaxPro adapter and the mapper. Do not invent or "tidy" them.

## Rules
- Only real responses from the sandbox. Never write a sample from memory or from a guess.
- **Redact before saving:** authtoken, aspid, password, OTP, any session or token value, and personal data. Use `scripts/sanitize-sample.js` (see below), then open the file and check it yourself.
- Never commit anything that contains a real credential. Run `git status` and read the diff before every commit.
- Keep the original structure and field names exactly. Only change secret values.

## Response format seen so far
- Success: `status_cd` is `"1"`.
- Error: `status_cd` is `"0"` with `error.error_cd` and `error.message`.

## Status

| File | Call | State |
|------|------|-------|
| otprequest-success.json | authenticate, action=OTPREQUEST | Done (real) |
| gstr2b-error-RET2B1023.json | returns/gstr2b, action=GET2B, period 012022 | Done (real): no data for period |
| error-AUTH4041.json | one data call (which one was not noted) | Done (real): state-cd error. Note which call it came from |
| authtoken-success.json | authenticate, action=AUTHTOKEN, OTP=575757 | Done (real, token redacted) |
| gstr1-b2b.json | returns/gstr1, action=B2B, period 022022 | **TO FILL** |
| gstr3b-retsum.json | returns/gstr3b, action=RETSUM, period 022022 | **TO FILL** |
| gstr2b-success.json | returns/gstr2b, action=GET2B, a period that has data | **TO FILL** (if you find one) |
| gstr2a-b2b.json | returns/gstr2a, action=B2B, period 082017 | Optional |

See `_TO_FILL.md` for exactly what to paste.

## Sanitize helper
From `backend/`:
```powershell
node scripts/sanitize-sample.js raw-response.json ../docs/samples/authtoken-success.json
```
It replaces values of keys that look like secrets (token, auth, password, aspid, otp, secret, key) and any 32-character hex string with `REDACTED`, and masks GSTIN-like values. Always read the output before committing. Delete the raw file afterwards.

## Findings so far
- AUTHTOKEN response fields: `status_cd`, `auth_token`, `expiry`, `sek`.
- The response field is `auth_token`, but the request parameter on data calls is `authtoken`.
- `expiry` came back **empty**, so the provider does not tell us how long the token lives. Our own session timeout must be conservative, and a "token expired" error from the provider must be mapped to SESSION_EXPIRED. Token lifetime: ask TaxPro and test (reuse the same token after 15, 30 and 60 minutes). [CONFIRM]
- `sek` came back **empty**. Probably because the `/dec/` path means the provider handles encryption, but this is not confirmed. Do not store `sek`. [CONFIRM]
- RET2B1023 means no GSTR-2B for that period: map to DATA_NOT_AVAILABLE.
- AUTH4041 (state-cd): check the GSTIN and username pair and the token belong together.
