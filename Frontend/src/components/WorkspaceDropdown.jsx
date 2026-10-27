import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getWorkspaces } from '../api/auth.api';

export default function WorkspaceDropdown() {
  const { user, switchActiveWorkspace } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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

  const currentGstin = user?.gstin || 'No GSTIN Active';

  if (!user?.id && user?.gstin) {
    // Legacy / direct taxpayer session
    return (
      <span className="badge bg-light text-secondary border px-2.5 py-1.5 font-monospace" style={{ fontSize: '0.8rem' }}>
        GSTIN: <span className="text-primary fw-bold">{user.gstin}</span>
      </span>
    );
  }

  return (
    <div className="dropdown position-relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="btn btn-sm btn-light border d-flex align-items-center gap-1.5 py-1 px-2.5 rounded-2 font-monospace"
        style={{ fontSize: '0.8rem' }}
        disabled={loading}
      >
        <span className="text-muted">GSTIN:</span>
        <span className="text-primary fw-bold">{currentGstin}</span>
        {workspaces.length > 1 && <span style={{ fontSize: '0.7rem' }}>▼</span>}
      </button>

      {open && workspaces.length > 1 && (
        <ul className="dropdown-menu shadow-sm show position-absolute start-0 mt-1 py-1" style={{ minWidth: '220px', zIndex: 1050 }}>
          <li className="dropdown-header small text-uppercase fw-bold text-muted px-3 py-1">
            Switch Workspace
          </li>
          {workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => handleSwitch(w.id)}
                className={`dropdown-item d-flex align-items-center justify-content-between py-1.5 px-3 small ${w.isCurrent ? 'active text-white' : ''}`}
              >
                <span className="font-monospace fw-medium">{w.gstin}</span>
                <span className="badge bg-secondary-subtle text-dark border small" style={{ fontSize: '0.65rem' }}>
                  {w.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
