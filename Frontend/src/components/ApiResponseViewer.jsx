import { useState } from 'react';
import { sanitizePayload } from '../utils/sanitize';

export default function ApiResponseViewer({
  response,
  title = 'API Response & Debug Inspector',
  defaultExpanded = false,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  if (!response) return null;

  const data = response.data ? sanitizePayload(response.data) : null;
  const payload = response.payload ? sanitizePayload(response.payload) : null;
  const status = response.status || 0;
  const code = response.errorCode || response.data?.code;
  const msg = response.data?.message || '';

  // Safe provider error detection
  let providerAnnotation = null;
  const lowerMsg = String(msg).toLowerCase();
  if (lowerMsg.includes('portal user is not registered') || code === 'AUTH4037') {
    providerAnnotation = {
      badge: 'AUTH4037',
      badgeClass: 'bg-danger text-white',
      title: 'Taxpayer User Unregistered (AUTH4037)',
      description: 'The GST portal username provided is not registered with this GSTIN on the official GST Portal.',
    };
  } else if (lowerMsg.includes('expired or was not found') || code === 'GSP053') {
    providerAnnotation = {
      badge: 'GSP053',
      badgeClass: 'bg-warning text-dark',
      title: 'OTP Expired / Not Found (GSP053)',
      description: 'The OTP session expired on the GST portal or was not found. Please request a new OTP.',
    };
  } else if (code === 'PROVIDER_DOWN' || lowerMsg.includes('unavailable') || code === 'GSP032') {
    providerAnnotation = {
      badge: 'GSP032 / PROVIDER_DOWN',
      badgeClass: 'bg-danger text-white',
      title: 'GST Service Unavailable (GSP032)',
      description: 'The GST System (GSTN) or upstream TaxPro gateway is temporarily down or unreachable.',
    };
  } else if (code === 'DATA_NOT_AVAILABLE' || lowerMsg.includes('not available yet') || code === 'RET2B1023') {
    providerAnnotation = {
      badge: 'RET2B1023',
      badgeClass: 'bg-info text-dark',
      title: 'Return Data Not Available (RET2B1023)',
      description: 'GSTR-2B data for this tax period has not been compiled or generated yet on the GST portal.',
    };
  } else if (lowerMsg.includes('mapper needs real sample') || lowerMsg.includes('mapper requires a sanitized provider sample')) {
    providerAnnotation = {
      badge: 'TAXPRO GATING',
      badgeClass: 'bg-secondary text-white',
      title: 'TaxPro Return Mapper Gating (HTTP 502)',
      description: 'The TaxPro provider was contacted, but the return mapper intentionally fails closed pending a live provider sample.',
    };
  } else if (data?.legalName === 'Demo Traders Pvt Ltd' || (data?.rows && data?.totals && !data?.error && !msg && !response.endpoint?.includes('search'))) {
    providerAnnotation = {
      badge: 'MOCK DATA',
      badgeClass: 'bg-secondary text-white',
      title: 'Mock Mode Engine (USE_MOCK=true)',
      description: 'This response was synthesized by the local offline FinaggMock provider.',
    };
  } else if (response.success) {
    providerAnnotation = {
      badge: 'TAXPRO / LIVE API',
      badgeClass: 'bg-success text-white',
      title: 'Live Backend Response',
      description: 'Successful response received from backend.',
    };
  }

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const getStatusBadge = () => {
    if (status >= 200 && status < 300) return 'bg-success';
    if (status === 401) return 'bg-warning text-dark';
    if (status === 404) return 'bg-info text-dark';
    if (status >= 400 && status < 500) return 'bg-warning text-dark';
    if (status >= 500) return 'bg-danger text-white';
    return 'bg-secondary text-white';
  };

  return (
    <div className="card shadow-sm border rounded-3 my-3 bg-white overflow-hidden">
      {/* Header / Accordion Toggle */}
      <div
        className="card-header bg-light d-flex align-items-center justify-content-between py-2 px-3 cursor-pointer"
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="small fw-bold text-dark">{title}</span>
          <span className="badge bg-dark font-monospace" style={{ fontSize: '0.72rem' }}>
            {response.method || 'GET'}
          </span>
          <span className="font-monospace small text-truncate" style={{ maxWidth: '320px' }}>
            {response.endpoint || '/'}
          </span>
          <span className={`badge font-monospace ${getStatusBadge()}`} style={{ fontSize: '0.72rem' }}>
            HTTP {status || 'N/A'}
          </span>
          {providerAnnotation && (
            <span className={`badge font-monospace ${providerAnnotation.badgeClass}`} style={{ fontSize: '0.72rem' }}>
              {providerAnnotation.badge}
            </span>
          )}
        </div>

        <div className="d-flex align-items-center gap-2">
          {response.latency !== undefined && (
            <span className="text-muted font-monospace small">{response.latency} ms</span>
          )}
          <span className="text-secondary small">{expanded ? '▲ Collapse' : '▼ Inspect'}</span>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="card-body p-3 border-top">
          {providerAnnotation && (
            <div className="alert alert-light border py-2 px-3 mb-3 small rounded-2">
              <div className="fw-semibold text-dark">{providerAnnotation.title}</div>
              <div className="text-muted">{providerAnnotation.description}</div>
            </div>
          )}

          {payload && (
            <div className="mb-3">
              <div className="text-muted small fw-semibold text-uppercase mb-1">
                Outgoing Request Payload (Sanitized)
              </div>
              <pre
                className="bg-light p-2 rounded border font-monospace small mb-0 overflow-auto"
                style={{ maxHeight: '100px' }}
              >
                <code>{JSON.stringify(payload, null, 2)}</code>
              </pre>
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="text-muted small fw-semibold text-uppercase">
              Response Body Envelope (Zero Secret Exposure)
            </span>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary py-0 px-2"
              style={{ fontSize: '0.75rem' }}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied' : 'Copy JSON'}
            </button>
          </div>

          <pre
            className="p-3 rounded border font-monospace small mb-0 overflow-auto"
            style={{
              backgroundColor: response.success ? '#f8faf9' : '#fff9f9',
              borderColor: response.success ? '#cbe3d3' : '#f5c6cb',
              color: response.success ? '#155724' : '#721c24',
              maxHeight: '320px',
            }}
          >
            <code>{JSON.stringify(data, null, 2)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
