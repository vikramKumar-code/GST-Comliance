const ApiError = require('../../utils/apiError');

/**
 * Official GSTN / TaxPro GSTR-1, Filing, EVC, DSC, and Section Invoice Error Catalog.
 * Maps documented government error codes to semantic, user-facing ApiError instances
 * with precise HTTP status codes and CA-grade resolution guidance.
 */
const GSTN_ERROR_CATALOG = {
  // ---------------------------------------------------------------------------
  // 1. Headers, Authentication, Session & GSP Credentials
  // ---------------------------------------------------------------------------
  'RT-1ABC1002': {
    code: 'INVALID_GSTIN',
    statusCode: 400,
    message: 'GST Portal Error (RT-1ABC1002): Taxpayer GSTIN is null or empty. Please select an active GSTIN.'
  },
  'RET11400': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'Could not complete the request. Please try again.'
  },
  'RET11402': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GST Portal Error (RET11402): Unauthorized User. Access restricted on GST portal.'
  },
  'RET11403': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11403): Invalid API request structure.'
  },
  'RET11404': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11404): State code is not valid.'
  },
  'RET11407': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (RET11407): Auth token is invalid. Please verify OTP again.'
  },
  'RET13001': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (RET13001): Portal session or Auth Token has expired. Please verify OTP again.'
  },
  'RET11408': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11408): Invalid Transaction ID (txn).'
  },
  'RET11409': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11409): GST portal username is not valid for this GSTIN.'
  },
  'RET11410': {
    code: 'INVALID_GSTIN',
    statusCode: 400,
    message: 'GST Portal Error (RET11410): Invalid GSTIN format or taxpayer not found.'
  },
  'RET11420': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11420): Invalid API header value.'
  },
  'AUTH113': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH113): Invalid Return Period format. Please use MMYYYY.'
  },
  'AUTH141': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH141): Mandatory parameters missing - GSTIN or Return Period.'
  },
  'AUTH143': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH143): Invalid request parameters. Please verify the return period (MMYYYY).'
  },
  'AUTH150': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH150): GST Practitioner is not a valid or authorized user.'
  },
  'AUTH151': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH151): You are not authorized to access GSTR-1 for this return period.'
  },
  'AUTH154': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH154): You are not allowed to access returns for selected tax period.'
  },
  'AUTH158': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (AUTH158): Invalid Auth token or username. Please verify OTP again.'
  },
  'GEN4040': {
    code: 'DATA_NOT_AVAILABLE',
    statusCode: 404,
    message: 'GST Portal Error (GEN4040): Requested return endpoint/resource not found on portal.'
  },
  'AUT4031': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GSP Error (AUT4031): GSP Client ID is null. Please verify ASP configuration.'
  },
  'AUT4032': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GSP Error (AUT4032): GSP Client-Secret is null. Please verify ASP configuration.'
  },
  'AUT4033': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GSP Error (AUT4033): Invalid GSP Client ID. Please verify ASP configuration.'
  },
  'AUT4034': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GSP Error (AUT4034): Invalid GSP Client-Secret. Please verify ASP configuration.'
  },
  'AUTH001': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GST Portal Error (AUTH001): Invalid Client ID. Please check and try again.'
  },
  'AUTH002': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH002): API access is disabled for this GSTIN or GSP is not authorized. Please login to gst.gov.in > My Profile > Manage API Access and enable API access.'
  },
  'AUTH003': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH003): API access is restricted for this taxpayer status. Please verify GSTIN status on the GST portal.'
  },
  'GEN5001': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (GEN5001): Missing mandatory parameters in request.'
  },
  'GEN5007': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (GEN5007): Malformed request format.'
  },
  'RET192111': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192111): Mismatch between request header and payload parameters (GSTIN or Return Period).'
  },
  'AUTH403': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'Could not complete the request. Please try again.'
  },
  'AUTH4033': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (AUTH4033): Invalid GST session. Please verify OTP to create a new session.'
  },
  'AUTH4035': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH4035): Invalid Parameter action in request body.'
  },
  'AUTH4037': {
    code: 'PROVIDER_AUTH',
    statusCode: 403,
    message: 'GST Portal Error (AUTH4037): API access is not available or user session duration is less than or equal to auth token duration. Enable API access under Manage API Access on GST portal.'
  },
  'AUTH4041': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH4041): Invalid Parameter state-cd in request header. State code must match first 2 digits of GSTIN.'
  },
  'AUTH4042': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (AUTH4042): RefreshToken session cannot be extended. Please request a new OTP.'
  },
  'TEC4001': {
    code: 'PROVIDER_ERROR',
    statusCode: 503,
    message: 'GST Portal Error (TEC4001): Server is currently unavailable. Token/OTP generation failed on GST portal. Please retry after some time.'
  },
  'TEC4002': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (TEC4002): Invalid Data Format. Please verify AppKey and ensure latest public key has been used for encryption.'
  },

  // ---------------------------------------------------------------------------
  // 1.1 Official GSTN / TaxPro EVC & Signatory OTP Codes
  // ---------------------------------------------------------------------------
  'OTP0001': {
    code: 'INVALID_GSTIN',
    statusCode: 400,
    message: 'GST Portal Error (OTP0001): GSTIN is null or missing in OTP request.'
  },
  'OTP0002': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (OTP0002): URL parameter GSTIN and header GSTIN do not match.'
  },
  'OTP0003': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (OTP0003): PAN number of Authorized Signatory is null or missing for EVC OTP.'
  },
  'OTP0004': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (OTP0004): Form type is null or missing. Must be GSTR1 or GSTR3B.'
  },
  'OTP0005': {
    code: 'INVALID_GSTIN',
    statusCode: 400,
    message: 'GST Portal Error (OTP0005): Invalid GSTIN format. Must be 15 alphanumeric characters.'
  },
  'OTP0006': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (OTP0006): PAN number does not match the Authorized Signatory registered on GST portal for this GSTIN.'
  },
  'OTP0007': {
    code: 'PROVIDER_ERROR',
    statusCode: 503,
    message: 'GST Portal Error (OTP0007): OTP generation failed as government OTP server is down. Please contact GST Support.'
  },
  'OTP0008': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (OTP0008): Auth token is null. Active GST portal session is required.'
  },
  'OTP0009': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (OTP0009): Username is null or missing in OTP request.'
  },
  'OTP0010': {
    code: 'PROVIDER_AUTH',
    statusCode: 403,
    message: 'GST Portal Error (OTP0010): User is not registered as an Authorized Signatory for given PAN and GSTIN.'
  },
  'OTP0011': {
    code: 'SESSION_EXPIRED',
    statusCode: 401,
    message: 'GST Portal Error (OTP0011): User session is null for provided auth-token and username. Please generate a new OTP session.'
  },

  // ---------------------------------------------------------------------------
  // 2. Filing, Submissions, Summary, Status & Deadlines
  // ---------------------------------------------------------------------------
  'AUTH117': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (AUTH117): GSTR-1 is already filed for current period.'
  },
  'RT_FIL_02': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RT_FIL_02): GSTR-1 is already filed for current period.'
  },
  'AUTH119': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (AUTH119): GSTR-3B is not filed for previous period. Please file previous GSTR-3B first.'
  },
  'RET12521': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET12521): GSTR-1 is already submitted for current period.'
  },
  'RTN_17': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTN_17): Invoices are already submitted for current period.'
  },
  'RET12523': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET12523): GSTR-1 submit is already in progress for current period. Please wait.'
  },
  'RET191251': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191251): RESET is under process on GST portal. Please try again after 1-2 minutes.'
  },
  'RET192411': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192411): Save is under progress on GST portal. Please try again after 1-2 minutes.'
  },
  'RET192412': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192412): Summary generation is under progress on GST portal. Please try again after 1-2 minutes.'
  },
  'RET192414': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192414): Move/relocation is under progress on GST portal. Please try again later.'
  },
  'RET192407': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192407): Submit is not allowed after IFF cut-off date (13th) for selected return period.'
  },
  'RET192408': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192408): Complete filing of already submitted GSTR-1/IFF for prior period before submitting current return.'
  },
  'RET192409': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192409): As per Rule 59(6), GSTR-1/IFF cannot be Submitted because preceding GSTR-3B is pending filing. File pending GSTR-3B first.'
  },
  'RET192410': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192410): Cumulative value exceeds ₹50 Lakhs limit prescribed under Rule 59(2) for IFF. Report remaining records in subsequent IFF or quarterly GSTR-1.'
  },
  'RET192413': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192413): Summary generation is not allowed after IFF cut-off date of selected period.'
  },
  'RET192417': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192417): Please reset saved records in IFF for Month 1 / Month 2 before submitting quarterly GSTR-1.'
  },
  'RET192420': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192420): GSTR-1/IFF cannot be Submitted as previous period GSTR-1 is not filed. Sequential filing is mandatory.'
  },
  'RET192421': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192421): GSTR-1/IFF cannot be Submitted because preceding GSTR-1 and GSTR-3B returns are pending filing.'
  },
  'RTN_11': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTN_11): GSTR-1 submit is under process. Please check back shortly.'
  },
  'RET12590': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET12590): GSTR-1 Save/Action on Counterparty Invoices/Submit are not allowed for current date. Please visit gst.gov.in for filing timelines.'
  },
  'RT_FIL_10': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RT_FIL_10): Please submit invoices before filing return.'
  },
  'RT_FIL_31': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RT_FIL_31): Taxpayer is not authorized to file with EVC option (Companies and LLPs must file using Digital Signature Certificate - DSC).'
  },
  'RTN_15': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTN_15): Returns still under processing on government portal. Please check back later.'
  },
  'RTN_24': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTN_24): File generation is in progress. Please try after some time.'
  },
  'RTN_25': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'GST Portal Error (RTN_25): Error in file generation on GST portal.'
  },
  'RTN_27': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTN_27): The User is not a Registered Normal Taxpayer.'
  },
  'RTN_31': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTN_31): File is generated and ready for download.'
  },
  'RTN_32': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTN_32): Download request already in progress. Please wait for file generation.'
  },
  'RET09001': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET09001): Latest summary is not available. Please generate summary on GST portal and try again.'
  },
  'RET09002': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET09002): Summary generation is in progress on GST portal. Please try again after 1-2 minutes.'
  },
  'RET09004': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET09004): Latest Summary is not available. Please generate summary before submitting or filing return.'
  },
  'RET09005': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET09005): Summary generation is in progress. Please try submitting after 1-2 minutes.'
  },
  'RET09006': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET09006): Please provide generate_summary flag as "Y" for summary generation.'
  },
  'RET09007': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET09007): Summary is already up to date. No changes have been made since last generation.'
  },
  'RET09008': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET09008): GSTR-1 has either been filed or submitted. Summary generation request cannot be processed.'
  },
  'RET091210': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET091210): Invalid Summary Type.'
  },
  'RT_FIL_09': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RT_FIL_09): Signed summary is not the latest one. Please generate and re-sign latest summary.'
  },
  'RT_FIL_25': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RT_FIL_25): Summary checksum generation is in progress. Please try after some time.'
  },
  'RET13501': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET13501): Checksum mismatch while filing and submitting return.'
  },
  'RTN_FIL_30': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTN_FIL_30): Signed summary data does not match encoded hash summary.'
  },
  'RET13504': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET13504): Unable to process request. GST portal is busy, please try after some time.'
  },
  'RET13505': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET13505): System failure on government portal. Please try again later.'
  },
  'RET13508': {
    code: 'DATA_NOT_AVAILABLE',
    statusCode: 404,
    message: 'GST Portal Notice (RET13508): No details found for the provided inputs.'
  },
  'RET13509': {
    code: 'DATA_NOT_AVAILABLE',
    statusCode: 404,
    message: 'GST Portal Notice (RET13509): No invoices found for the provided inputs or period.'
  },
  'RET13511': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET13511): Date format entered is invalid.'
  },
  'RTN_02': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTN_02): Invalid return date.'
  },

  // ---------------------------------------------------------------------------
  // 3. DSC & Signatures
  // ---------------------------------------------------------------------------
  'RET13506': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET13506): OTP is either expired or incorrect. Please request a fresh OTP and try again.'
  },
  'RET13507': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET13507): Mismatch of signed data and payload.'
  },
  'RT_FIL_24': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'GST Portal Error (RT_FIL_24): Error occurred while saving DSC data. Please try again.'
  },
  'RTDSC04': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTDSC04): PAN number or Digital Signature is invalid.'
  },
  'RTDSC05': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RTDSC05): DSC verification failed on government portal. Please try after some time.'
  },
  'RT_FIL_017': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RT_FIL_017): User is not registered with any DSC on GST portal.'
  },
  'RT_FIL_018': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RT_FIL_018): Signatory PAN is not registered for the given GSTIN.'
  },
  'RTN_FIL_28': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTN_FIL_28): Digital Signature Certificate (DSC) has expired.'
  },
  'RTN_FIL_29': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTN_FIL_29): Digital Signature Certificate (DSC) is not valid.'
  },

  // ---------------------------------------------------------------------------
  // 4. Payload, Parsing, Encryption & System
  // ---------------------------------------------------------------------------
  'RET12505': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET12505): Corrupted API payload data.'
  },
  'RET191101': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191101): Decrypt request failed. Values entered are null.'
  },
  'RET191103': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191103): Corrupted data or file payload.'
  },
  'RET191104': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191104): GstRequest payload is null.'
  },
  'RET191106': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191106): Error in JSON structure validation.'
  },
  'RET191136': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191136): Either Return period or GSTIN from header and payload do not match.'
  },
  'RET191138': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'GST Portal Error (RET191138): Error in processing request on government portal.'
  },
  'RET191139': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191139): Decoded payload is null.'
  },
  'RET191140': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191140): Error while reading file payload.'
  },
  'RET191141': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'GST Portal Error (RET191141): Exception while getting data from portal storage/database.'
  },
  'RET191333': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'GST Portal Error (RET191333): Exception while retrieving data from portal cache.'
  },
  'RET191143': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191143): Mismatch noted in payload checksum.'
  },
  'RET191164': {
    code: 'PROVIDER_ERROR',
    statusCode: 502,
    message: 'GST Portal Error (RET191164): System component failure on government portal.'
  },
  'RET191165': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191165): Request payload mapping failure.'
  },
  'RET191166': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191166): Decryption / decoding failed on GST portal.'
  },
  'RET191191': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET191191): Processing retry timeout on GST portal.'
  },
  'RET191192': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET191192): Processing retry timeout. Failed to process sections.'
  },

  // ---------------------------------------------------------------------------
  // 5. GSTR-1 Invoices, Items, HSN, POS, Rates & Business Validations
  // ---------------------------------------------------------------------------
  'RET191107': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191107): At least one line item must be present in the invoice.'
  },
  'RET191110': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191110): Approval date for the given GSTIN is not present.'
  },
  'RET191111': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191111): Invoice number already exists in GSTR-1 for this period. Please enter correct invoice number.'
  },
  'RET191112': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191112): Enter the correct 2-digit State code in Place of Supply (POS).'
  },
  'RET191314': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191314): Counterparty GSTIN cannot be same as Supplier GSTIN.'
  },
  'RET191315': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191315): You are not authorized to access GSTR-1 for this return period.'
  },
  'RET191113': {
    code: 'INVALID_GSTIN',
    statusCode: 400,
    message: 'GST Portal Error (RET191113): The GSTIN is invalid. Please enter a valid 15-character GSTIN.'
  },
  'RET191318': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191318): Invoice date cannot be older than registration date of supplier GSTIN.'
  },
  'RET191114': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191114): Invoice date cannot be later than return period or older than 18 months.'
  },
  'RET191115': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191115): Invoice has linked Credit/Debit Note(s). Delete linked note(s) before deleting invoice.'
  },
  'RET191117': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191117): Duplicate tax rate found in the same invoice. Please aggregate line items having the same rate.'
  },
  'RET191321': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191321): Combination of HSN, Description, and UQC cannot be repeated in HSN summary. Please aggregate records.'
  },
  'RET191119': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191119): Receiver GSTIN does not match original invoice records.'
  },
  'RET191120': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191120): Date is invalid. Revised invoice date cannot be later than last day of original tax period.'
  },
  'RET191121': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191121): Revised Invoice number already exists in GSTR-1 for this period.'
  },
  'RET191122': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191122): Enter the correct recipient State Code.'
  },
  'RET191123': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191123): Note number already exists for this return period.'
  },
  'RET191124': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191124): Invalid original invoice details. Original invoice cannot be tracked. Verify invoice number and date.'
  },
  'RET191125': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191125): Counterparty of Invoice and Credit/Debit Note are different. Enter valid GSTIN or State code.'
  },
  'RET191126': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191126): Note date is invalid. Date cannot exceed current tax period or be older than 18 months.'
  },
  'RET191324': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191324): Note date cannot be prior to GST registration date.'
  },
  'RET191131': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191131): Either GSTIN or return period is missing.'
  },
  'RET191133': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191133): Invoice already exists with same or different CTIN. Delete existing invoice and upload again.'
  },
  'RET191134': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191134): Invoice may already exist in another section. Enter correct invoice number or delete existing invoice.'
  },
  'RET191330': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191330): Credit/Debit Note number may already exist in another section. Enter correctly or delete existing note.'
  },
  'RET191135': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191135): Invoice already exists with different state code. Delete existing invoice and upload again.'
  },
  'RET191148': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191148): No section data or Gross Turnover is available to process request.'
  },
  'RET191150': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191150): IGST is required for interstate supply. Remove CGST and SGST.'
  },
  'RET191301': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191301): CGST and SGST are required for intrastate supply. Remove IGST.'
  },
  'RET191302': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191302): CGST and SGST should not be present for INTER-state supply.'
  },
  'RET191303': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191303): CGST and SGST values are mandatory for INTRA-state supply.'
  },
  'RET191304': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191304): IGST should not be present for INTRA-state supply.'
  },
  'RET191305': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191305): IGST is mandatory for INTER-state supply.'
  },
  'RET191306': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191306): Error while trying to determine whether invoice is intrastate or interstate supply.'
  },
  'RET191307': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191307): IGST must be present for With-Pay export transactions.'
  },
  'RET191308': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191308): IGST is required for With-Pay Exports transactions. Remove CGST and SGST.'
  },
  'RET191309': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191309): Tax amounts (IGST, CGST, SGST) must not be present for Without-Pay export transactions.'
  },
  'RET191310': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191310): IGST is required for Deemed Exports transactions. Remove CGST and SGST.'
  },
  'RET191151': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191151): Credit/Debit note date must match or be after original invoice date.'
  },
  'RET191152': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191152): Invalid E-commerce Operator GSTIN (ETIN).'
  },
  'RET191311': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191311): E-commerce GSTIN (ETIN) cannot be same as Supplier GSTIN.'
  },
  'RET191312': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191312): Enter correct Ecommerce GSTIN for B2CS supplies made through e-commerce operator.'
  },
  'RET191313': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191313): Ecommerce GSTIN cannot be present for B2CS supplies made through non e-commerce operator.'
  },
  'RET191153': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191153): Original Invoice is Intra-state. Note must be of the same supply type.'
  },
  'RET191154': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191154): Original Invoice is Inter-state. Note must be of the same supply type.'
  },
  'RET191157': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191157): Original data for B2CS does not exist.'
  },
  'RET191158': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191158): Original invoice date entered is invalid.'
  },
  'RET191159': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191159): Original credit/debit note cannot be tracked. Verify note number and date.'
  },
  // ✅ FIX: Merged duplicate RET191316 (combining both error scenarios)
  'RET191316': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191316): Original note is not amendable or invoice type can be SEWP/SEWOP only when receiver is registered as SEZ. Enter different note number and date.'
  },
  // ✅ FIX: Merged duplicate RET191317 (combining both error scenarios)
  'RET191317': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191317): Revised note is duplicate or for documents pertaining to previous financial year, only Shipping Bill Details can be amended. Enter different note number and date.'
  },
  'RET191160': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191160): Supplier state code and POS state code cannot be same for B2CL supplies.'
  },
  'RET191168': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191168): Original data for Advance Tax (AT) cannot be tracked.'
  },
  'RET191170': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191170): File invoice before accepting or rejecting.'
  },
  'RET191171': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191171): File note before accepting or rejecting.'
  },
  'RET191172': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191172): Item number does not exist in payload.'
  },
  'RET191175': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191175): Enter correct tax rate as per official GST rate list (0%, 0.1%, 0.25%, 1.5%, 3%, 5%, 12%, 18%, 28%).'
  },
  'RET191176': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191176): Shipping bill date must be on or after invoice date and on or before today.'
  },
  'RET191178': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191178): Supplier state code and Place of Supply (POS) cannot be different for intrastate supply.'
  },
  'RET191179': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191179): Supplier state code and Place of Supply (POS) cannot be same for interstate supply.'
  },
  'RET191180': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191180): B2CL invoice value cannot be less than ₹2.5 Lakhs. For lower values, report under B2CS.'
  },
  'RET191181': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191181): Invoice type does not match original invoice type.'
  },
  'RET191182': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191182): Submit request is in progress. Upload cannot be processed.'
  },
  'RET191183': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191183): GSTR-1 is already filed or submitted. Upload cannot be processed.'
  },
  'RET191184': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191184): Invoice date must be prior to 1 July 2017 for Pre-GST.'
  },
  'RET191185': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191185): Return period cannot be a future date. Enter valid return period.'
  },
  'RET191188': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191188): Invalid Credit/Debit Note reason code.'
  },
  'RET191189': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191189): SEZ supplies must always be treated as interstate supply (IGST).'
  },
  'RET191190': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191190): Duplicate Invoice number found in upload payload. Please correct invoice numbers.'
  },
  'RET191193': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191193): Refund note type is not permitted.'
  },
  'RET191194': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191194): Either HSN code or item Description is mandatory.'
  },
  'RET191195': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191195): The Unit Quantity Code (UQC) entered is not valid.'
  },
  'RET191196': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191196): Revised invoice number is not valid.'
  },
  'RET191197': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191197): Original data for Tax Paid (TXPD) cannot be tracked.'
  },
  'RET191198': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191198): Data cannot be amended for the same return period.'
  },
  'RET191199': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191199): Invoice type cannot be changed in Credit/Debit Note amendments.'
  },
  'RET191200': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191200): Supply type cannot be changed for saved Credit/Debit Note.'
  },
  'RET191202': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191202): Invoice date should be before note date and within return period.'
  },
  'RET191203': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191203): Invoice number or invoice type is invalid.'
  },
  'RET191204': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191204): Please select filing preference first before proceeding.'
  },
  'RET191205': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191205): Documents pertaining to previous financial year cannot be added or amended now. Delete records before filing.'
  },

  // ---------------------------------------------------------------------------
  // 6. Amendments, Limits, Dates & Recipient Restrictions
  // ---------------------------------------------------------------------------
  'AUTH157': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH157): Invalid ip-usr in request header.'
  },
  'RET01203': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET01203): GSTIN in request does not match active session GSTIN.'
  },
  'RET191326': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191326): Note already exists with different CTIN or same CTIN. Please delete the existing note and upload again.'
  },
  'RET191327': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191327): B2B amendment can be done only once. Please delete the amendment and then add amendment again.'
  },
  'RET191328': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191328): CDN amendment can be done only once. Please delete the amendment and then add amendment again.'
  },
  'RET191338': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191338): B2CS Amendment already exists for the original month in different return period.'
  },
  'RET191342': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191342): Advance Tax (AT) Amendment already exists for the original month in different return period.'
  },
  'RET191347': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191347): Tax Paid (TXPD) Amendment already exists for the original month in different return period.'
  },
  'RTNSUPECO-02': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNSUPECO-02): The record has already been amended. Kindly retry with other record.'
  },
  'RET191221': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191221): Document date cannot be on or after implementation date of new returns.'
  },
  'RET191222': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191222): GSTR-1 for the period in which document was originally reported has not been filed. Please file it before amendment.'
  },
  'RET191223': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191223): GSTR-1 for the period to which the document pertains has not been filed. Please add document in that period GSTR-1.'
  },
  'RET191224': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191224): You are not allowed to add invoice for a disabled section.'
  },
  'RET191227': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191227): State Code 96 (Foreign Country) cannot be selected by Composition or UIN taxpayers.'
  },
  'RET191229': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191229): State code of Supplier and POS cannot be same for B2CL section in a credit/debit note.'
  },
  'RET191230': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191230): Note type can be SEWP/SEWOP only when receiver is SEZ unit/developer.'
  },
  'RET191231': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191231): Note type can be Deemed Exports only if recipient is a normal or casual taxpayer.'
  },
  'RET191232': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191232): Note type cannot be SEWP/SEWOP if recipient is a composition/UIN taxpayer.'
  },
  'RET191235': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191235): Reverse charge flag cannot be "Y" for SEZ recipient.'
  },
  'RET191236': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191236): Reverse charge flag cannot be "Y" for Deemed Exports (DE).'
  },
  'RET191237': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191237): Reverse charge flag cannot be "Y" for ISD recipient.'
  },
  'RET191238': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191238): SEZ user cannot select Deemed Exports (DE) as note type.'
  },
  'RET191239': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191239): Zero items added or added with zero value.'
  },
  'RET191240': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191240): Invalid receiver GSTIN or Place of Supply (POS) selected.'
  },
  'RET191242': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191242): Non-Resident Taxable Person (NRTP) receiver cannot be of type SEZ, Bonded Warehouse, or Deemed Exports.'
  },
  'RET191243': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191243): Reverse charge flag cannot be "Y" for NRTP recipient.'
  },
  'RET191244': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191244): Tax amount cannot be negative for positive taxable value, and vice versa.'
  },
  'RET191245': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191245): Original Note date entered is invalid.'
  },
  'RET191252': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191252): Save is not allowed after IFF cut-off date (13th) for selected return period.'
  },
  'RET191253': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191253): For quarterly filing (QRMP), only B2B, CDNR, B2BA, CDNRA, and ECOM tables are allowed in IFF.'
  },
  'RET191216': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191216): Invoice date cannot be greater than effective date of GST registration cancellation.'
  },
  'RET191217': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191217): Note date cannot be greater than effective date of GST registration cancellation.'
  },
  'RET191262': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191262): Reverse charge is not allowed for UIN taxpayer.'
  },
  'RET191265': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191265): Request failed. Please "Reset" previously saved GSTR-1/IFF on portal and try again.'
  },
  'RET191266': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191266): Total IGST tax amount should be greater than zero for interstate supply.'
  },
  'RET191215': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191215): ISD receiver type cannot be SEZ, Sales from Bonded Warehouse, or Deemed Exports.'
  },
  'RET191334': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191334): Reverse charge flag cannot be "N" for Customs Bonded Warehouse (CBW).'
  },
  'RET191339': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191339): Original note is not amendable. Please enter a different note number and date.'
  },
  'RET191340': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191340): Revised note is duplicate. Please enter different note number and date.'
  },
  'RET191344': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191344): B2CS for SEZ GSTIN must be treated as interstate supply.'
  },
  'RET191348': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191348): Invalid invoice type. Please enter valid invoice type matching recipient category.'
  },
  'RET191349': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191349): The HSN code entered is not valid as per GST HSN master list.'
  },
  'RET191350': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191350): Length of HSN code is not valid as per AATO rules (4 digits for turnover ≤ ₹5 Cr, 6 digits for turnover > ₹5 Cr).'
  },
  'RET191352': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191352): Combination of HSN, UQC and Rate cannot be repeated in HSN summary. Please aggregate records.'
  },
  'RET191353': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191353): The Unit Quantity Code (UQC) entered is not valid.'
  },
  'RET191355': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191355): The Quantity entered is not valid.'
  },
  'RET191356': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191356): Tax Rate cannot be empty in HSN summary.'
  },
  'RET191357': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191357): Tax Rate field is not applicable in HSN data for specified return period.'
  },
  'RET192501': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192501): No records found in Table 12. Add HSN summary records in Table-12 corresponding to saved B2B, EXP, and CDNR supplies.'
  },
  'RET192502': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192502): No records found in Table 12. Add HSN summary records in Table-12 corresponding to all saved outward supplies.'
  },
  'RET192503': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192503): Table 12 format outdated. Delete legacy records prior to 01-Apr-2021 and enter details in revised HSN format.'
  },
  'RET191358': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191358): Invoice type cannot be Deemed Exports if recipient is a composition or UIN taxpayer.'
  },
  'RET191359': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET191359): This record number has been amended but not filed in GSTR-1/IFF. Use it after amended return is filed.'
  },
  'RET191360': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191360): GSTIN of receiver is inactive or cancelled on GST portal.'
  },
  'RET191361': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191361): Please enter Integrated Tax, Central Tax, or State Tax as applicable.'
  },
  'RET191362': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191362): Please enter State/UT Tax amount.'
  },
  'RET191363': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191363): Please enter Central Tax amount.'
  },
  'RET191364': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191364): Reverse charge is not allowed for TDS taxpayer recipient.'
  },
  'RET191214': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191214): Mismatch in return period (ret_period) or GSTIN in request header and payload.'
  },
  'RET12563': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET12563): CGST amount must equal SGST amount for intrastate transactions.'
  },
  'RET191137': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191137): Tax value must be positive or negative matching the net supply value.'
  },

  // ---------------------------------------------------------------------------
  // 7. Table 14 & 15 E-Commerce Operator (ECO) & IMS
  // ---------------------------------------------------------------------------
  'RETR10001': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETR10001): User GSTIN and Supplier GSTIN must be different in E-commerce (ECOM) section.'
  },
  'RETR10002': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETR10002): Supplier GSTIN and Recipient GSTIN must be different in E-commerce (ECOM) section.'
  },
  'RET12562': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET12562): Invalid TCS GSTIN entered.'
  },
  'RET12565': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET12565): This E-Commerce Operator (ECO) GSTIN already exists in current tax period.'
  },
  'RTNECO-01': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RTNECO-01): Supplies made through E-Commerce Operators is not applicable for selected return period.'
  },
  'RTNECO-03': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECO-03): Tax value should be positive or negative as per net value of supplies.'
  },
  'RET12564': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET12564): Invoice/document already exists in another table of GSTR-1. Delete existing document and upload again.'
  },
  'RET191116': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET191116): Document already exists in another section of Table 15 in GSTR-1.'
  },
  'RTNECOM15-01': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-01): Document already exists in another table of GSTR-1. Please delete existing record first.'
  },
  'RTNECOM15-02': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-02): Document number already exists in another section of Table 15 in GSTR-1.'
  },
  'RTNECOM15-03': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-03): Invoice/document already exists in Table 15 in GSTR-1 for this return period.'
  },
  'RTNECOM15-04': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-04): Document already exists in another section of Table 15 in GSTR-1.'
  },
  'RTNECOM15-05': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-05): Supply type for SEZ GSTIN in Table 15 must be interstate supply.'
  },
  'RTNECOM15-06': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-06): Invoice already exists with different STIN/RTIN. Delete existing invoice and upload again.'
  },
  'RTNECOM15-07': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-07): Invoice exists with different STIN/RTIN. Enter same STIN/RTIN and edit again.'
  },
  'RTNECOM15-08': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-08): E-Commerce GSTIN, Supplier GSTIN, and Counterparty GSTIN cannot be identical.'
  },
  'RTNECOM15-09': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-09): Tax value must always be positive for B2B and URP2B sections in Table 15.'
  },
  'RTNECOM15-10': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RTNECOM15-10): Mandatory parameters (ETIN, STIN, RTIN) missing in Table 15 payload.'
  },
  'RETECOMA15-01': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETECOMA15-01): Supplier GSTIN (STIN) is invalid in Table 15 Amendment.'
  },
  'RETECOMA15-02': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RETECOMA15-02): Supplies through E-Commerce Operators is not applicable for amendment return period.'
  },
  'RETECOMA15-03': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RETECOMA15-03): Supplies through E-Commerce Operators is not applicable for original return period.'
  },
  'RETECOMA15-04': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RETECOMA15-04): ECOM_B2CA Amendment already exists for original month in different return period.'
  },
  'RETECOMA15-06': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETECOMA15-06): The provided STIN and rate is already present in given return period.'
  },
  'RET291365': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET291365): Error occurred in Invoice Management System (IMS). Please review invoice status in IMS on gst.gov.in.'
  },

  // ---------------------------------------------------------------------------
  // 8. System Failures (503), API Versions & Headers
  // ---------------------------------------------------------------------------
  'RET11401': {
    code: 'PROVIDER_AUTH',
    statusCode: 502,
    message: 'GST Portal Error (RET11401): API Authentication Failed.'
  },
  'RET11405': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11405): Invalid API Request Parameters.'
  },
  'RET11406': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET11406): Malformed API Request format.'
  },
  'RET12501': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET12501): System Failure on government portal. Please try again later.'
  },
  'RET12502': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET12502): System Failure on government portal. Please try again later.'
  },
  'RET12503': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET12503): System Failure on government portal. Please try again later.'
  },
  'RET12504': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET12504): System Failure on government portal. Please try again later.'
  },
  'RET13502': {
    code: 'PROVIDER_DOWN',
    statusCode: 503,
    message: 'GST Portal Error (RET13502): System Failure on government portal. Please try again later.'
  },
  'RETHV001': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV001): Invalid api_version in request header.'
  },
  'RETHV002': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV002): Invalid userrole in request header.'
  },
  'RETHV017': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV017): Invalid return type in request header.'
  },
  'RETHV019': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV019): Header Parameters - api_version missing or empty.'
  },
  'RETHV020': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV020): Header Parameters - User Role missing or empty.'
  },
  'RETHV021': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV021): Header Parameters - Return Type missing or empty.'
  },
  'RETHV022': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETHV022): Header Parameters - Return Period missing or empty.'
  },
  'AUTH163': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (AUTH163): Invalid User Role in request header.'
  },

  // ---------------------------------------------------------------------------
  // 9. GSTR-1 Table 12, Table 13 & Table 9C/8C Validations
  // ---------------------------------------------------------------------------
  'RET192536': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192536): Direct modification of note type (Debit Note to Credit Note or vice-versa) in Table 9C is not allowed.'
  },
  'RET192537': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192537): Direct modification of note type (Debit Note to Credit Note or vice-versa) in Table 8C is not allowed.'
  },
  'RET192539': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192539): HSN wise B2B Supplies are not reported in Table 12 and no details reported in Table 13 (Document Issued). Please report to proceed.'
  },
  'RET192540': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192540): Please enter document issued details in Table 13 before generating summary.'
  },
  'RET192541': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192541): Taxable values/tax amounts entered in Table 12 (B2B HSN) do not match with registered outward totals in Tables 4, 6B, 6C, 8, 9A, 9B, 9C, 15 & 15A.'
  },
  'RET192542': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192542): Taxable values or tax amounts in Table 12 (B2C HSN) do not match with unregistered outward totals in Tables 5, 6A, 7, 8, 9, 10, 15 & 15A.'
  },
  'RET192543': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET192543): B2C supplies have not been validated in Table 12. Please verify values before filing.'
  },
  'RET192546': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET192546): No data available in tables of GSTR-1. Enter relevant outward supply data or file a Nil return.'
  },
  'RET00034': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET00034): Filing barred under Section 37(4) of CGST Act. Return cannot be filed after expiry of 3 years from due date.'
  },
  'RET2X91230': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET2X91230): Pending actions exist on GST portal. Please take action and try again.'
  },

  // ---------------------------------------------------------------------------
  // 10. Statutory Limitation (30 Nov), Composition (CMP-08), Annual (GSTR-9), TDS/TCS
  // ---------------------------------------------------------------------------
  'RET891179': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET891179): Records added in previous Financial Year cannot be amended after statutory deadline (30th November of succeeding FY).'
  },
  'RET791151': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET791151): Records added in previous Financial Year cannot be amended after statutory deadline (30th November of succeeding FY).'
  },
  'RETC872100': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RETC872100): Previous period CMP-08 is not filed. File previous CMP-08 statement before proceeding.'
  },
  'RETC872102': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RETC872102): Last tax period return as normal taxpayer is not filed. File it before attempting to file Form GST CMP-08.'
  },
  'RETC872103': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RETC872103): Reported turnover exceeds statutory threshold limit for composition scheme.'
  },
  'RET80515': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET80515): Filing of Form GSTR-9A is not applicable for the provided financial year.'
  },
  'RET923525': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET923525): Invalid HSN/SAC records present in Table 17 of Annual Return (GSTR-9). Please correct to proceed.'
  },
  'RET923535': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET923535): As per Notification No. 78/2020-CT, B2B supplies require HSN reporting at minimum 4 or 6 digit level in Table 17 of GSTR-9.'
  },
  'RET923536': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET923536): As per Notification No. 78/2020-CT, HSN details must be reported at minimum 4 or 6 digit level in Table 17 of GSTR-9.'
  },
  'RET70018': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET70018): Return of previous tax period is not filed. File it before attempting to file current period return.'
  },
  'RET70020': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET70020): Statement of previous tax period is not filed. File it before attempting to file current statement.'
  },
  'RET70021': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET70021): Saved/pending/rejected records exist in tables. Take action before attempting to file NIL GSTR-8.'
  },
  'RET80012': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET80012): Please file GSTR-8 for previous return periods where data has been saved.'
  },
  'RET791132': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET791132): Duplicate supplier GSTIN in TDS details. Please provide a valid supplier GSTIN.'
  },
  'RET791135': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET791135): No action taken on TDS details rejected by counterparty.'
  },
  'RET791136': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET791136): TDS amount has already been accepted by counterparty.'
  },
  'RET891158': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET891158): Action not taken on supplier rejected record. Please save record by taking appropriate action.'
  },
  'RET891159': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Error (RET891159): Amendment cannot be processed because TCS record is already accepted by Supplier.'
  },
  'RET74518': {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'GST Portal Notice (RET74518): Nil filing is applicable from the specified tax period.'
  }
};

