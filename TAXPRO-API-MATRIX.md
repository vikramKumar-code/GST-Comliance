# TaxPro API matrix and release-catalogue comparison

## Source and decision

This matrix transcribes the relevant entries in `Released_API_List_20211108.xlsx`
(the `APIs in Production` sheet) and compares them with the TaxPro adapter in
`Backend/src/services/providers/taxpro.js`.

The user confirms that the supplied TaxPro Postman collection, schemas, and
other API reference files were shared after TaxPro confirmed them. Treat those
files as the confirmed integration contract for this project. The GSTR-1 v4.1
flow uses the `/dec/` transport prefix, so current-profile routes use
`/taxpayerapi/dec/v4.1/returns/gstr1`. Its EVCOTP query parameter is spelled
`ret_periode`, and the request also includes `form_type`. The confirmed `/dec/`
prefix is applied to the common current-profile status route as well.

The workbook is a dated release catalogue, not a current API contract. Its
production entries describe older versions. The local `Backend/.env` now
selects the adapter's `legacy` profile at the user's request. This is a profile
selection, not proof that the 2021 workbook is still TaxPro's approved
production contract for this ASP. Confirm the deployed contract with TaxPro
before live filing.

The workbook mostly lists API names, sample URLs, and versions; it does not
define the full request/response contract, required headers, or all error
responses. For this integration, use the user-supplied TaxPro-confirmed
collection, schemas, and API reference files for those details.

## Production API catalogue in the workbook

| Workflow | API/action | Workbook production route | Listed version |
|---|---|---|---:|
| GST portal authentication | OTP request (`OTPREQUEST`) | `/taxpayerapi/dec/v1.0/authenticate` | 1.0 |
| GST portal authentication | Auth token (`AUTHTOKEN`) | `/taxpayerapi/dec/v1.0/authenticate` | 1.0 |
| GST portal authentication | Refresh token (`REFRESHTOKEN`) | `/taxpayerapi/dec/v1.0/authenticate` | 1.0 |
| GST portal authentication | EVC OTP (`EVCOTP`) | `/taxpayerapi/dec/v1.0/authenticate` | 1.0 |
| Return status | Track status (`RETSTATUS`) | `/taxpayerapi/dec/v1.1/returns` | 0.3 |
| Return status | File details (`FILEDET`) | `/taxpayerapi/dec/v1.1/returns` | 0.3 |
| Filing preparation | GSTR proceed-to-file (`PROCEEDFILE`) | `/taxpayerapi/dec/v1.1/returns/gstr` | 1.1 |
| Filing preparation | Common proceed-to-file (`PROCEEDFILE`) | `/taxpayerapi/dec/v1.0/returns/gstr` | 1.0 |
| GSTR-1 | Save, summary (`RETSUM`), submit, file (`RETFILE`) | `/taxpayerapi/dec/v2.0/returns/gstr1` | 2.1 |
| GSTR-1 reads | B2B, B2CL, B2CS, NIL, TXP, AT, EXP, HSN summary, CDNR/CDNUR, DOCISS | `/taxpayerapi/dec/v2.0/returns/gstr1` | 2.1 |
| GSTR-1 amendments | B2BA, B2CLA, B2CSA, CDNRA, EXPA, ATA, TXPA, CDNURA | `/taxpayerapi/dec/v2.0/returns/gstr1` | 2.0 |
| GSTR-3B | Save, details/summary (`RETSUM`), offset (`RETOFFSET`), file (`RETFILE`) | `/taxpayerapi/dec/v0.3/returns/gstr3b` | 0.3 |
| GSTR-3B validation | GSTR-1 liability auto-calculation and GSTR-3B validation | `/taxpayerapi/dec/v0.3/returns/gstr3b` | 0.3 |
| Return tracking | `RETTRACK` | `/commonapi/v1.0/returns` | 1.0 |

The workbook also lists public Common Search at `/commonapi/v0.3/search` (version
1.1) and Common Authentication at `/commonapi/v0.2/authenticate` (version 1).
Those public API entries are distinct from the taxpayer OTP/auth-token flow.

## Filing sequences indicated by the workbook

These are API sequences to validate with TaxPro, not a claim that every step is
mandatory in the current production contract:

- **GSTR-1 with EVC:** request/verify portal OTP -> save GSTR-1 -> get summary ->
  confirm whether the separate Submit/Proceed-to-File operation is required ->
  request EVC OTP -> file -> check return status/file details.
- **GSTR-3B with EVC:** request/verify portal OTP -> save GSTR-3B -> get 3B
  details/summary -> confirm liability auto-calculation and validation
  requirements -> offset liability (and complete any required payment/challan
  flow) -> request EVC OTP -> file -> check status.
- **Return tracking:** `RETTRACK` is a public filing-history API; it is useful
  for history/status screens but is not itself a filing step.

## Application profile versus this catalogue

`TAXPRO_API_PROFILE` can explicitly select `legacy` or `current` in production.
The `legacy` adapter profile uses GSTR-1 v2.0/API 2.1 and GSTR-3B v0.3,
matching the workbook's listed GSTR-1 release catalogue. The user selected this
catalogue-aligned GSTR-1 version set for the legacy profile.
The current profile uses GSTR-1 v4.1 and GSTR-3B v7.1 routes, which are not
present in the 2021 workbook.

