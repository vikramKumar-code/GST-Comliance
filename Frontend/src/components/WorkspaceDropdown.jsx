import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Check,
  Plus,
  Settings,
  X,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Briefcase,
  Search,
  Edit3,
  MapPin,
  Building2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getWorkspaces,
  createWorkspace,
  updateWorkspace,
  searchGstin,
} from '../api/auth.api';
import { getStateName } from '../utils/format';
import Button from './ui/Button';
import { Modal } from './ui/Modal';

const GST_STATES = [
  { code: '01', name: '01 - Jammu & Kashmir' },
  { code: '02', name: '02 - Himachal Pradesh' },
  { code: '03', name: '03 - Punjab' },
  { code: '04', name: '04 - Chandigarh' },
  { code: '05', name: '05 - Uttarakhand' },
  { code: '06', name: '06 - Haryana' },
  { code: '07', name: '07 - Delhi' },
  { code: '08', name: '08 - Rajasthan' },
  { code: '09', name: '09 - Uttar Pradesh' },
  { code: '10', name: '10 - Bihar' },
  { code: '11', name: '11 - Sikkim' },
  { code: '12', name: '12 - Arunachal Pradesh' },
  { code: '13', name: '13 - Nagaland' },
  { code: '14', name: '14 - Manipur' },
  { code: '15', name: '15 - Mizoram' },
  { code: '16', name: '16 - Tripura' },
  { code: '17', name: '17 - Meghalaya' },
  { code: '18', name: '18 - Assam' },
  { code: '19', name: '19 - West Bengal' },
  { code: '20', name: '20 - Jharkhand' },
  { code: '21', name: '21 - Odisha' },
  { code: '22', name: '22 - Chhattisgarh' },
  { code: '23', name: '23 - Madhya Pradesh' },
  { code: '24', name: '24 - Gujarat' },
  { code: '26', name: '26 - Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: '27 - Maharashtra' },
  { code: '29', name: '29 - Karnataka' },
  { code: '30', name: '30 - Goa' },
  { code: '31', name: '31 - Lakshadweep' },
  { code: '32', name: '32 - Kerala' },
  { code: '33', name: '33 - Tamil Nadu' },
  { code: '34', name: '34 - Puducherry' },
  { code: '35', name: '35 - Andaman & Nicobar Islands' },
  { code: '36', name: '36 - Telangana' },
  { code: '37', name: '37 - Andhra Pradesh' },
  { code: '38', name: '38 - Ladakh' }
];

// Helper to extract 2-letter uppercase initials
function getClientInitials(name) {
  if (!name) return 'CL';
  const clean = name.trim().replace(/^Taxpayer\s*\([^)]*\)\s*/i, '');
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || 'CL';
}

