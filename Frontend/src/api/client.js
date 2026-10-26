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
  timeout: 30000,
});

const FRIENDLY_ERROR_MESSAGES = {
  INVALID_GSTIN: 'Taxpayer GSTIN not found or invalid format.',
  VALIDATION_ERROR: 'Invalid input parameters. Please check your entries.',
  OTP_INVALID: 'Invalid or expired OTP. Please check and try again.',
  SESSION_EXPIRED: 'Please verify OTP again.',
  DATA_NOT_AVAILABLE: 'Data for this period is not available yet. Try another month.',
  RATE_LIMITED: 'Too many requests. Please wait and try again.',
  PROVIDER_AUTH: 'Could not complete the request. Please try again.',
  PROVIDER_DOWN: 'GST service is unavailable. Please try again later.',
  PROVIDER_ERROR: 'Could not complete the request. Please try again.',
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

    // Per rules: Never show raw backend or provider messages for PROVIDER_*
    if (code === 'PROVIDER_AUTH' || code === 'PROVIDER_ERROR') {
      message = 'Could not complete the request. Please try again.';
    } else if (code === 'PROVIDER_DOWN') {
      message = 'GST service is unavailable. Please try again later.';
    } else if (!message) {
      // Use friendly short message if errorData.message is generic or missing
      message = FRIENDLY_ERROR_MESSAGES[code] || error.message || 'An unexpected error occurred.';
    }

    // Redirect to /login on SESSION_EXPIRED unless already on a public page
    if (code === 'SESSION_EXPIRED') {
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
