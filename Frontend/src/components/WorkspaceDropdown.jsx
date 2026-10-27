import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getWorkspaces } from '../api/auth.api';
import { Link } from 'react-router-dom';

export default function WorkspaceDropdown() {
  const { user, switchActiveWorkspace } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    if (user?.id) {
      getWorkspaces()
        .then((res) => {
          if (isMounted && res?.workspaces) {
            setWorkspaces(res.workspaces);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.gstin]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = async (workspaceId) => {
    setLoading(true);
    try {
      await switchActiveWorkspace(workspaceId);
      setOpen(false);
    } catch (err) {
      console.error('Workspace switch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentWs = workspaces.find((w) => w.isCurrent) || workspaces[0];
  const displayName = currentWs?.name || (user?.gstin ? `GSTIN: ${user.gstin}` : 'My Business');
  const hasGstin = Boolean(user?.gstin || currentWs?.gstin);
  const activeGstin = user?.gstin || currentWs?.gstin;

  return (
    <div className="position-relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="btn btn-sm btn-light d-flex align-items-center gap-2 py-1.5 px-3 rounded-3 shadow-xs border text-start"
        style={{ fontSize: '0.82rem', borderColor: '#e2e8f0' }}
        disabled={loading}
      >
        <span className="text-secondary" style={{ fontSize: '0.95rem' }}>🏢</span>
        <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
          <span className="fw-bold text-dark text-truncate" style={{ maxWidth: '160px' }}>
            {displayName}
          </span>
          <span className="font-monospace text-muted" style={{ fontSize: '0.7rem' }}>
            {hasGstin ? activeGstin : 'Unlinked GSTIN'}
          </span>
        </div>
        <span className="text-muted ms-1" style={{ fontSize: '0.65rem' }}>▼</span>
      </button>

      {open && (
        <div
          className="dropdown-menu shadow-lg show position-absolute start-0 mt-1 py-1 rounded-3 border"
          style={{ minWidth: '260px', zIndex: 1050, borderColor: '#e2e8f0' }}
        >
          <div className="px-3 py-2 border-bottom bg-light">
            <span className="text-uppercase fw-bold text-muted" style={{ fontSize: '0.65rem', letterSpacing: '0.06em' }}>
              Switch Workspace
            </span>
          </div>

          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => handleSwitch(w.id)}
                className={`dropdown-item d-flex align-items-center justify-content-between py-2 px-3 ${
                  w.isCurrent ? 'bg-primary-subtle text-primary fw-bold' : ''
                }`}
                style={{ fontSize: '0.82rem' }}
              >
                <div className="d-flex flex-column text-start">
                  <span className="text-truncate" style={{ maxWidth: '160px' }}>
                    {w.name || (w.gstin ? `GSTIN ${w.gstin}` : 'Organization')}
                  </span>
                  {w.gstin && (
                    <span className="font-monospace text-muted small" style={{ fontSize: '0.68rem' }}>
                      {w.gstin}
                    </span>
                  )}
                </div>
                <div className="d-flex align-items-center gap-1.5">
                  <span className="badge bg-light text-secondary border small" style={{ fontSize: '0.62rem' }}>
                    {w.role}
                  </span>
                  {w.isCurrent && <span className="text-primary fw-bold">✓</span>}
                </div>
              </button>
            ))}
          </div>

          <div className="border-top p-2 bg-light">
            <Link
              to="/taxpayer-search"
              onClick={() => setOpen(false)}
              className="btn btn-outline-primary btn-sm w-100 py-1.5 justify-content-center"
              style={{ fontSize: '0.75rem' }}
            >
              + Link Another GSTIN
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