// Helper to pick deterministic pleasant gradient for avatars
function getClientAvatarGradient(name) {
  const gradients = [
    'from-indigo-600 to-blue-700 text-white',
    'from-emerald-600 to-teal-700 text-white',
    'from-violet-600 to-purple-700 text-white',
    'from-blue-600 to-indigo-800 text-white',
    'from-amber-600 to-orange-700 text-white',
    'from-rose-600 to-pink-700 text-white',
    'from-cyan-600 to-blue-700 text-white',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

export default function WorkspaceDropdown() {
  const { user, switchActiveWorkspace, checkAuth } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgTradeName, setNewOrgTradeName] = useState('');
  const [newOrgGstin, setNewOrgGstin] = useState('');
  const [newOrgAddress, setNewOrgAddress] = useState('');
  const [newOrgStateCode, setNewOrgStateCode] = useState('');
  const [newOrgStateName, setNewOrgStateName] = useState('');
  const [newOrgPincode, setNewOrgPincode] = useState('');
  const [createError, setCreateError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [verifiedLegalName, setVerifiedLegalName] = useState(null);

  // Edit Active Client Details State
  const [showEdit, setShowEdit] = useState(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgTradeName, setEditOrgTradeName] = useState('');
  const [editOrgGstin, setEditOrgGstin] = useState('');
  const [editOrgAddress, setEditOrgAddress] = useState('');
  const [editOrgStateCode, setEditOrgStateCode] = useState('');
  const [editOrgStateName, setEditOrgStateName] = useState('');
  const [editOrgPincode, setEditOrgPincode] = useState('');
  const [editError, setEditError] = useState(null);
  const [updatingClient, setUpdatingClient] = useState(false);
  const [verifyingEditGstin, setVerifyingEditGstin] = useState(false);

  const handleVerifyEditGstin = async () => {
    const clean = editOrgGstin.trim().toUpperCase();
    if (!clean || clean.length < 15) {
      setEditError('Please enter a valid 15-character GSTIN first.');
      return;
    }
    setVerifyingEditGstin(true);
    setEditError(null);
    try {
      const res = await searchGstin(clean);
      const tp = res?.taxpayer || res;
      const legalName = tp?.legalName || tp?.tradeName;
      if (legalName) {
        setEditOrgName(legalName);
        if (tp?.tradeName) setEditOrgTradeName(tp.tradeName);
        const sc = clean.slice(0, 2);
        setEditOrgStateCode(sc);
        setEditOrgStateName(getStateName(sc));
        if (tp?.address && !editOrgAddress) setEditOrgAddress(tp.address);
      } else {
        setEditError('GSTIN verified, but legal name not returned from portal.');
      }
    } catch (err) {
      setEditError(err?.message || 'Could not verify GSTIN with Government Portal.');
    } finally {
      setVerifyingEditGstin(false);
    }
  };

  const dropdownRef = useRef(null);

  const handleVerifyClientGstin = async () => {
    const clean = newOrgGstin.trim().toUpperCase();
    if (!clean || clean.length < 15) {
      setCreateError('Please enter a valid 15-character GSTIN first.');
      return;
    }
    setVerifyingGstin(true);
    setCreateError(null);
    try {
      const res = await searchGstin(clean);
      const tp = res?.taxpayer || res;
      const legalName = tp?.legalName || tp?.tradeName;
      if (legalName) {
        setVerifiedLegalName(legalName);
        setNewOrgName(legalName);
        if (tp?.tradeName) setNewOrgTradeName(tp.tradeName);
        const sc = clean.slice(0, 2);
        setNewOrgStateCode(sc);
        setNewOrgStateName(getStateName(sc));
        if (tp?.address) setNewOrgAddress(tp.address);
      } else {
        setCreateError('GSTIN verified, but legal name not returned from portal.');
      }
    } catch (err) {
      setCreateError(err?.message || 'Could not verify GSTIN with Government Portal.');
    } finally {
      setVerifyingGstin(false);
    }
  };

  const activeGstin = user?.gstin || '';
  const hasGstin = Boolean(activeGstin);

  const [taxpayerLookup, setTaxpayerLookup] = useState(null);
  const cachedTaxpayerName = activeGstin
    ? sessionStorage.getItem(`taxpayer_name_${activeGstin}`)
    : null;
  const liveTaxpayerName = taxpayerLookup?.gstin === activeGstin
    ? taxpayerLookup.name
    : cachedTaxpayerName;

  useEffect(() => {
    if (!activeGstin || cachedTaxpayerName) return undefined;
    let active = true;
    searchGstin(activeGstin)
      .then((data) => {
        const rawName = data?.tradeName || data?.legalName;
        if (!active || !rawName) return;
        const formatted = rawName
          .toLowerCase()
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        sessionStorage.setItem(`taxpayer_name_${activeGstin}`, formatted);
        setTaxpayerLookup({ gstin: activeGstin, name: formatted });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeGstin, cachedTaxpayerName]);

  const fetchWorkspaces = useCallback(() => {
    if (user?.id) {
      getWorkspaces()
        .then((res) => {
          if (res?.workspaces) {
            setWorkspaces(res.workspaces);
          }
        })
        .catch(() => {});
    }
  }, [user?.id]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces, user?.gstin]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
        setShowCreate(false);
        setSearchQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = async (workspaceId) => {
    setLoading(true);
    try {
      await switchActiveWorkspace(workspaceId);
      await checkAuth(true).catch(() => {});
      fetchWorkspaces();
      setOpen(false);
      setSearchQuery('');
    } catch (err) {
      console.error('Workspace switch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    const gstin = newOrgGstin.trim().toUpperCase();
    const rawName = newOrgName.trim() || verifiedLegalName;
    const name = rawName || (gstin ? `Client (${gstin})` : '');
    if (!name && !gstin) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await createWorkspace({
        name: name || (gstin ? `Client (${gstin})` : 'Client Workspace'),
        tradeName: newOrgTradeName.trim(),
        gstin: gstin || undefined,
        address: newOrgAddress.trim(),
        stateCode: newOrgStateCode.trim().slice(0, 2),
        stateName: newOrgStateName.trim() || getStateName(newOrgStateCode),
        pincode: newOrgPincode.trim(),
      });
      if (res?.workspace) {
        setNewOrgName('');
        setNewOrgTradeName('');
        setNewOrgGstin('');
        setNewOrgAddress('');
        setNewOrgStateCode('');
        setNewOrgStateName('');
        setNewOrgPincode('');
        setVerifiedLegalName(null);
        setShowCreate(false);
        await switchActiveWorkspace(res.workspace.id);
        await checkAuth(true).catch(() => {});
        fetchWorkspaces();
        setOpen(false);
        setSearchQuery('');
      }
    } catch (err) {
      setCreateError(err.message || 'Failed to add client workspace.');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEdit = (w, e) => {
    if (e) e.stopPropagation();
    setOpen(false); // Close dropdown immediately so centered modal opens cleanly
    setShowCreate(false);
    setEditError(null);
    setEditOrgName(w.name || '');
    setEditOrgTradeName(w.tradeName || '');
    setEditOrgGstin(w.gstin || '');
    setEditOrgAddress(w.address || '');
    const sc = w.stateCode || (w.gstin && w.gstin.length >= 2 ? w.gstin.slice(0, 2) : '');
    setEditOrgStateCode(sc);
    setEditOrgStateName(w.stateName || getStateName(sc));
    setEditOrgPincode(w.pincode || '');
    setShowEdit(w.id);
  };

  const handleUpdateWorkspace = async (e) => {
    e.preventDefault();
    if (!showEdit) return;
    setUpdatingClient(true);
    setEditError(null);
    try {
      await updateWorkspace({
        workspaceId: showEdit,
        name: editOrgName.trim(),
        tradeName: editOrgTradeName.trim(),
        gstin: editOrgGstin.trim().toUpperCase(),
        address: editOrgAddress.trim(),
        stateCode: editOrgStateCode.trim().slice(0, 2),
        stateName: editOrgStateName.trim() || getStateName(editOrgStateCode),
        pincode: editOrgPincode.trim(),
      });
      setShowEdit(null);
      await checkAuth(true).catch(() => {});
      fetchWorkspaces();
    } catch (err) {
      setEditError(err.message || 'Failed to update client workspace details.');
    } finally {
      setUpdatingClient(false);
    }
  };

  const activeWorkspace = workspaces.find(
    (w) => (user?.workspaceId && String(w.id) === String(user.workspaceId)) || w.isCurrent
  );

  const clientWorkspaceName =
    activeWorkspace?.name ||
    user?.workspaceName ||
    user?.currentWorkspace?.name;

  const displayName =
    liveTaxpayerName ||
    (clientWorkspaceName && !clientWorkspaceName.startsWith('Taxpayer (') ? clientWorkspaceName : null) ||
    (hasGstin ? `Taxpayer (${activeGstin})` : null) ||
    clientWorkspaceName ||
    'Client Workspace';

  const avatarGradient = getClientAvatarGradient(displayName);

  // Filter workspaces based on search query
  const filteredWorkspaces = workspaces.filter((w) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const nameMatch = (w.name || '').toLowerCase().includes(q);
    const gstinMatch = (w.gstin || '').toLowerCase().includes(q);
    return nameMatch || gstinMatch;
  });

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            fetchWorkspaces();
          }
        }}
        className={`flex items-center gap-2.5 py-1.5 px-3 rounded-xl border transition-all duration-200 cursor-pointer text-left shadow-2xs group ${
          open
            ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-500/10'
            : 'bg-white hover:bg-slate-50/90 border-slate-200 hover:border-slate-300'
        }`}
        disabled={loading}
        title="Click to view and switch between client workspaces"
      >
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${avatarGradient} flex items-center justify-center text-white shadow-2xs shrink-0 font-bold text-[11px]`}>
          {getClientInitials(displayName)}
        </div>
        <div className="flex flex-col leading-tight max-w-[150px] sm:max-w-[210px]">
          <span className="text-xs font-bold text-slate-800 truncate group-hover:text-indigo-600 transition" title={displayName}>
            {displayName}
          </span>
          <span className="text-[10px] font-mono text-slate-400 truncate tracking-wide">
            {hasGstin ? activeGstin : 'Unlinked GSTIN'}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0 ml-0.5 transition-transform duration-200 ${
            open ? 'rotate-180 text-indigo-600' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          className="absolute left-0 mt-2.5 w-[380px] sm:w-[410px] max-w-[95vw] max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200/90 z-50 overflow-hidden animate-in fade-in slide-in-from-top-1.5 duration-150 text-xs"
        >
          {/* Executive Header Banner */}
          <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-indigo-950/40">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
                <Briefcase className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-xs font-bold tracking-wide uppercase flex items-center gap-2 text-white">
                  <span>Managed Clients</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                    {workspaces.length}
                  </span>
                </div>
                <div className="text-[10px] text-slate-300">
                  Switch client workspace or add new
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              CA Portfolio
            </span>
          </div>

          {/* Quick Search Filter (shown if > 2 workspaces) */}
          {workspaces.length > 2 && !showCreate && (
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by client name or GSTIN..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition placeholder:text-slate-400 text-slate-800"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* List of Client Workspaces */}
          {!showCreate && (
            <div className="max-h-[300px] overflow-y-auto p-2 space-y-1 divide-y-0">
              {filteredWorkspaces.length === 0 ? (
                <div className="py-6 px-4 text-center">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                    <Search className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">No client workspaces found</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    No results match &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              ) : (
                filteredWorkspaces.map((w) => {
                  const clientName =
                    (w.name && !w.name.startsWith('Taxpayer ('))
                      ? w.name
                      : (w.gstin ? `GSTIN ${w.gstin}` : 'Organization');
                  const initials = getClientInitials(clientName);
                  const avatarGradient = getClientAvatarGradient(clientName);

                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => handleSwitch(w.id)}
                      className={`w-full group text-left p-2.5 rounded-xl transition-all duration-150 flex items-center justify-between gap-3 cursor-pointer ${
                        w.isCurrent
                          ? 'bg-gradient-to-r from-indigo-50/90 via-indigo-50/60 to-blue-50/40 border border-indigo-200 shadow-2xs ring-1 ring-indigo-500/10'
                          : 'hover:bg-slate-50/90 border border-transparent hover:border-slate-200/70'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Company Avatar */}
                        <div
                          className={`w-8 h-8 rounded-lg bg-gradient-to-br ${avatarGradient} flex items-center justify-center font-bold text-[11px] shadow-2xs shrink-0 tracking-wider`}
                        >
                          {initials}
                        </div>

                        {/* Client Details */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-bold truncate ${
                                w.isCurrent ? 'text-indigo-950' : 'text-slate-800 group-hover:text-indigo-600 transition'
                              }`}
                              title={clientName}
                            >
                              {clientName}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px] font-mono text-slate-500 font-medium tracking-wide">
                              {w.gstin ? w.gstin : 'Unlinked GSTIN'}
                            </span>

                            {w.gstin ? (
                              <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200/80">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                <span>Verified</span>
                              </span>
                            ) : (
                              <span className="text-[9px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200/80">
                                Unlinked
                              </span>
                            )}
                          </div>

                          {w.address ? (
                            <div className="flex items-center gap-1 text-[10px] text-slate-500 truncate max-w-[220px] mt-0.5" title={`${w.address} (${w.stateName || w.stateCode || ''})`}>
                              <MapPin className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="truncate">{w.address}</span>
                              {w.stateCode && <span className="font-semibold text-slate-600 shrink-0">({w.stateCode})</span>}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Right Actions & Status */}
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => handleOpenEdit(w, e)}
                          title="Edit Client Address, State Code & Company Details"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-200 transition"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {w.isCurrent ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-600 text-white shadow-xs">
                            <Check className="w-3 h-3 stroke-[2.5]" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 group-hover:bg-white group-hover:border-slate-300 transition">
                            {w.role || 'MEMBER'}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Create New Client Workspace Form */}
          {showCreate ? (
            <div className="p-4 bg-slate-50/90 border-t border-slate-100 space-y-3 overflow-y-auto max-h-[60vh]">
              <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      Add Client Workspace
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      Add client profile with registered address & state code
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setVerifiedLegalName(null);
                    setCreateError(null);
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
                  aria-label="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateWorkspace} className="space-y-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Client 15-Digit GSTIN:
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono uppercase tracking-wider focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800"
                      placeholder="e.g. 06AAHPB8621K1ZR"
                      maxLength={15}
                      value={newOrgGstin}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setNewOrgGstin(val);
                        if (val.length >= 2) {
                          const sc = val.slice(0, 2);
                          setNewOrgStateCode(sc);
                          setNewOrgStateName(getStateName(sc));
                        }
                        if (verifiedLegalName) setNewOrgName('');
                        setVerifiedLegalName(null);
                      }}
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleVerifyClientGstin}
                      disabled={verifyingGstin || !newOrgGstin || newOrgGstin.length < 15}
                      className="px-2.5 py-1.5 text-[11px] border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 shrink-0 font-bold"
                      title="Fetch Legal Trade Name from Govt GST Portal"
                    >
                      {verifyingGstin ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                      )}
                      <span className="ml-1">Verify</span>
                    </Button>
                  </div>
                </div>

                {verifiedLegalName && (
                  <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Govt Portal Legal Name:</span>
                    </div>
                    <div className="font-bold text-slate-900 pl-5">
                      {verifiedLegalName}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Client Legal / Company Name:
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 font-semibold"
                    placeholder="Enter or auto-fill business name"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    required={!newOrgGstin.trim()}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Trade Name (Optional):
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800"
                    placeholder="Brand / Trade name"
                    value={newOrgTradeName}
                    onChange={(e) => setNewOrgTradeName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Registered Business Address (Shows on Invoices):
                  </label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 resize-none"
                    placeholder="e.g. 123 Cyber Park, Sector 29, Gurugram, Haryana"
                    value={newOrgAddress}
                    onChange={(e) => setNewOrgAddress(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      State & Code:
                    </label>
                    <select
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 text-slate-800"
                      value={newOrgStateCode}
                      onChange={(e) => {
                        const code = e.target.value;
                        setNewOrgStateCode(code);
                        setNewOrgStateName(getStateName(code));
                      }}
                    >
                      <option value="">Select State</option>
                      {GST_STATES.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Pincode:
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 text-slate-800"
                      placeholder="e.g. 122001"
                      maxLength={6}
                      value={newOrgPincode}
                      onChange={(e) => setNewOrgPincode(e.target.value)}
                    />
                  </div>
                </div>

                {createError && (
                  <div className="text-[11px] text-rose-600 font-medium bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg">
                    {createError}
                  </div>
                )}

                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="w-full justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 shadow-xs text-xs"
                  disabled={creating || (!newOrgGstin.trim() && !newOrgName.trim())}
                  isLoading={creating}
                >
                  Add & Switch to Client Workspace
                </Button>
              </form>
            </div>
          ) : (
            /* Bottom Action Bar */
            <div className="p-2.5 bg-slate-50/90 border-t border-slate-100 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(true);
                  setShowEdit(null);
                  setVerifiedLegalName(null);
                  setCreateError(null);
                }}
                className="w-full py-2 px-3 rounded-xl text-xs font-bold text-indigo-700 bg-white border border-indigo-200/90 hover:bg-indigo-50/80 hover:border-indigo-300 transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer group"
              >
                <div className="w-4 h-4 rounded-full bg-indigo-100 group-hover:bg-indigo-200 text-indigo-700 flex items-center justify-center transition">
                  <Plus className="w-3 h-3 stroke-[3]" />
                </div>
                <span>Add Client Workspace</span>
              </button>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="w-full py-1.5 px-3 rounded-xl text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/90 transition flex items-center justify-center gap-2 text-decoration-none group"
              >
                <Settings className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition" />
                <span>Client & Organization Settings</span>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Edit Client Workspace Profile Modal - Centered Dialog with Zero Viewport Clipping */}
      <Modal
        isOpen={Boolean(showEdit)}
        onClose={() => {
          if (!updatingClient) setShowEdit(null);
        }}
        title="Edit Client Workspace Profile"
        subtitle="Update legal name, GSTIN, registered address & state code for official invoices and tax returns"
        size="lg"
      >
        <form onSubmit={handleUpdateWorkspace} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Client Legal / Company Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 font-semibold shadow-2xs"
                placeholder="e.g. Candidtax Private Limited"
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Trade Name (Optional)
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 shadow-2xs"
                placeholder="Brand or trade display name"
                value={editOrgTradeName}
                onChange={(e) => setEditOrgTradeName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Registered 15-Digit GSTIN
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-mono uppercase tracking-wider focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 font-bold shadow-2xs"
                  placeholder="e.g. 06AHYPC8543R1ZC"
                  maxLength={15}
                  value={editOrgGstin}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setEditOrgGstin(val);
                    if (val.length >= 2 && !editOrgStateCode) {
                      const sc = val.slice(0, 2);
                      setEditOrgStateCode(sc);
                      setEditOrgStateName(getStateName(sc));
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleVerifyEditGstin}
                  disabled={verifyingEditGstin || !editOrgGstin || editOrgGstin.length < 15}
                  className="px-2.5 py-2 text-[11px] border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 shrink-0 font-bold rounded-xl"
                  title="Verify legal name from GST Portal"
                >
                  {verifyingEditGstin ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  <span className="ml-1 hidden sm:inline">Verify</span>
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                State & State Code <span className="text-rose-500">*</span>
              </label>
              <select
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 font-medium shadow-2xs"
                value={editOrgStateCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setEditOrgStateCode(code);
                  setEditOrgStateName(getStateName(code));
                }}
              >
                <option value="">Select State</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Registered Business Address (Shows on Invoices)
            </label>
            <textarea
              rows={3}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 resize-none leading-relaxed shadow-2xs"
              placeholder="e.g. 548 Sector-7, Faridabad, Haryana - 121006"
              value={editOrgAddress}
              onChange={(e) => setEditOrgAddress(e.target.value)}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              This address will appear as the supplier / biller address on all printed tax invoices.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Pincode
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/10 text-slate-800 font-mono shadow-2xs"
                placeholder="e.g. 121006"
                maxLength={6}
                value={editOrgPincode}
                onChange={(e) => setEditOrgPincode(e.target.value)}
              />
            </div>

            <div className="flex items-center text-xs text-slate-600 pt-2 sm:pt-6">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-[11px] font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                Live sync with Invoices & Returns
              </span>
            </div>
          </div>

          {editError && (
            <div className="text-xs text-rose-600 font-medium bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">
              {editError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-4 py-2 text-xs rounded-xl"
              onClick={() => setShowEdit(null)}
              disabled={updatingClient}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs text-xs rounded-xl"
              isLoading={updatingClient}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
