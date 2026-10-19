const axios = require('axios');
const { USE_MOCK, FINAGG_BASE_URL, FINAGG_API_KEY } = require('../config/env');
const FinaggMock = require('./finagg.mock');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

// [CONFIRM] from FinAGG docs: Base client setup, authentication headers, and timeout expectations
const apiClient = axios.create({
  baseURL: FINAGG_BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    // [CONFIRM] from FinAGG docs: Header name for FinAGG API authentication (e.g. x-api-key or Bearer)
    'x-api-key': FINAGG_API_KEY
  }
});

/**
 * Handle and normalize FinAGG upstream Axios errors
 */
function handleProviderError(error, context) {
  if (error instanceof ApiError) return error;

  logger.error(`FinAGG Provider Error during [${context}]: ${error.message}`, {
    status: error.response?.status,
    data: error.response?.data
  });

  if (!error.response) {
    return ApiError.providerDown('Unable to connect to FinAGG GST gateway.');
  }

  const { status, data } = error.response;

  // [CONFIRM] from FinAGG docs: Status codes and error payload shapes for auth failures
  if (status === 401 || status === 403) {
    return ApiError.providerAuth('Authentication rejected by FinAGG GSP gateway.');
  }

  // [CONFIRM] from FinAGG docs: Downtime / upstream GST portal maintenance status code
  if (status === 502 || status === 503 || status === 504) {
    return ApiError.providerDown('GST portal or FinAGG gateway is temporarily unavailable.');
  }

  const message = data?.message || data?.error_description || 'FinAGG GSP rejected the request.';
  return ApiError.providerError(message);
}

class FinaggService {
  /**
   * Search taxpayer legal name and filing status by GSTIN
   */
  static async searchGstin(gstin) {
    if (USE_MOCK) {
      return FinaggMock.searchGstin(gstin);
    }

    try {
      // [CONFIRM] from FinAGG docs: Endpoint path, HTTP method and parameter structure for taxpayer search
      const response = await apiClient.get(`/v1/gstin/search/${gstin}`);
      return response.data;
    } catch (error) {
      throw handleProviderError(error, 'searchGstin');
    }
  }

  /**
   * Request OTP from GST System
   */
  static async requestOtp(gstin, username) {
    if (USE_MOCK) {
      return FinaggMock.requestOtp(gstin, username);
    }

    try {
      // [CONFIRM] from FinAGG docs: Endpoint path and body payload for requesting taxpayer OTP
      const response = await apiClient.post('/v1/auth/otp/request', {
        gstin,
        username
      });
      return response.data;
    } catch (error) {
      throw handleProviderError(error, 'requestOtp');
    }
  }

  /**
   * Verify OTP and receive GST token
   */
  static async verifyOtp(gstin, username, otp) {
    if (USE_MOCK) {
      return FinaggMock.verifyOtp(gstin, username, otp);
    }

    try {
      // [CONFIRM] from FinAGG docs: Endpoint path, body parameters and response schema for OTP verification
      const response = await apiClient.post('/v1/auth/otp/verify', {
        gstin,
        username,
        otp
      });
      return response.data;
    } catch (error) {
      throw handleProviderError(error, 'verifyOtp');
    }
  }

  /**
   * Fetch available return periods and filing summary
   */
  static async getReturnsSummary(gstin, period, gstToken) {
    if (USE_MOCK) {
      return FinaggMock.getReturnsSummary(gstin, period);
    }

    try {
      // [CONFIRM] from FinAGG docs: Header name used for the active GST session token (e.g. gst-token or Authorization)
      const headers = { 'gst-token': gstToken };

      // [CONFIRM] from FinAGG docs: Endpoint path and query parameters for return summary
      const response = await apiClient.get(`/v1/returns/summary`, {
        params: { gstin, period },
        headers
      });
      return response.data;
    } catch (error) {
      throw handleProviderError(error, 'getReturnsSummary');
    }
  }

  /**
   * Fetch raw return payload for GSTR1, GSTR2B, or GSTR3B
   */
  static async getReturn(type, gstin, period, gstToken) {
    if (USE_MOCK) {
      return FinaggMock.getReturn(type, gstin, period);
    }

    try {
      // [CONFIRM] from FinAGG docs: Header name for GST session authentication
      const headers = { 'gst-token': gstToken };

      // [CONFIRM] from FinAGG docs: Exact endpoint routes per return type (e.g. /v1/returns/gstr1, /v1/returns/gstr2b)
      const endpoint = `/v1/returns/${type.toLowerCase()}`;
      const response = await apiClient.get(endpoint, {
        params: { gstin, period },
        headers
      });
      return response.data;
    } catch (error) {
      throw handleProviderError(error, `getReturn:${type}`);
    }
  }
}

module.exports = FinaggService;
