import axios from 'axios';
import { BACKEND_BASE_URL } from './client';

/**
 * Check backend health status at GET /health
 * Returns { ok: boolean, status: number, latency: number, data?: any, error?: any }
 */
export const checkBackendHealth = async () => {
  const startTime = performance.now();
  try {
    const response = await axios.get(`${BACKEND_BASE_URL}/health`, {
      withCredentials: true,
      timeout: 8000,
    });
    const latency = Math.round(performance.now() - startTime);
    return {
      ok: Boolean(response.data?.ok),
      status: response.status,
      latency,
      data: response.data,
    };
  } catch (error) {
    const latency = Math.round(performance.now() - startTime);
    return {
      ok: false,
      status: error.response?.status || 0,
      latency,
      error: error.response?.data || { message: error.message || 'Connection failed' },
    };
  }
};
