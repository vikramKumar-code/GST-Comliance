# Samples still needed

For each item: run the call in Postman (GSTIN/username pair A: 33AANCS2882A1ZG / TN_NT2.2265), copy the **raw response body**, save it to a temporary file outside the repo (for example `raw.json`), run the sanitize script, check the result, then delete `raw.json`.

## 1. authtoken-success.json
Call: `.../authenticate?action=AUTHTOKEN&...&OTP=575757`
Why: shows the name of the token field and any expiry field. Needed for the Session model and `verifyOtp`.
Also note in README: how long the token stays valid (try the same token again after a few minutes).

## 2. gstr1-b2b.json
Call: `.../v2.1/returns/gstr1?action=B2B&...&ret_period=022022`
Why: shape of sales data. Needed for the Dashboard sales figures and the GSTR-1 table.
If it returns an error, save the error as `gstr1-b2b-error.json` and note the code.

## 3. gstr3b-retsum.json
Call: `.../v0.3/returns/gstr3b?action=RETSUM&...&ret_period=022022`
Why: shape of tax liability and ITC. Needed for taxPayable and the GSTR-3B table.

## 4. gstr2b-success.json
Call: `.../v1.0/returns/gstr2b?action=GET2B&...&ret_period=XXXXXX&rtnprd=XXXXXX`
Try periods 022022, 032022, 042022, 122021. Save the first one that returns data.
If none do, ask TaxPro which sandbox GSTIN and period have GSTR-2B data.

## 5. Optional
- `gstr2a-b2b.json` (period 082017)
- Any other error you see: save it as `error-<code>.json`

## Notes to write down (put them in samples/README.md)
- Name of the token field and token lifetime
- Which call produced AUTH4041 and what fixed it
- Any call that timed out
