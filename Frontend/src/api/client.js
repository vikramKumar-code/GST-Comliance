import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

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
        message = message || 'Session expired or invalid. Please log in again.';
      } else if (status === 429) {
        code = 'RATE_LIMITED';
        message = message || 'Too many requests. Please try again after a few minutes.';
      } else if (status === 502) {
        code = 'PROVIDER_AUTH';
        message = message || 'GST Provider authentication error.';
      } else if (status === 503) {
        code = 'PROVIDER_DOWN';
        message = message || 'GST Service or provider is temporarily down. Please try later.';
      } else if (status >= 500) {
        code = 'SERVER_ERROR';
        message = message || 'Internal server error occurred.';
      } else if (status === 400) {
        code = 'VALIDATION_ERROR';
        message = message || 'Invalid request.';
      } else if (error.code === 'ECONNABORTED') {
        code = 'TIMEOUT';
        message = message || 'Request timed out. Please try again.';
      } else {
        code = 'NETWORK_ERROR';
        message = message || error.message || 'Network connection failed.';
      }
    }

    if (!message) {
      message = error.message || 'An unexpected error occurred.';
    }

    // Redirect to /login on SESSION_EXPIRED unless already on a public page
    if (code === 'SESSION_EXPIRED') {
      const publicPaths = ['/login', '/otp', '/', '/privacy', '/terms'];
      if (typeof window !== 'undefined' && !publicPaths.includes(window.location.pathname)) {
        window.location.href = '/login';
      }
    }

    // Normalise error object to { code, message }
    return Promise.reject({
      code,
      message,
    });
  }
);

export default client;
