
import axios from 'axios';

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const BACKEND_BASE_URL = rawBaseUrl.replace(/\/api\/?$/, '');
export const API_BASE_URL = `${BACKEND_BASE_URL}/api`;

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 90000, // 90s for portal filing & large imports
});

const FRIENDLY_ERROR_MESSAGES = {
  INVALID_GSTIN: 'Taxpayer GSTIN not found or invalid format.',
  VALIDATION_ERROR: 'Invalid input parameters. Please check your entries.',
  OTP_INVALID: 'Invalid or expired OTP. Please check and try again.',
  SESSION_EXPIRED: 'Please verify OTP again.',
  DATA_NOT_AVAILABLE: 'Data for this period is not available yet. Try another month.',
  RATE_LIMITED: 'Too many requests. Please wait and try again.',
  PROVIDER_AUTH: 'The GST service could not authorize this request. Check that the GST portal username belongs to this GSTIN and that API access is enabled for the GSTIN.',
  PROVIDER_ERROR: 'The GST service could not complete this request on the government portal. Please verify return status or try again in a few moments.',
  PROVIDER_DOWN: 'GST service is unavailable. Please try again later.',
  SERVER_ERROR: 'Internal server error. Please try again later.',
  TIMEOUT: 'Request timed out. Please try again.',
  NETWORK_ERROR: 'Network connection failed. Please try again.',
};

// Response interceptor
client.interceptors.response.use(
  (response) => {
    // Unpack backend response payload { success: true, ...data }
    return response.data;
  },
  (error) => {
    const errorData = error.response?.data;
    const status = error.response?.status;

    let code = errorData?.code;
    let message = errorData?.message;

    if (!code) {
      if (status === 401) {
        code = 'SESSION_EXPIRED';
      } else if (status === 404) {
        code = 'DATA_NOT_AVAILABLE';
      } else if (status === 429) {
        code = 'RATE_LIMITED';
      } else if (status === 502) {
        code = 'PROVIDER_AUTH';
      } else if (status === 503) {
        code = 'PROVIDER_DOWN';
      } else if (status >= 500) {
        code = 'SERVER_ERROR';
      } else if (status >= 400) {
        code = 'VALIDATION_ERROR';
      } else if (error.code === 'ECONNABORTED') {
        code = 'TIMEOUT';
      } else {
        code = 'NETWORK_ERROR';
      }
    }

    // Show clear, government-relevant error messages for GST portal errors
    if (code === 'PROVIDER_AUTH' || code === 'PROVIDER_ERROR' || errorData?.error_cd) {
      const providerMessage = errorData?.message;
      const genericProviderMessage = 'Could not complete the request. Please try again.';
      const errCd = errorData?.error_cd;

      if (errCd === 'AUTH4038' || errCd === 'GSP052A' || errCd === 'GSP102') {
        message = 'GST Portal Error (GSP102): AuthToken expired or not found on government portal. Please reconnect your session on GST Return Hub.';
      } else if (errCd === 'AUTH4033') {
        message = 'GST Portal Notice (AUTH4033): OTP session has expired or is invalid on government portal. Please click "Resend OTP" to request a fresh OTP.';
      } else if (errCd === 'OTP0010') {
        message = 'GST Portal Error (OTP0010): Not Authorized Signatory. Please enter personal PAN of the designated Director / Partner (4th letter must be "P").';
      } else if (errCd === 'RET11406' || errCd === 'RET11404') {
        message = 'GST Portal Notice: Return summary calculation is in progress on the government portal. Please wait 1-2 minutes and retry.';
      } else if (errCd === 'RETFILE01' || errCd === 'RET11407') {
        message = 'GST Portal Error: Invalid EVC OTP entered. Please check the 6-digit code received on your mobile and try again.';
      } else if (errCd === 'RETFILE02') {
        message = 'GST Portal Error: EVC OTP has expired. Please request a fresh EVC OTP.';
      } else if (errCd === 'RET01202') {
        message = 'GST Portal Notice: Previous tax period return is pending on GST portal. Please file earlier periods first.';
      } else if (errCd === 'GSP101') {
        message = 'GST Portal Error (GSP101): Request payload rejected by GST System. Please verify return parameters.';
      } else if (errCd === 'AUTH4037') {
        message = 'GST Portal Error (AUTH4037): API Access is not enabled for this username. Please enable API Access under My Profile > Manage API Access on gst.gov.in.';
      } else if (errCd === 'GSP500' || errCd === 'SYS500') {
        message = 'GST Portal Notice: Government GST Portal is undergoing maintenance. Please retry in a few moments.';
      } else if (errCd === 'GSTNBadRequest') {
        message = 'GST Portal Notice (GSTNBadRequest): The government portal rejected the request. Please verify that the return period is open, the return summary has been generated on the portal, and the designated signatory PAN is registered for this GSTIN.';
      } else if (errCd) {
        message = providerMessage && providerMessage !== genericProviderMessage
          ? providerMessage
          : `GST Portal Notice (${errCd}): The government portal could not complete this request.`;
      } else if (providerMessage && providerMessage !== genericProviderMessage) {
        message = providerMessage;
      } else {
        message = 'GST Portal Notice: The government GST service could not complete this request. Please verify return status or reconnect session.';
      }
    } else if (code === 'PROVIDER_DOWN') {
      message = 'GST service is unavailable. Please try again later.';
    } else if (!message) {
      // Use friendly short message if errorData.message is generic or missing
      message = FRIENDLY_ERROR_MESSAGES[code] || error.message || 'An unexpected error occurred.';
    }

    // Redirect to /login only if the core auth check (/auth/me) itself has expired
    if (code === 'SESSION_EXPIRED' && error.config?.url?.includes('/auth/me')) {
      const publicPaths = ['/login', '/otp', '/', '/privacy', '/terms'];
      if (typeof window !== 'undefined' && !publicPaths.includes(window.location.pathname)) {
        window.location.href = '/login';
      }
    }

    // Normalise error object to { code, message, status, data }
    return Promise.reject({
      code,
      message,
      status,
      data: errorData,
    });
  }
);

export default client;