| Flow | Adapter's selected legacy-profile behavior | Workbook comparison / follow-up |
|---|---|---|
| OTP request, auth token, refresh token, EVC OTP | `/taxpayerapi/dec/v1.0/authenticate` | Route/version align with workbook. Confirm method, parameter placement, headers, and token/EVC response fields. |
| GSTR-1 save | `/taxpayerapi/dec/v2.0/returns/gstr1` | Workbook lists version 2.1; route aligns. |
| GSTR-1 summary for EVC | `/taxpayerapi/dec/v2.0/returns/gstr1` | API version header `2.1`, aligned to the selected legacy catalogue. |
| GSTR-1 EVC file | `/taxpayerapi/dec/v2.0/returns/gstr1` | API version header `2.1`; RETFILE body follows the supplied regular/Nil request schema, and filing requires `ack_num`. |
| GSTR-3B save/summary/offset/file | `/taxpayerapi/dec/v0.3/returns/gstr3b` | Route/version align with workbook. Confirm liability/ledger retrieval, payment/challan prerequisites, offset body/response, and filing acknowledgement. |
| Status/file details | `/taxpayerapi/dec/v1.1/returns` | Workbook lists version 0.3. Confirm the response schema/version and wire status verification into filing lifecycle if required. |
| Proceed to file | `/taxpayerapi/dec/v1.0/returns/gstr` | Workbook also lists a GSTR-specific v1.1 route. The supplied TaxPro-confirmed request schema requires `gstin` and `ret_period`; optional `isNil` is `"Y"`/`"N"`. Helper sends `"Y"` for Nil returns. |
| GSTR-3B auto-calculation/validation | No corresponding adapter calls found | Workbook lists both APIs. Confirm whether they are required before offset/file. |

For the **legacy** GSTR-1 profile, RETSAVE, RETSUM, and RETFILE use
`/taxpayerapi/dec/v2.0/returns/gstr1` with `api_version: 2.1`, matching the
selected catalogue. For the **current** GSTR-1 profile, the adapter uses the TaxPro-confirmed
`/taxpayerapi/dec/v4.1/returns/gstr1` route for RETSUM, EVCOTP, and RETFILE,
along with the collection's EVCOTP `ret_periode` and `form_type` query fields.
Current-profile EVCOTP does not retry alternate paths/parameter spellings,
avoiding duplicate OTP dispatches if a request succeeds but its response is
lost. The current profile is not selected by this legacy alignment.

The application currently has a provider helper for `RETSTATUS` and `FILEDET`,
but filing success is primarily recorded from the immediate filing response.
Confirm whether TaxPro filing is synchronous; otherwise persist the provider
reference and poll status before marking a return as filed.

`TAXPRO_GSTR1_ACTION_REQUIRED` is required only for the `current` profile. The
adapter loads it but does not currently use it to select or change an outbound
request.

## Payload schemas supplied with the API reference

The separately supplied GSTR-1 schemas support these checks:

- GSTR-1 save payload requires `gstin` and `fp`; the schema defines invoice,
  nil-supply, HSN, and document-issued sections.
- GSTR-1 RETFILE bodies are restricted to the supplied regular summary variant
  (`gstin`, `ret_period`, `chksum`, optional `smryTyp`/`newSumFlag`, `sec_sum`)
  or Nil variant (`gstin`, `ret_period`, `isnil: "Y"`). The EVC flow rejects
  mismatched summaries and does not send a RETFILE request without PAN and OTP.
  Legacy EVC signatures continue to use the exact raw RETSUM response; current
  profile signatures use the serialized RETFILE body.
- GSTR-1 file response requires `ack_num`.
- Proceed-to-file request requires `gstin` and `ret_period`, with optional
  `isNil` enum `"Y"`/`"N"`; its response permits `reference_id` or
  `isSync: "Y"`.
- Return-status schemas differ: the GSTR-1-specific schema uses
  `arn_no`/`errorReport`, while the generic schema uses `status_cd`/`form_typ`/
  `error_report`. Select the schema by the exact endpoint/version.
- Nil and HSN response schemas can inform their respective payload/response
  mappers, but do not by themselves establish the endpoint, action, or API
  version.

The Nil GSTR-1 filing path builds the RETFILE body from the portal's
summary; it does not submit the JSON downloadable by
`Frontend/src/components/NilReturnModal.jsx`. Keep the download labelled as a
local preview until it is validated against the applicable API schema.

## Production prerequisites to confirm

Before any live filing:

1. Obtain TaxPro's current production API collection/manual for this ASP,
   including approved transport (`/dec/` or otherwise), exact routes/versions,
   methods, query/header/body fields, and response/error examples.
2. Confirm current GSTR-1 and GSTR-3B versions, EVC request/filing signature
   algorithm, whether `PROCEEDFILE` is required, and whether filing responses
   are synchronous or need status polling.
3. Confirm GSTR-3B liability/ledger, offset, cash payment/challan, and
   auto-calculation/validation steps.
4. Confirm ASP onboarding requirements: registered ASP GSTIN, allowlisted
   deployment IP, signing certificate/private-key registration, credential
   rotation, and sandbox/production access.
5. Set `TAXPRO_GSTR1_ACTION_REQUIRED` only to the value TaxPro confirms when
   using the current profile. Keep live filing disabled until selected routes
   and `/dec/` production approval are confirmed.
