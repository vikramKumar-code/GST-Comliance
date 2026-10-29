import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getWorkspaces, createWorkspace } from '../api/auth.api';
import { Link } from 'react-router-dom';

export default function WorkspaceDropdown() {
  const { user, switchActiveWorkspace, checkAuth } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgGstin, setNewOrgGstin] = useState('');
  const [createError, setCreateError] = useState(null);
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef(null);

  const fetchWorkspaces = () => {
    if (user?.id) {
      getWorkspaces()
        .then((res) => {
          if (res?.workspaces) {
            setWorkspaces(res.workspaces);
          }
        })
        .catch(() => {});
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, [user?.id, user?.gstin]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
        setShowCreate(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = async (workspaceId) => {
    setLoading(true);
    try {
      await switchActiveWorkspace(workspaceId);
      await checkAuth().catch(() => {});
      fetchWorkspaces();
      setOpen(false);
    } catch (err) {
      console.error('Workspace switch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createWorkspace({
        name: newOrgName.trim(),
        gstin: newOrgGstin.trim() ? newOrgGstin.trim().toUpperCase() : undefined
      });
      setNewOrgName('');
      setNewOrgGstin('');
      setShowCreate(false);
      await checkAuth().catch(() => {});
      fetchWorkspaces();
      setOpen(false);
    } catch (err) {
      setCreateError(err.message || 'Failed to create workspace.');
    } finally {
      setCreating(false);
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
        onClick={() => {
          setOpen(!open);
          if (!open) fetchWorkspaces();
        }}
        className="btn btn-sm btn-light d-flex align-items-center gap-2 py-1.5 px-3 rounded-3 shadow-xs border text-start"
        style={{ fontSize: '0.82rem', borderColor: '#e2e8f0' }}
        disabled={loading}
        title="Click to view and switch between organizations/workspaces"
      >
        <span className="text-secondary" style={{ fontSize: '0.95rem' }}>🏢</span>
        <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
          <span className="fw-bold text-dark text-truncate" style={{ maxWidth: 'clamp(95px, 22vw, 180px)' }}>
            {displayName}
          </span>
          <span className="font-monospace text-muted text-truncate" style={{ fontSize: '0.7rem', maxWidth: 'clamp(95px, 22vw, 180px)' }}>
            {hasGstin ? activeGstin : 'Unlinked GSTIN'}
          </span>
        </div>
        <span className="text-muted ms-1" style={{ fontSize: '0.65rem' }}>▼</span>
      </button>

      {open && (
        <div
          className="dropdown-menu shadow-lg show position-absolute start-0 mt-1 py-1 rounded-3 border"
          style={{ minWidth: '280px', zIndex: 1050, borderColor: '#e2e8f0' }}
        >
          <div className="px-3 py-2 border-bottom bg-light d-flex justify-content-between align-items-center">
            <span className="text-uppercase fw-bold text-muted" style={{ fontSize: '0.65rem', letterSpacing: '0.06em' }}>
              Switch Workspace ({workspaces.length})
            </span>
            <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: '0.65rem' }}>
              Multi-Entity
            </span>
          </div>

          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => handleSwitch(w.id)}
                className={`dropdown-item d-flex align-items-center justify-content-between py-2.5 px-3 border-bottom ${
                  w.isCurrent ? 'bg-primary-subtle text-primary fw-bold' : ''
                }`}
                style={{ fontSize: '0.82rem' }}
              >
                <div className="d-flex flex-column text-start">
                  <span className="text-truncate fw-semibold" style={{ maxWidth: '170px' }}>
                    {w.name || (w.gstin ? `GSTIN ${w.gstin}` : 'Organization')}
                  </span>
                  <span className="font-monospace text-muted small" style={{ fontSize: '0.68rem' }}>
                    {w.gstin || 'No GSTIN Linked'}
                  </span>
                </div>
                <div className="d-flex align-items-center gap-1.5 ms-2">
                  <span className="badge bg-light text-secondary border small" style={{ fontSize: '0.62rem' }}>
                    {w.role}
                  </span>
                  {w.isCurrent && <span className="text-primary fw-bold fs-6">✓</span>}
                </div>
              </button>
            ))}
          </div>

          {showCreate ? (
            <div className="p-3 bg-light border-top">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="fw-bold small text-dark">Create New Workspace</span>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="btn btn-sm btn-link text-muted p-0 text-decoration-none"
                  style={{ fontSize: '0.75rem' }}
                >
                  ✕ Cancel
                </button>
              </div>
              <form onSubmit={handleCreateWorkspace}>
                <input
                  type="text"
                  className="form-control form-control-sm mb-2"
                  placeholder="Company / Branch Name"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  required
                  autoFocus
                />
                <input
                  type="text"
                  className="form-control form-control-sm font-monospace text-uppercase mb-2"
                  placeholder="15-Digit GSTIN (Optional)"
                  maxLength={15}
                  value={newOrgGstin}
                  onChange={(e) => setNewOrgGstin(e.target.value.toUpperCase())}
                />
                {createError && <div className="text-danger small mb-2" style={{ fontSize: '0.7rem' }}>{createError}</div>}
                <button
                  type="submit"
                  disabled={creating || !newOrgName.trim()}
                  className="btn btn-primary btn-sm w-100 py-1 fw-semibold"
                  style={{ fontSize: '0.75rem' }}
                >
                  {creating ? 'Creating...' : '+ Create & Switch'}
                </button>
              </form>
            </div>
          ) : (
            <div className="border-top p-2 bg-light d-flex flex-column gap-1.5">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="btn btn-sm btn-outline-primary w-100 py-1.5 fw-semibold d-flex align-items-center justify-content-center gap-1"
                style={{ fontSize: '0.75rem' }}
              >
                <span>➕</span>
                <span>Create New Workspace</span>
              </button>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="btn btn-link btn-sm w-100 py-1 text-secondary text-decoration-none text-center"
                style={{ fontSize: '0.72rem' }}
              >
                ⚙️ Organization & Tax Settings
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