/**
 * Resolves an error code against the GSTN error catalog using safe ApiError factory methods.
 * This prevents constructor argument order mismatches and ensures proper HTTP status codes.
 * 
 * @param {string} errorCd - The upstream GSTN error code (e.g., 'RET11400', 'AUTH4033')
 * @returns {ApiError|null} ApiError instance with proper HTTP status and user-friendly message, or null if not found
 */
function resolveGstnCatalogError(errorCd) {
  if (!errorCd || typeof errorCd !== 'string') return null;
  const entry = GSTN_ERROR_CATALOG[errorCd];
  if (!entry) return null;

  // ✅ SAFE: Use factory methods instead of direct constructor to avoid argument order issues
  let err;
  const msg = entry.message;

  switch (entry.code) {
    case 'SESSION_EXPIRED':
      err = ApiError.sessionExpired(msg);
      break;
    case 'VALIDATION_ERROR':
      err = ApiError.validationError(msg);
      break;
    case 'INVALID_GSTIN':
      // Map invalid GSTIN to validation error with specific message
      err = ApiError.invalidGstin ? ApiError.invalidGstin(msg) : ApiError.validationError(msg);
      break;
    case 'PROVIDER_AUTH':
      err = ApiError.providerAuth ? ApiError.providerAuth(msg) : ApiError.providerError(msg, entry.statusCode || 403);
      break;
    case 'PROVIDER_DOWN':
      err = ApiError.providerDown ? ApiError.providerDown(msg) : ApiError.providerError(msg, entry.statusCode || 503);
      break;
    case 'DATA_NOT_AVAILABLE':
      err = ApiError.dataNotAvailable ? ApiError.dataNotAvailable(msg) : (ApiError.notFound ? ApiError.notFound(msg) : ApiError.validationError(msg));
      break;
    case 'RATE_LIMITED':
      err = ApiError.rateLimited ? ApiError.rateLimited(msg) : (ApiError.tooManyRequests ? ApiError.tooManyRequests(msg) : ApiError.validationError(msg));
      break;
    case 'PROVIDER_ERROR':
    default:
      // Fallback for PROVIDER_ERROR or unknown codes
      err = ApiError.providerError(msg, entry.statusCode || 502);
  }

  // Attach the exact GSTN error code for frontend debugging and audit logs
  if (err) {
    err.errorCd = errorCd;
  }

  return err;
}

module.exports = {
  GSTN_ERROR_CATALOG,
  resolveGstnCatalogError
};