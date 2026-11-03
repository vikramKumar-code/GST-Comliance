import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { requestOtp, verifyOtp, searchGstin } from '../api/auth.api';
import {
  prepareGstr1,
  saveGstr1,
  getGstr1,
  getGstr2b,
  getGstr3b,
  seedSampleInvoices
} from '../api/returns.api';
import { getLastMonthPeriod } from '../hooks/useReturns';
import PeriodSelector from '../components/PeriodSelector';
import NilReturnModal from '../components/NilReturnModal';
import ItcReconciliationModal from '../components/ItcReconciliationModal';
import Gstr1EvcModal from '../components/Gstr1EvcModal';
import DrcAuditSimulator from '../components/compliance/DrcAuditSimulator';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';
import { formatCurrency, formatPeriod, formatDate } from '../utils/format';
import {
  ShieldCheck,
  Building2,
  Lock,
  ArrowRight,
  TrendingUp,
  Layers,
  Scale,
  RefreshCw,
  UploadCloud,
  FileCode2,
  Zap,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  X,
  FileText,
  Store,
  ShoppingBag,
  FileEdit,
  Plane,
  Tag,
  Files,
  ArrowDownLeft,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Sparkles,
  Plus,
  Download
} from 'lucide-react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import MetricCard from '../components/ui/MetricCard';
import PageHeader from '../components/ui/PageHeader';

export default function GstReturnHubPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Period state
  const initialPeriod = searchParams.get('period') || getLastMonthPeriod();
  const [period, setPeriod] = useState(initialPeriod);

  // Active Main Return Card: 'gstr1' | 'gstr2b' | 'gstr3b'
  const initialReturn = searchParams.get('return') || 'gstr1';
  const [selectedReturn, setSelectedReturn] = useState(initialReturn);

  // -------------------------------------------------------------
  // STEP 1: AUTHENTICATION STATE (SCREEN 1 vs SCREEN 2)
  // -------------------------------------------------------------
  const [isVerified, setIsVerified] = useState(() => {
    return sessionStorage.getItem('gstin_verified_session') === 'true';
  });

  const [authGstin, setAuthGstin] = useState(
    sessionStorage.getItem('gstin_verified_number') || user?.gstin || '29AABCU9603R1Z2'
  );
  const [authUsername, setAuthUsername] = useState(
    sessionStorage.getItem('gstin_verified_user') || user?.email?.split('@')[0] || 'taxpayer_user'
  );

  useEffect(() => {
    if (user?.gstin && !sessionStorage.getItem('gstin_verified_number')) {
      setAuthGstin(user.gstin);
    }
    if (user?.email && !sessionStorage.getItem('gstin_verified_user')) {
      setAuthUsername(user.email.split('@')[0]);
    }
  }, [user?.gstin, user?.email]);
  const [taxpayerDetails, setTaxpayerDetails] = useState(null);
  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [authConsent, setAuthConsent] = useState(true);
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authErrorMsg, setAuthErrorMsg] = useState(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState(null);

  // Auto-verify GSTIN name on demand
  const handleVerifyGstinName = async () => {
    if (!authGstin || authGstin.length < 15) {
      setAuthErrorMsg('Please enter a valid 15-character GSTIN first.');
      return;
    }
    setVerifyingGstin(true);
    setAuthErrorMsg(null);
    try {
      const res = await searchGstin(authGstin.trim().toUpperCase());
      setTaxpayerDetails(res);
      setAuthSuccessMsg(`Registered Business: ${res.legalName || res.tradeName || 'Active Taxpayer'}`);
    } catch (err) {
      setAuthErrorMsg(err?.message || 'Could not verify GSTIN details.');
    } finally {
      setVerifyingGstin(false);
    }
  };

  // Request OTP from Govt Portal via API
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    if (!authGstin || authGstin.length < 15) {
      setAuthErrorMsg('Please enter a valid 15-digit GSTIN.');
      return;
    }
    if (!authUsername.trim()) {
      setAuthErrorMsg('Please enter your GST portal username.');
      return;
    }
    if (!authConsent) {
      setAuthErrorMsg('Please accept authorization consent to fetch returns.');
      return;
    }

    setAuthLoading(true);
    setAuthErrorMsg(null);
    setAuthSuccessMsg(null);
    try {
      const res = await requestOtp({
        gstin: authGstin.trim().toUpperCase(),
        username: authUsername.trim(),
        consent: authConsent
      });
      setOtpSent(true);
      setAuthSuccessMsg(res?.message || 'OTP sent successfully to registered mobile/email.');
    } catch (err) {
      setAuthErrorMsg(err?.message || 'Failed to request OTP from GST Portal.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Verify OTP & enter return dashboard
  const handleVerifyOtpAndEnter = async (e) => {
    e?.preventDefault();
    if (!otpInput.trim()) {
      setAuthErrorMsg('Please enter the OTP received.');
      return;
    }

    setAuthLoading(true);
    setAuthErrorMsg(null);
    try {
      await verifyOtp({
        gstin: authGstin.trim().toUpperCase(),
        username: authUsername.trim(),
        otp: otpInput.trim()
      });
      sessionStorage.setItem('gstin_verified_session', 'true');
      sessionStorage.setItem('gstin_verified_number', authGstin.trim().toUpperCase());
      sessionStorage.setItem('gstin_verified_user', authUsername.trim());
      setIsVerified(true);
      setOtpSent(false);
      setOtpInput('');
      setAuthSuccessMsg(`Authentication Successful! Logged in as ${authGstin}`);
      fetchGstr1Data(period, excludedIds);
      fetchOtherReturns(period);
    } catch (err) {
      setAuthErrorMsg(err?.message || 'Invalid or expired OTP. Please retry.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Quick bypass for testing with active workspace
  const handleQuickEnterWithWorkspace = () => {
    sessionStorage.setItem('gstin_verified_session', 'true');
    sessionStorage.setItem('gstin_verified_number', authGstin);
    sessionStorage.setItem('gstin_verified_user', authUsername);
    setIsVerified(true);
    fetchGstr1Data(period, excludedIds);
    fetchOtherReturns(period);
  };

  // Switch GSTIN / Re-verify
  const handleSwitchGstin = () => {
    sessionStorage.removeItem('gstin_verified_session');
    setIsVerified(false);
    setOtpSent(false);
    setOtpInput('');
    setAuthSuccessMsg(null);
    setAuthErrorMsg(null);
  };

  // -------------------------------------------------------------
  // STEP 2 & 3: RETURN DATA & GSTR-1 7 SECTION CARDS
  // -------------------------------------------------------------
  const [gstr1Loading, setGstr1Loading] = useState(true);
  const [gstr1Error, setGstr1Error] = useState(null);
  const [prepareData, setPrepareData] = useState(null);
  const [savingReturn, setSavingReturn] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // GSTR-1 View Mode: 'taxpro' (Govt Portal return) vs 'local' (Local Invoices preparation)
  const [gstr1ViewMode, setGstr1ViewMode] = useState('taxpro');
  const [liveGstr1Data, setLiveGstr1Data] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);

  // Set of excluded invoice IDs (Safe exclusion without DB deletion)
  const [excludedIds, setExcludedIds] = useState(new Set());

  // Active section drilldown
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [tableSearch, setTableSearch] = useState('');

  // Modals
  const [isNilModalOpen, setIsNilModalOpen] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [isEvcModalOpen, setIsEvcModalOpen] = useState(false);
  const [evcReturnType, setEvcReturnType] = useState('GSTR1');

  // Export GST Offline Tool JSON
  const handleDownloadOfflineJson = () => {
    const payload = prepareData?.payload || {};
    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${authGstin}_${period}_offline.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export Tally ERP XML
  const handleDownloadTallyXml = () => {
    const invoices = (prepareData?.payload?.b2b || []).flatMap((p) =>
      (p.inv || []).map((inv) => ({
        ctin: p.ctin,
        inum: inv.inum,
        idt: inv.idt,
        val: inv.val
      }))
    );

    const xmlLines = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<ENVELOPE>',
      '  <HEADER>',
      '    <TALLYREQUEST>Import Data</TALLYREQUEST>',
      '  </HEADER>',
      '  <BODY>',
      '    <IMPORTDATA>',
      '      <REQUESTDATA>',
      '        <TALLYMESSAGE xmlns:UDF="TallyUDF">'
    ];

    if (invoices.length === 0) {
      xmlLines.push(
        '          <!-- No B2B transactions recorded for this return period -->',
        '          <INFO>No taxable sales records to export.</INFO>'
      );
    } else {
      invoices.forEach((inv) => {
        xmlLines.push(
          '          <VOUCHER VCHTYPE="Sales" ACTION="Create">',
          `            <DATE>${(inv.idt || '').replace(/-/g, '')}</DATE>`,
          `            <VOUCHERNUMBER>${inv.inum}</VOUCHERNUMBER>`,
          `            <PARTYLEDGERNAME>${inv.ctin}</PARTYLEDGERNAME>`,
          `            <PARTYNAME>${inv.ctin}</PARTYNAME>`,
          `            <AMOUNT>-${inv.val}</AMOUNT>`,
          '            <ALLLEDGERENTRIES.LIST>',
          '              <LEDGERNAME>Sales GST Account</LEDGERNAME>',
          '              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>',
          `              <AMOUNT>${inv.val}</AMOUNT>`,
          '            </ALLLEDGERENTRIES.LIST>',
          '          </VOUCHER>'
        );
      });
    }

    xmlLines.push(
      '        </TALLYMESSAGE>',
      '      </REQUESTDATA>',
      '    </IMPORTDATA>',
      '  </BODY>',
      '</ENVELOPE>'
    );

    const blob = new Blob([xmlLines.join('\n')], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Tally_Sales_${authGstin}_${period}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = () => {
    const payload = prepareData?.payload || {};
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // GSTR-2B & GSTR-3B data
  const [gstr2bData, setGstr2bData] = useState(null);
  const [gstr3bData, setGstr3bData] = useState(null);
  const [otherReturnsLoading, setOtherReturnsLoading] = useState(false);

  // Fetch GSTR-1: Both Local Invoices Preparation & Official Govt Portal Return
  const fetchGstr1Data = useCallback(async (p, currentExcluded = excludedIds) => {
    if (!p) return;
    setGstr1Loading(true);
    setGstr1Error(null);
    setSaveResult(null);
    try {
      const [prepareRes, portalRes] = await Promise.allSettled([
        prepareGstr1(p, Array.from(currentExcluded)),
        getGstr1(p)
      ]);
      if (prepareRes.status === 'fulfilled') {
        setPrepareData(prepareRes.value);
      }
      if (portalRes.status === 'fulfilled') {
        setLiveGstr1Data(portalRes.value);
      }
    } catch (err) {
      setGstr1Error(err);
    } finally {
      setGstr1Loading(false);
    }
  }, [excludedIds]);

  // Fetch Live GSTR-1 from TaxPro API
  const fetchLiveGstr1FromTaxPro = async () => {
    setLiveLoading(true);
    try {
      const res = await getGstr1(period);
      setLiveGstr1Data(res);
      setGstr1ViewMode('taxpro');
    } catch (err) {
      setGstr1Error(err);
    } finally {
      setLiveLoading(false);
    }
  };

  // Fetch GSTR-2B & GSTR-3B
  const fetchOtherReturns = useCallback(async (p) => {
    if (!p) return;
    setOtherReturnsLoading(true);
    try {
      const [res2b, res3b] = await Promise.allSettled([
        getGstr2b(p),
        getGstr3b(p)
      ]);
      if (res2b.status === 'fulfilled') setGstr2bData(res2b.value);
      if (res3b.status === 'fulfilled') setGstr3bData(res3b.value);
    } catch {
      // Ignored non-fatal
    } finally {
      setOtherReturnsLoading(false);
    }
  }, []);

  // Sample invoice generation state
  const [seeding, setSeeding] = useState(false);
  const [seedSuccessMsg, setSeedSuccessMsg] = useState(null);

  // Generate demo sample invoices for testing returns
  const handleSeedSampleInvoices = async () => {
    setSeeding(true);
    setSeedSuccessMsg(null);
    try {
      const res = await seedSampleInvoices(period);
      setSeedSuccessMsg(res?.message || 'Sample invoices generated successfully!');
      await fetchGstr1Data(period, excludedIds);
    } catch (err) {
      console.error('Failed to generate sample invoices:', err);
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    if (isVerified) {
      fetchGstr1Data(period, excludedIds);
      fetchOtherReturns(period);
    }
  }, [period, isVerified]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    setSearchParams({ period: newPeriod, return: selectedReturn });
    setExcludedIds(new Set());
    setSaveResult(null);
    setLiveGstr1Data(null);
  };

  const handleSelectReturnCard = (returnKey) => {
    setSelectedReturn(returnKey);
    setSearchParams({ period, return: returnKey });
  };

  // Toggle invoice exclusion without deleting from DB
  const toggleExcludeInvoice = (invoiceId) => {
    const idStr = String(invoiceId);
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idStr)) next.delete(idStr);
      else next.add(idStr);
      fetchGstr1Data(period, next);
      return next;
    });
  };

  // Save / Upload GSTR-1 to Govt Portal
  const handleSaveReturn = async () => {
    setSavingReturn(true);
    setGstr1Error(null);
    try {
      const res = await saveGstr1(period, Array.from(excludedIds));
      setSaveResult(res);
    } catch (err) {
      setGstr1Error(err);
    } finally {
      setSavingReturn(false);
    }
  };

  const summary = prepareData?.summary || {};
  const sectionDetails = prepareData?.sectionDetails || {
    b2b: [],
    b2cl: [],
    b2cs: [],
    exp: [],
    cdnr: [],
    hsn: [],
    docIssue: []
  };

  // Determine if Government Portal Data is available
  const hasLocalInvoices = (summary?.totalInvoices || 0) > 0;
  const hasPortalGstr1 = Boolean(
    (liveGstr1Data?.totals?.taxable || 0) > 0 ||
    (liveGstr1Data?.rows && liveGstr1Data.rows.length > 0) ||
    liveGstr1Data?.fetchedAt
  );

  // View Mode: Direct toggle between 'taxpro' (Govt Portal) and 'local' (Local Invoices)
  const isPortalGstr1Active = gstr1ViewMode === 'taxpro';

  // 1. Map portal Table 4: B2B Invoices with real invoice number, date, buyer GSTIN
  const portalB2bItems = useMemo(() => {
    if (!liveGstr1Data) return [];

    // Direct invoices array from server mapper
    if (Array.isArray(liveGstr1Data.invoices) && liveGstr1Data.invoices.length > 0) {
      return liveGstr1Data.invoices.map((inv, i) => {
        const rawDate = inv.idt || inv.invoiceDate;
        return {
          _id: inv._id || `portal-inv-${i}`,
          invoiceNumber: inv.inum || inv.invoiceNumber || `INV-${i + 1}`,
          customerName: inv.trdnm || inv.cname || inv.customerName || 'Registered Buyer',
          customerGstin: inv.ctin || inv.customerGstin || 'Registered Taxpayer',
          invoiceDate: rawDate,
          dateFormatted: formatDate(rawDate),
          taxableAmount: Number(inv.taxable || inv.taxableAmount || 0),
          igst: Number(inv.igst || 0),
          cgst: Number(inv.cgst || 0),
          sgst: Number(inv.sgst || 0),
          grandTotal: Number(inv.val || inv.grandTotal || (Number(inv.taxable || 0) + Number(inv.igst || 0) + Number(inv.cgst || 0) + Number(inv.sgst || 0))),
          isPortal: true
        };
      });
    }

    // Direct b2b structure from GSTN / TaxPro payload
    if (Array.isArray(liveGstr1Data.b2b) && liveGstr1Data.b2b.length > 0) {
      const items = [];
      liveGstr1Data.b2b.forEach((buyer, bIdx) => {
        const ctin = buyer.ctin || 'Registered Taxpayer';
        const cname = buyer.trdnm || buyer.cname || 'Registered Buyer';
        (buyer.inv || []).forEach((inv, iIdx) => {
          let taxable = 0, igst = 0, cgst = 0, sgst = 0;
          const itms = inv.itms || inv.items || [];
          if (itms.length > 0) {
            itms.forEach(itm => {
              const d = itm.itm_det || itm;
              taxable += Number(d.txval || 0);
              igst += Number(d.iamt || d.igst || 0);
              cgst += Number(d.camt || d.cgst || 0);
              sgst += Number(d.samt || d.sgst || 0);
            });
          } else {
            taxable = Number(inv.txval || inv.val || 0);
            igst = Number(inv.iamt || inv.igst || 0);
            cgst = Number(inv.camt || inv.cgst || 0);
            sgst = Number(inv.samt || inv.sgst || 0);
          }
          const rawDate = inv.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-b2b-${bIdx}-${iIdx}`,
            invoiceNumber: inv.inum || `INV-${items.length + 1}`,
            customerName: cname,
            customerGstin: ctin,
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst,
            sgst,
            grandTotal: Number(inv.val || (taxable + igst + cgst + sgst)),
            isPortal: true
          });
        });
      });
      if (items.length > 0) return items;
    }

    // Fallback from rows
    if (Array.isArray(liveGstr1Data.rows) && liveGstr1Data.rows.length > 0) {
      return liveGstr1Data.rows
        .filter(r => !r.label?.startsWith('5 -') && !r.label?.startsWith('7 -') && !r.label?.startsWith('9B -') && !r.label?.startsWith('6A -'))
        .map((r, i) => {
          const gstinMatch = r.label?.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/);
          const ctin = r.ctin || gstinMatch?.[0] || 'Registered Taxpayer';
          const rawDate = r.idt || r.invoiceDate;
          return {
            _id: `portal-b2b-row-${i}`,
            invoiceNumber: r.inum || r.invoiceNumber || (r.label?.includes('•') ? r.label.split('•')[1].trim() : `INV-${period}-${i + 1}`),
            customerName: r.trdnm || r.cname || (r.label ? r.label.split('(')[0].trim() : 'Registered Buyer'),
            customerGstin: ctin,
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: Number(r.taxable || 0),
            igst: Number(r.igst || 0),
            cgst: Number(r.cgst || 0),
            sgst: Number(r.sgst || 0),
            grandTotal: Number(r.val || ((r.taxable || 0) + (r.igst || 0) + (r.cgst || 0) + (r.sgst || 0))),
            isPortal: true
          };
        });
    }

    return [];
  }, [liveGstr1Data, period]);

  // 2. Map portal Table 5: B2C (Large)
  const portalB2clItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.b2cl) && liveGstr1Data.b2cl.length > 0) {
      const items = [];
      liveGstr1Data.b2cl.forEach((b, bIdx) => {
        (b.inv || []).forEach((inv, iIdx) => {
          let taxable = 0, igst = 0, cess = 0;
          (inv.itms || []).forEach((itm) => {
            const d = itm.itm_det || itm;
            taxable += Number(d.txval || 0);
            igst += Number(d.iamt || d.igst || 0);
            cess += Number(d.csamt || d.cess || 0);
          });
          const rawDate = inv.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-b2cl-${bIdx}-${iIdx}`,
            invoiceNumber: inv.inum || `B2CL-${items.length + 1}`,
            customerName: `Unregistered Buyer (POS: ${b.pos || inv.pos || 'Inter-state'})`,
            customerGstin: 'Unregistered Consumer',
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst: 0,
            sgst: 0,
            grandTotal: Number(inv.val || (taxable + igst + cess)),
            isPortal: true
          });
        });
      });
      if (items.length > 0) return items;
    }
    if (Array.isArray(liveGstr1Data.rows)) {
      return liveGstr1Data.rows
        .filter(r => r.label?.startsWith('5 - B2C Large'))
        .map((r, i) => ({
          _id: `portal-b2cl-row-${i}`,
          invoiceNumber: r.inum || `B2CL-${period}-${i + 1}`,
          customerName: r.trdnm || 'Unregistered Inter-state Consumer',
          customerGstin: 'Unregistered',
          invoiceDate: r.idt,
          dateFormatted: formatDate(r.idt),
          taxableAmount: Number(r.taxable || 0),
          igst: Number(r.igst || 0),
          cgst: 0,
          sgst: 0,
          grandTotal: Number(r.val || ((r.taxable || 0) + (r.igst || 0))),
          isPortal: true
        }));
    }
    return [];
  }, [liveGstr1Data, period]);

  // 3. Map portal Table 7: B2C (Small)
  const portalB2csItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.b2cs) && liveGstr1Data.b2cs.length > 0) {
      return liveGstr1Data.b2cs.map((item, i) => {
        const taxable = Number(item.txval || 0);
        const igst = Number(item.iamt || item.igst || 0);
        const cgst = Number(item.camt || item.cgst || 0);
        const sgst = Number(item.samt || item.sgst || 0);
        const cess = Number(item.csamt || item.cess || 0);
        return {
          _id: `portal-b2cs-${i}`,
          invoiceNumber: `B2CS-POS-${item.pos || '00'}`,
          customerName: `Retail Consumer (Rate: ${item.rt !== undefined ? item.rt + '%' : 'Standard'})`,
          customerGstin: 'Unregistered',
          invoiceDate: liveGstr1Data.fetchedAt,
          dateFormatted: formatDate(liveGstr1Data.fetchedAt),
          taxableAmount: taxable,
          igst,
          cgst,
          sgst,
          grandTotal: taxable + igst + cgst + sgst + cess,
          isPortal: true
        };
      });
    }
    if (Array.isArray(liveGstr1Data.rows)) {
      return liveGstr1Data.rows
        .filter(r => r.label?.startsWith('7 - B2C Supplies'))
        .map((r, i) => ({
          _id: `portal-b2cs-row-${i}`,
          invoiceNumber: `B2CS-Summary-${i + 1}`,
          customerName: r.label,
          customerGstin: 'Unregistered',
          invoiceDate: r.idt,
          dateFormatted: formatDate(r.idt),
          taxableAmount: Number(r.taxable || 0),
          igst: Number(r.igst || 0),
          cgst: Number(r.cgst || 0),
          sgst: Number(r.sgst || 0),
          grandTotal: Number(r.taxable || 0) + Number(r.igst || 0) + Number(r.cgst || 0) + Number(r.sgst || 0),
          isPortal: true
        }));
    }
    return [];
  }, [liveGstr1Data]);

  // 4. Map portal Table 9B: Credit / Debit Notes
  const portalCdnrItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.cdnr) && liveGstr1Data.cdnr.length > 0) {
      const items = [];
      liveGstr1Data.cdnr.forEach((party, pIdx) => {
        const ctin = party.ctin || 'Registered Party';
        (party.nt || []).forEach((nt, nIdx) => {
          let taxable = 0, igst = 0, cgst = 0, sgst = 0;
          (nt.itms || []).forEach((itm) => {
            const d = itm.itm_det || itm;
            taxable += Number(d.txval || 0);
            igst += Number(d.iamt || d.igst || 0);
            cgst += Number(d.camt || d.cgst || 0);
            sgst += Number(d.samt || d.sgst || 0);
          });
          const rawDate = nt.nt_dt || nt.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-cdnr-${pIdx}-${nIdx}`,
            invoiceNumber: nt.nt_num || `NOTE-${items.length + 1}`,
            customerName: party.trdnm || party.cname || 'Registered Party',
            customerGstin: ctin,
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst,
            sgst,
            grandTotal: taxable + igst + cgst + sgst,
            isPortal: true
          });
        });
      });
      if (items.length > 0) return items;
    }
    if (Array.isArray(liveGstr1Data.rows)) {
      return liveGstr1Data.rows
        .filter(r => r.label?.startsWith('9B - Credit/Debit'))
        .map((r, i) => ({
          _id: `portal-cdnr-row-${i}`,
          invoiceNumber: r.inum || `NOTE-${i + 1}`,
          customerName: r.trdnm || 'Registered Party',
          customerGstin: r.ctin || 'Registered',
          invoiceDate: r.idt,
          dateFormatted: formatDate(r.idt),
          taxableAmount: Number(r.taxable || 0),
          igst: Number(r.igst || 0),
          cgst: Number(r.cgst || 0),
          sgst: Number(r.sgst || 0),
          grandTotal: Number(r.val || ((r.taxable || 0) + (r.igst || 0) + (r.cgst || 0) + (r.sgst || 0))),
          isPortal: true
        }));
    }
    return [];
  }, [liveGstr1Data]);

  // 5. Map portal Table 6A: Exports
  const portalExpItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (Array.isArray(liveGstr1Data.exp) && liveGstr1Data.exp.length > 0) {
      const items = [];
      liveGstr1Data.exp.forEach((group, gIdx) => {
        (group.inv || []).forEach((inv, iIdx) => {
          let taxable = 0, igst = 0;
          (inv.itms || []).forEach((itm) => {
            const d = itm.itm_det || itm;
            taxable += Number(d.txval || 0);
            igst += Number(d.iamt || d.igst || 0);
          });
          const rawDate = inv.idt || liveGstr1Data.fetchedAt;
          items.push({
            _id: `portal-exp-${gIdx}-${iIdx}`,
            invoiceNumber: inv.inum || `EXP-${items.length + 1}`,
            customerName: `Overseas Importer (${group.exp_typ || 'WOPAY'})`,
            customerGstin: 'Export Supply',
            invoiceDate: rawDate,
            dateFormatted: formatDate(rawDate),
            taxableAmount: taxable,
            igst,
            cgst: 0,
            sgst: 0,
            grandTotal: taxable + igst,
            isPortal: true
          });
        });
      });
      if (items.length > 0) return items;
    }
    if (Array.isArray(liveGstr1Data.rows)) {
      return liveGstr1Data.rows
        .filter(r => r.label?.startsWith('6A - Export'))
        .map((r, i) => ({
          _id: `portal-exp-row-${i}`,
          invoiceNumber: r.inum || `EXP-${i + 1}`,
          customerName: r.label,
          customerGstin: 'Export',
          invoiceDate: r.idt,
          dateFormatted: formatDate(r.idt),
          taxableAmount: Number(r.taxable || 0),
          igst: Number(r.igst || 0),
          cgst: 0,
          sgst: 0,
          grandTotal: Number(r.val || ((r.taxable || 0) + (r.igst || 0))),
          isPortal: true
        }));
    }
    return [];
  }, [liveGstr1Data]);

  // 6. Map portal Table 12: HSN Summary
  const portalHsnItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    const hsnData = liveGstr1Data.hsn?.data || (Array.isArray(liveGstr1Data.hsn) ? liveGstr1Data.hsn : null);
    if (Array.isArray(hsnData) && hsnData.length > 0) {
      return hsnData.map((h, i) => ({
        _id: `portal-hsn-${i}`,
        invoiceNumber: h.hsn_sc || `HSN-${i + 1}`,
        customerName: h.desc || 'General Goods/Services',
        customerGstin: `Qty: ${h.qty || 1} ${h.uqc || 'NOS'}`,
        taxableAmount: Number(h.txval || 0),
        igst: Number(h.iamt || h.igst || 0),
        cgst: Number(h.camt || h.cgst || 0),
        sgst: Number(h.samt || h.sgst || 0),
        grandTotal: Number(h.txval || 0) + Number(h.iamt || 0) + Number(h.camt || 0) + Number(h.samt || 0),
        isHsnRow: true,
        isPortal: true
      }));
    }
    if (portalB2bItems.length > 0) {
      return portalB2bItems.map((inv, idx) => ({
        _id: `portal-hsn-syn-${idx}`,
        invoiceNumber: '998311',
        customerName: `Goods & Services for ${inv.customerName}`,
        customerGstin: 'HSN Classified',
        taxableAmount: inv.taxableAmount,
        igst: inv.igst,
        cgst: inv.cgst,
        sgst: inv.sgst,
        grandTotal: inv.grandTotal,
        isHsnRow: true,
        isPortal: true
      }));
    }
    return [];
  }, [liveGstr1Data, portalB2bItems]);

  // 7. Map portal Table 13: Documents Issued
  const portalDocItems = useMemo(() => {
    if (!liveGstr1Data) return [];
    if (portalB2bItems.length > 0) {
      const nums = portalB2bItems.map(i => i.invoiceNumber).filter(Boolean);
      const from = nums[0] || 'INV-001';
      const to = nums[nums.length - 1] || 'INV-001';
      return [{
        _id: 'portal-doc-1',
        invoiceNumber: `${from} to ${to}`,
        customerName: 'Tax Invoices Serial Series',
        customerGstin: `${nums.length} Documents Issued`,
        taxableAmount: nums.length,
        grandTotal: nums.length,
        isDocRow: true,
        isPortal: true
      }];
    }
    return [];
  }, [liveGstr1Data, portalB2bItems]);

  // Aggregate all portal invoices across categories for full document tracking
  const portalAllInvoices = useMemo(() => {
    return [
      ...portalB2bItems,
      ...portalB2clItems,
      ...portalB2csItems,
      ...portalExpItems,
      ...portalCdnrItems
    ];
  }, [portalB2bItems, portalB2clItems, portalB2csItems, portalExpItems, portalCdnrItems]);

  // Portal section sums
  const portalB2clTaxable = portalB2clItems.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
  const portalB2clTax = portalB2clItems.reduce((acc, i) => acc + (i.igst || 0) + (i.cgst || 0) + (i.sgst || 0), 0);

  const portalB2csTaxable = portalB2csItems.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
  const portalB2csTax = portalB2csItems.reduce((acc, i) => acc + (i.igst || 0) + (i.cgst || 0) + (i.sgst || 0), 0);

  const portalCdnrTaxable = portalCdnrItems.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
  const portalCdnrTax = portalCdnrItems.reduce((acc, i) => acc + (i.igst || 0) + (i.cgst || 0) + (i.sgst || 0), 0);

  const portalExpTaxable = portalExpItems.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
  const portalExpTax = portalExpItems.reduce((acc, i) => acc + (i.igst || 0), 0);

  const portalHsnTaxable = portalHsnItems.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
  const portalHsnTax = portalHsnItems.reduce((acc, i) => acc + (i.igst || 0) + (i.cgst || 0) + (i.sgst || 0), 0);

  // Effective GSTR-1 figures
  const g1Taxable = isPortalGstr1Active
    ? Number(liveGstr1Data?.totals?.taxable || 0)
    : Number(summary?.totalTaxable || 0);

  const g1Igst = isPortalGstr1Active
    ? Number(liveGstr1Data?.totals?.igst || 0)
    : Number(summary?.totalIgst || 0);

  const g1Cgst = isPortalGstr1Active
    ? Number(liveGstr1Data?.totals?.cgst || 0)
    : Number(summary?.totalCgst || 0);

  const g1Sgst = isPortalGstr1Active
    ? Number(liveGstr1Data?.totals?.sgst || 0)
    : Number(summary?.totalSgst || 0);

  const g1TotalTax = isPortalGstr1Active
    ? Number((g1Igst + g1Cgst + g1Sgst).toFixed(2))
    : Number(summary?.totalTax || 0);

  const g1InvoiceCount = isPortalGstr1Active
    ? (portalB2bItems.length || (g1Taxable > 0 ? 1 : 0))
    : Number(summary?.totalInvoices || 0);

  // Due Date (11th of succeeding month)
  const dueDateDisplay = useMemo(() => {
    if (!period || period.length !== 6) return '11th of next month';
    const month = parseInt(period.slice(0, 2), 10);
    const year = parseInt(period.slice(2), 10);
    const nextDate = new Date(year, month, 11);
    return nextDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }, [period]);

  // -------------------------------------------------------------
  // DYNAMIC STATUTORY CALCULATIONS (GSTR-1, GSTR-2B & GSTR-3B)
  // -------------------------------------------------------------
  const g2bTotals = gstr2bData?.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const g2bTotalTax = Number(
    ((g2bTotals.igst || 0) + (g2bTotals.cgst || 0) + (g2bTotals.sgst || 0) + (g2bTotals.cess || 0)).toFixed(2)
  );
  const g2bCount = (gstr2bData?.invoices?.length || gstr2bData?.rows?.length) ?? 0;

  const g3bTotals = gstr3bData?.totals || { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const outwardLiability = Number(
    (g1TotalTax > 0
      ? g1TotalTax
      : (g3bTotals.igst || 0) + (g3bTotals.cgst || 0) + (g3bTotals.sgst || 0) + (g3bTotals.cess || 0)
    ).toFixed(2)
  );
  const eligibleItcAmount = g2bTotalTax;
  const itcUtilized = Math.min(outwardLiability, eligibleItcAmount);
  const netCashPayable = Math.max(0, Number((outwardLiability - itcUtilized).toFixed(2)));

  // Settlement Ledger Head Wise
  const settlementIgst = isPortalGstr1Active ? (g1Igst || g3bTotals.igst || 0) : (summary?.totalIgst || g3bTotals.igst || 0);
  const settlementCgst = isPortalGstr1Active ? (g1Cgst || g3bTotals.cgst || 0) : (summary?.totalCgst || g3bTotals.cgst || 0);
  const settlementSgst = isPortalGstr1Active ? (g1Sgst || g3bTotals.sgst || 0) : (summary?.totalSgst || g3bTotals.sgst || 0);

  // The 7 Section Cards from GSTR-1 Schema: 100% Dynamic between Govt Portal and Local Invoices
  const SECTION_CARDS = [
    {
      key: 'b2b',
      tableCode: 'Table 4',
      title: 'B2B Invoices',
      subtitle: isPortalGstr1Active ? 'Filed B2B supplies retrieved from GST portal' : 'Taxable supplies to registered persons',
      icon: Building2,
      count: isPortalGstr1Active ? portalB2bItems.length : (summary.sections?.b2bCount ?? sectionDetails.b2b?.length ?? 0),
      included: isPortalGstr1Active ? portalB2bItems.length : (summary.sections?.b2bIncluded ?? sectionDetails.b2b?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active ? (portalB2bItems.reduce((acc, i) => acc + (i.taxableAmount || 0), 0) || g1Taxable) : (summary.sections?.b2bTaxable ?? 0),
      tax: isPortalGstr1Active ? (portalB2bItems.reduce((acc, i) => acc + (i.igst || 0) + (i.cgst || 0) + (i.sgst || 0), 0) || g1TotalTax) : (summary.sections?.b2bTax ?? 0),
      items: isPortalGstr1Active ? portalB2bItems : (sectionDetails.b2b || []),
      color: 'blue'
    },
    {
      key: 'b2cl',
      tableCode: 'Table 5',
      title: 'B2C (Large)',
      subtitle: isPortalGstr1Active ? 'Inter-state consumer supplies > ₹2.5L (Portal)' : 'Inter-state supplies to consumers > ₹2.5 Lakhs',
      icon: Store,
      count: isPortalGstr1Active ? portalB2clItems.length : (summary.sections?.b2clCount ?? sectionDetails.b2cl?.length ?? 0),
      included: isPortalGstr1Active ? portalB2clItems.length : (summary.sections?.b2clIncluded ?? sectionDetails.b2cl?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active ? portalB2clTaxable : (summary.sections?.b2clTaxable ?? 0),
      tax: isPortalGstr1Active ? portalB2clTax : (summary.sections?.b2clTax ?? 0),
      items: isPortalGstr1Active ? portalB2clItems : (sectionDetails.b2cl || []),
      color: 'indigo'
    },
    {
      key: 'b2cs',
      tableCode: 'Table 7',
      title: 'B2C (Small)',
      subtitle: isPortalGstr1Active ? 'Intra-state & small retail supplies (Portal)' : 'Intra-state & small consumer supplies',
      icon: ShoppingBag,
      count: isPortalGstr1Active ? portalB2csItems.length : (summary.sections?.b2csCount ?? sectionDetails.b2cs?.length ?? 0),
      included: isPortalGstr1Active ? portalB2csItems.length : (summary.sections?.b2csIncluded ?? sectionDetails.b2cs?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active ? portalB2csTaxable : (summary.sections?.b2csTaxable ?? 0),
      tax: isPortalGstr1Active ? portalB2csTax : (summary.sections?.b2csTax ?? 0),
      items: isPortalGstr1Active ? portalB2csItems : (sectionDetails.b2cs || []),
      color: 'teal'
    },
    {
      key: 'cdnr',
      tableCode: 'Table 9B',
      title: 'Credit / Debit Notes',
      subtitle: isPortalGstr1Active ? 'Registered buyer adjustments (Portal)' : 'Registered buyer credit/debit adjustments',
      icon: FileEdit,
      count: isPortalGstr1Active ? portalCdnrItems.length : (summary.sections?.cdnrCount ?? sectionDetails.cdnr?.length ?? 0),
      included: isPortalGstr1Active ? portalCdnrItems.length : (sectionDetails.cdnr?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active ? portalCdnrTaxable : 0,
      tax: isPortalGstr1Active ? portalCdnrTax : 0,
      items: isPortalGstr1Active ? portalCdnrItems : (sectionDetails.cdnr || []),
      color: 'amber'
    },
    {
      key: 'exp',
      tableCode: 'Table 6A',
      title: 'Exports (EXP)',
      subtitle: isPortalGstr1Active ? 'Zero-rated export supplies (Portal)' : 'Zero-rated export supplies with/without duty',
      icon: Plane,
      count: isPortalGstr1Active ? portalExpItems.length : (summary.sections?.expCount ?? sectionDetails.exp?.length ?? 0),
      included: isPortalGstr1Active ? portalExpItems.length : (summary.sections?.expIncluded ?? sectionDetails.exp?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active ? portalExpTaxable : (summary.sections?.expTaxable ?? 0),
      tax: isPortalGstr1Active ? portalExpTax : (summary.sections?.expTax ?? 0),
      items: isPortalGstr1Active ? portalExpItems : (sectionDetails.exp || []),
      color: 'purple'
    },
    {
      key: 'hsn',
      tableCode: 'Table 12',
      title: 'HSN Summary',
      subtitle: isPortalGstr1Active ? 'HSN/SAC summary of supplies (Portal)' : 'HSN/SAC summary of outward supplies',
      icon: Tag,
      count: isPortalGstr1Active ? (portalHsnItems.length || (g1Taxable > 0 ? 1 : 0)) : (summary.sections?.hsnCount ?? 0),
      included: isPortalGstr1Active ? (portalHsnItems.length || (g1Taxable > 0 ? 1 : 0)) : (summary.sections?.hsnCount ?? 0),
      taxable: isPortalGstr1Active ? (portalHsnTaxable || g1Taxable) : (summary.totalTaxable ?? 0),
      tax: isPortalGstr1Active ? (portalHsnTax || g1TotalTax) : (summary.totalTax ?? 0),
      items: isPortalGstr1Active ? portalHsnItems : (prepareData?.payload?.hsn?.data || []).map((h) => ({
        _id: `hsn-${h.num}`,
        invoiceNumber: h.hsn_sc,
        customerName: h.desc,
        taxableAmount: h.txval,
        igst: h.iamt,
        cgst: h.camt,
        sgst: h.samt,
        grandTotal: h.txval + h.iamt + h.camt + h.samt,
        isHsnRow: true
      })),
      color: 'emerald'
    },
    {
      key: 'docIssue',
      tableCode: 'Table 13',
      title: 'Documents Issued',
      subtitle: isPortalGstr1Active ? 'Invoice series range filed on portal' : 'Serial numbering of invoices & notes',
      icon: Files,
      count: isPortalGstr1Active
        ? (portalAllInvoices.length || portalB2bItems.length)
        : (sectionDetails.docIssueList?.length ?? summary.sections?.docRange?.totalCount ?? summary.totalInvoices ?? 0),
      included: isPortalGstr1Active
        ? (portalAllInvoices.length || portalB2bItems.length)
        : (sectionDetails.docIssueList?.filter((i) => !i.isExcluded)?.length ?? summary.sections?.docRange?.net_issue ?? summary.totalInvoices ?? 0),
      taxable: isPortalGstr1Active
        ? portalAllInvoices.reduce((acc, i) => acc + (i.taxableAmount || 0), 0)
        : (summary.totalTaxable ?? 0),
      tax: isPortalGstr1Active
        ? portalAllInvoices.reduce((acc, i) => acc + (i.igst || 0) + (i.cgst || 0) + (i.sgst || 0), 0)
        : (summary.totalTax ?? 0),
      items: isPortalGstr1Active
        ? (portalAllInvoices.length > 0 ? portalAllInvoices : portalDocItems)
        : ((sectionDetails.docIssueList && sectionDetails.docIssueList.length > 0)
            ? sectionDetails.docIssueList
            : [
                ...(sectionDetails.b2b || []),
                ...(sectionDetails.b2cl || []),
                ...(sectionDetails.b2cs || []),
                ...(sectionDetails.exp || []),
                ...(sectionDetails.cdnr || [])
              ]),
      docRange: isPortalGstr1Active
        ? {
            from: portalB2bItems[0]?.invoiceNumber || 'INV-001',
            to: portalB2bItems[portalB2bItems.length - 1]?.invoiceNumber || 'INV-001',
            totnum: portalAllInvoices.length || portalB2bItems.length,
            canc: 0,
            net_issue: portalAllInvoices.length || portalB2bItems.length
          }
        : (summary.sections?.docRange || sectionDetails.docIssue || null),
      color: 'rose'
    }
  ];

  const activeSection = SECTION_CARDS.find((c) => c.key === activeSectionKey);

  const modalFilteredItems = useMemo(() => {
    if (!activeSection) return [];
    if (!tableSearch.trim()) return activeSection.items;
    const q = tableSearch.toLowerCase();
    return activeSection.items.filter((item) =>
      item.invoiceNumber?.toLowerCase().includes(q) ||
      item.customerName?.toLowerCase().includes(q) ||
      item.customerGstin?.toLowerCase().includes(q)
    );
  }, [activeSection, tableSearch]);

  // ===================================================================
  // SCREEN 1: GOVT PORTAL OTP AUTHENTICATION SCREEN
  // ===================================================================
  if (!isVerified) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-surface rounded-2xl border border-surface-border shadow-card p-8 sm:p-10 space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-50 border border-brand-200 text-brand-600 shadow-xs mb-1">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              GST Return Portal Authentication
            </h1>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Verify credentials and OTP via Government Portal API (GSP) to unlock live return preparation & filing.
            </p>
          </div>

          {/* Alert Messages */}
          {authErrorMsg && (
            <div className="p-3.5 rounded-xl bg-danger-50 border border-danger-200 text-danger-700 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{authErrorMsg}</span>
            </div>
          )}

          {authSuccessMsg && (
            <div className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-700 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{authSuccessMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={otpSent ? handleVerifyOtpAndEnter : handleSendOtp} className="space-y-4">
            {/* GSTIN Field with Verify Button */}
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                GSTIN (Goods & Services Tax Identification)
              </label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  required
                  maxLength={15}
                  value={authGstin}
                  onChange={(e) => {
                    setAuthGstin(e.target.value.toUpperCase());
                    setTaxpayerDetails(null);
                  }}
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  className="w-full pl-3 pr-24 py-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-surface-border focus:outline-none focus:border-brand-500 bg-slate-50/50"
                  disabled={otpSent}
                />
                <button
                  type="button"
                  onClick={handleVerifyGstinName}
                  disabled={verifyingGstin || !authGstin || authGstin.length < 15 || otpSent}
                  className="absolute right-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 transition disabled:opacity-40"
                >
                  {verifyingGstin ? 'Verifying...' : 'Verify'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {taxpayerDetails
                  ? `✓ Registered: ${taxpayerDetails.legalName || taxpayerDetails.tradeName}`
                  : '15-character alphanumeric GSTIN. Click Verify to auto-fetch registered business name.'}
              </p>
            </div>

            {/* GST Portal Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                GST Portal Username
              </label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="Enter GST Portal username"
                className="w-full px-3 py-2.5 text-xs rounded-xl border border-surface-border focus:outline-none focus:border-brand-500 bg-slate-50/50"
                disabled={otpSent}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Your registered username on the official GST portal.
              </p>
            </div>

            {/* Consent Checkbox */}
            <div className="flex items-start gap-2.5 pt-1 text-xs text-slate-600">
              <input
                type="checkbox"
                id="consentCheck"
                checked={authConsent}
                onChange={(e) => setAuthConsent(e.target.checked)}
                className="mt-0.5 rounded border-surface-border text-brand-600 focus:ring-brand-500"
              />
              <label htmlFor="consentCheck" className="text-[11px] text-slate-500 leading-tight select-none cursor-pointer">
                I authorize the application to fetch GST returns and tax compliance data on my behalf from the GST Portal via authorized GST Suvidha Provider (GSP).
              </label>
            </div>

            {/* If OTP is sent: Enter OTP field */}
            {otpSent && (
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-2 animate-in fade-in duration-200">
                <label className="block text-xs font-semibold text-blue-900">
                  Enter 6-Digit OTP received on registered Mobile/Email:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={8}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="e.g. 575757"
                    className="w-full px-3 py-2 text-sm font-mono font-bold tracking-widest text-center rounded-xl border border-blue-300 focus:outline-none focus:border-blue-500 bg-white"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleVerifyOtpAndEnter}
                    disabled={authLoading}
                    className="shrink-0"
                  >
                    {authLoading ? 'Verifying...' : 'Verify OTP →'}
                  </Button>
                </div>
                <div className="flex justify-between items-center text-[11px] text-blue-700">
                  <span>(Sandbox test OTP: 575757 or 123456)</span>
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    className="underline hover:text-blue-900 cursor-pointer"
                  >
                    Change GSTIN
                  </button>
                </div>
              </div>
            )}

            {/* Submit Button */}
            {!otpSent && (
              <Button
                type="submit"
                variant="fintech"
                className="w-full justify-center"
                disabled={authLoading || !authGstin || !authUsername}
              >
                {authLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    <span>Connecting to Govt Portal API...</span>
                  </>
                ) : (
                  <>
                    <span>Send GSTN Verification OTP</span>
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </>
                )}
              </Button>
            )}

            {/* Quick Demo Bypass */}
            <div className="pt-3 border-t border-surface-border flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Workspace: <strong>{user?.name || 'CandidTax Enterprise'}</strong>
              </span>
              <button
                type="button"
                onClick={handleQuickEnterWithWorkspace}
                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 hover:underline cursor-pointer"
              >
                Enter with Workspace GSTIN →
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ===================================================================
  // SCREEN 2: GST RETURN DASHBOARD (AFTER OTP IS VERIFIED)
  // ===================================================================
  return (
    <div className="space-y-6">
      {/* Top Header: Clean, minimal, zero unnecessary buttons or text */}
      <PageHeader
        title="GST Return Hub"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50/90 border border-amber-200/80 text-amber-900 text-xs font-medium shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-amber-600" />
              <span>Due: <strong className="font-semibold text-amber-700">{dueDateDisplay}</strong></span>
            </div>
            <PeriodSelector selectedPeriod={period} onPeriodChange={handlePeriodChange} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchGstin}
              className="text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50"
              title="Authenticate with GST Portal OTP or re-verify credentials"
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
              <span>Portal Login (OTP)</span>
            </Button>
          </div>
        }
      />

      {/* ------------------------------------------------------------- */}
      {/* COMPACT RECTANGULAR GSTR NAVIGATION TABS (GSTR-1, 2B, 3B)     */}
      {/* ------------------------------------------------------------- */}
      <div>
        {/* Attractive Colorful Interactive Return Buttons (GSTR-1, GSTR-2B, GSTR-3B) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* BUTTON 1: GSTR-1 (Indigo / Blue Theme) */}
          <button
            type="button"
            onClick={() => handleSelectReturnCard('gstr1')}
            className={`relative group w-full p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-left flex items-center justify-between overflow-hidden ${
              selectedReturn === 'gstr1'
                ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 border-indigo-600 text-white shadow-lg shadow-indigo-600/25 ring-2 ring-indigo-500/40 translate-y-[-1px]'
                : 'bg-white hover:bg-gradient-to-r hover:from-blue-50/60 hover:to-indigo-50/40 border-slate-200 hover:border-indigo-300 text-slate-800 hover:shadow-xs'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                  selectedReturn === 'gstr1'
                    ? 'bg-white/20 text-white backdrop-blur-xs'
                    : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="truncate">
                <span className={`text-sm font-bold block leading-tight ${selectedReturn === 'gstr1' ? 'text-white' : 'text-slate-900'}`}>
                  GSTR-1
                </span>
                <span className={`text-[11px] font-medium leading-none block truncate mt-0.5 ${selectedReturn === 'gstr1' ? 'text-indigo-100' : 'text-slate-500'}`}>
                  Outward Supplies
                </span>
              </div>
            </div>

            <span
              className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0 ml-2 transition-colors ${
                selectedReturn === 'gstr1'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'bg-indigo-50 text-indigo-700 border border-indigo-200/80'
              }`}
            >
              {g1InvoiceCount} Invoices
            </span>
          </button>

          {/* BUTTON 2: GSTR-2B (Emerald / Teal Theme) */}
          <button
            type="button"
            onClick={() => handleSelectReturnCard('gstr2b')}
            className={`relative group w-full p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-left flex items-center justify-between overflow-hidden ${
              selectedReturn === 'gstr2b'
                ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-700 border-emerald-600 text-white shadow-lg shadow-emerald-600/25 ring-2 ring-emerald-500/40 translate-y-[-1px]'
                : 'bg-white hover:bg-gradient-to-r hover:from-emerald-50/60 hover:to-teal-50/40 border-slate-200 hover:border-emerald-300 text-slate-800 hover:shadow-xs'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                  selectedReturn === 'gstr2b'
                    ? 'bg-white/20 text-white backdrop-blur-xs'
                    : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4" />
              </div>
              <div className="truncate">
                <span className={`text-sm font-bold block leading-tight ${selectedReturn === 'gstr2b' ? 'text-white' : 'text-slate-900'}`}>
                  GSTR-2B
                </span>
                <span className={`text-[11px] font-medium leading-none block truncate mt-0.5 ${selectedReturn === 'gstr2b' ? 'text-emerald-100' : 'text-slate-500'}`}>
                  Inward ITC Statement
                </span>
              </div>
            </div>

            <span
              className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0 ml-2 transition-colors ${
                selectedReturn === 'gstr2b'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
              }`}
            >
              {g2bCount > 0 ? `${g2bCount} Bills` : `${formatCurrency(g2bTotalTax)} ITC`}
            </span>
          </button>

          {/* BUTTON 3: GSTR-3B (Purple / Violet Theme) */}
          <button
            type="button"
            onClick={() => handleSelectReturnCard('gstr3b')}
            className={`relative group w-full p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer text-left flex items-center justify-between overflow-hidden ${
              selectedReturn === 'gstr3b'
                ? 'bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-700 border-purple-600 text-white shadow-lg shadow-purple-600/25 ring-2 ring-purple-500/40 translate-y-[-1px]'
                : 'bg-white hover:bg-gradient-to-r hover:from-purple-50/60 hover:to-violet-50/40 border-slate-200 hover:border-purple-300 text-slate-800 hover:shadow-xs'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                  selectedReturn === 'gstr3b'
                    ? 'bg-white/20 text-white backdrop-blur-xs'
                    : 'bg-purple-50 text-purple-600 border border-purple-100'
                }`}
              >
                <Scale className="w-4 h-4" />
              </div>
              <div className="truncate">
                <span className={`text-sm font-bold block leading-tight ${selectedReturn === 'gstr3b' ? 'text-white' : 'text-slate-900'}`}>
                  GSTR-3B
                </span>
                <span className={`text-[11px] font-medium leading-none block truncate mt-0.5 ${selectedReturn === 'gstr3b' ? 'text-purple-100' : 'text-slate-500'}`}>
                  Monthly Tax Summary
                </span>
              </div>
            </div>

            <span
              className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg shrink-0 ml-2 transition-colors ${
                selectedReturn === 'gstr3b'
                  ? 'bg-white text-purple-800 shadow-xs'
                  : 'bg-purple-50 text-purple-700 border border-purple-200/80'
              }`}
            >
              Net: {formatCurrency(netCashPayable)}
            </span>
          </button>
        </div>
      </div>

      {/* CGST Rule 88C (DRC-01B) & Rule 88D (DRC-01C) Live Statutory Risk Simulator */}
      <DrcAuditSimulator
        gstr1Tax={g1TotalTax}
        gstr3bTax={Number(((g3bTotals.igst || 0) + (g3bTotals.cgst || 0) + (g3bTotals.sgst || 0) + (g3bTotals.cess || 0)).toFixed(2))}
        gstr2bItc={g2bTotalTax}
        gstr3bItc={eligibleItcAmount}
      />

      {/* ------------------------------------------------------------- */}
      {/* DRILLDOWN SECTION 1: WHEN GSTR-1 IS SELECTED                   */}
      {/* ------------------------------------------------------------- */}
      {selectedReturn === 'gstr1' && (
        <div className="space-y-4 pt-1">
          {/* Action Bar: Clean, sleek, high-contrast, free of unnecessary clutter */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100/80 flex items-center justify-center text-indigo-600 shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-none">
                    GSTR-1 Outward Supplies
                  </h2>
                  {isPortalGstr1Active ? (
                    <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Govt GST Portal Data
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                      7 Tables
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {isPortalGstr1Active
                    ? `Official filed return data retrieved from GST System (TaxPro API) • Fetched: ${liveGstr1Data?.fetchedAt ? formatDate(liveGstr1Data.fetchedAt) : 'Synced'}`
                    : 'Categorized outward supply tables. Click any card to inspect invoices.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap shrink-0">
              {/* Always-visible Data Source Toggle: Works on EVERY Month */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-medium border border-slate-200">
                <button
                  type="button"
                  onClick={() => setGstr1ViewMode('taxpro')}
                  className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 cursor-pointer ${
                    isPortalGstr1Active
                      ? 'bg-white text-emerald-700 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="View official return filed on Government GST Portal"
                >
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Govt Portal</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGstr1ViewMode('local')}
                  className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 cursor-pointer ${
                    !isPortalGstr1Active
                      ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="View invoices prepared locally in software"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Local Invoices</span>
                </button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsJsonModalOpen(true)}
                className="text-slate-700 border-slate-200 hover:bg-slate-50"
                title="View & Download Raw GSTN JSON Payload"
              >
                <FileCode2 className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                <span>JSON Payload</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsNilModalOpen(true)}
                className="text-amber-800 border-amber-300 bg-amber-50/70 hover:bg-amber-100 hover:border-amber-400 font-semibold shadow-2xs"
                title="File Nil GSTR-1 under CGST Rule 67A without tax liability"
              >
                <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-600 fill-amber-500" />
                <span>File Nil Return</span>
              </Button>

              <Button
                variant="fintech"
                size="sm"
                onClick={() => {
                  setEvcReturnType('GSTR1');
                  setIsEvcModalOpen(true);
                }}
                disabled={savingReturn || gstr1Loading || (!isPortalGstr1Active && summary.includedInvoices === 0)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-xs"
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                <span>File with EVC (Aadhaar/PAN)</span>
              </Button>
            </div>
          </div>

          {/* Success Banner */}
          {saveResult && (
            <div className="p-4 rounded-xl border border-success-200 bg-success-50 text-success-900 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs">
                <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
                <div>
                  <strong>{saveResult.message}</strong>
                  <div className="font-mono opacity-80 mt-0.5">
                    Reference ID: {saveResult.ref_id} • GSTIN: {saveResult.gstin}
                  </div>
                </div>
              </div>
            </div>
          )}

          {gstr1Error && <ErrorMessage error={gstr1Error} onRetry={() => fetchGstr1Data(period)} />}

          {/* Banner: In Govt Portal mode when period has no filed portal return */}
          {isPortalGstr1Active && !hasPortalGstr1 && !gstr1Loading && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="text-xs">
                  <strong className="font-semibold text-slate-900">
                    No Filed Return on Govt Portal for {formatPeriod(period)}
                  </strong>
                  <p className="text-slate-600 mt-0.5">
                    GSTR-1 has not been filed on the GST portal for this month yet. Switch to Local Invoices to prepare or file a return.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGstr1ViewMode('local')}
                className="bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 font-medium shrink-0"
              >
                <FileText className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                <span>Switch to Local Invoices</span>
              </Button>
            </div>
          )}

          {/* Banner: In Local mode when active workspace has 0 sales invoices */}
          {!isPortalGstr1Active && summary.totalInvoices === 0 && !gstr1Loading && (
            <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="text-xs">
                  <strong className="font-semibold text-amber-900">
                    No Sales Invoices Recorded for {formatPeriod(period)}
                  </strong>
                  <p className="text-amber-800/90 mt-0.5">
                    GSTR-1 auto-compiles from your sales invoices. Create an invoice or switch to a period with invoices.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {period !== '102026' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePeriodChange('102026')}
                    className="bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 font-medium"
                    title="Switch to October 2026 where 4 invoices are recorded"
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                    <span>View Oct 2026 (4 Invoices)</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSeedSampleInvoices}
                  loading={seeding}
                  className="bg-white text-slate-700 hover:bg-slate-50"
                  title={`Generate sample invoices for ${formatPeriod(period)} to test returns`}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                  <span>Add Sample Data</span>
                </Button>
                <Link to="/sales/invoices">
                  <Button variant="primary" size="sm">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    <span>Create Invoice</span>
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsNilModalOpen(true)}
                  className="bg-white text-slate-700"
                >
                  <Zap className="w-3.5 h-3.5 mr-1 text-amber-600" />
                  <span>File Nil Return</span>
                </Button>
              </div>
            </div>
          )}

          {/* Seed Success Alert */}
          {seedSuccessMsg && (
            <div className="p-3.5 rounded-xl bg-success-50 border border-success-200 text-success-900 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success-600" />
                <span>{seedSuccessMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setSeedSuccessMsg(null)}
                className="text-success-700 hover:text-success-900 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {gstr1Loading ? (
            <div className="py-12 text-center bg-white rounded-2xl border border-surface-border">
              <Loader message={`Distributing local sales invoices into GSTR-1 cards for ${formatPeriod(period)}...`} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {SECTION_CARDS.map((section) => {
                const IconComponent = section.icon;

                // Color mappings for category cards
                const colorConfig = {
                  blue: {
                    icon: 'bg-blue-50 text-blue-600 border-blue-100 group-hover:bg-blue-600 group-hover:text-white',
                    badge: 'bg-blue-50 text-blue-700 border-blue-200/80',
                    border: 'hover:border-blue-400',
                    tax: 'text-blue-600'
                  },
                  indigo: {
                    icon: 'bg-indigo-50 text-indigo-600 border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white',
                    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
                    border: 'hover:border-indigo-400',
                    tax: 'text-indigo-600'
                  },
                  teal: {
                    icon: 'bg-teal-50 text-teal-600 border-teal-100 group-hover:bg-teal-600 group-hover:text-white',
                    badge: 'bg-teal-50 text-teal-700 border-teal-200/80',
                    border: 'hover:border-teal-400',
                    tax: 'text-teal-600'
                  },
                  amber: {
                    icon: 'bg-amber-50 text-amber-600 border-amber-100 group-hover:bg-amber-600 group-hover:text-white',
                    badge: 'bg-amber-50 text-amber-700 border-amber-200/80',
                    border: 'hover:border-amber-400',
                    tax: 'text-amber-600'
                  },
                  purple: {
                    icon: 'bg-purple-50 text-purple-600 border-purple-100 group-hover:bg-purple-600 group-hover:text-white',
                    badge: 'bg-purple-50 text-purple-700 border-purple-200/80',
                    border: 'hover:border-purple-400',
                    tax: 'text-purple-600'
                  },
                  emerald: {
                    icon: 'bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:bg-emerald-600 group-hover:text-white',
                    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
                    border: 'hover:border-emerald-400',
                    tax: 'text-emerald-600'
                  },
                  slate: {
                    icon: 'bg-slate-100 text-slate-700 border-slate-200 group-hover:bg-slate-800 group-hover:text-white',
                    badge: 'bg-slate-100 text-slate-700 border-slate-200',
                    border: 'hover:border-slate-400',
                    tax: 'text-slate-800'
                  }
                };

                const currentConfig = colorConfig[section.color] || colorConfig.indigo;

                return (
                  <div
                    key={section.key}
                    onClick={() => {
                      setActiveSectionKey(section.key);
                      setTableSearch('');
                    }}
                    className={`group relative flex flex-col justify-between p-5 rounded-2xl border border-slate-200/90 bg-white shadow-xs hover:shadow-lg ${currentConfig.border} hover:-translate-y-1 transition-all duration-200 cursor-pointer overflow-hidden min-h-[225px]`}
                  >
                    <div>
                      {/* Top Header: Icon + Table Code & Title + Count Badge */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all shrink-0 ${currentConfig.icon}`}>
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block leading-none">
                              {section.tableCode}
                            </span>
                            <h3 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-indigo-600 transition-colors mt-1 truncate">
                              {section.title}
                            </h3>
                          </div>
                        </div>

                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border shrink-0 ${currentConfig.badge}`}>
                          {section.count}
                        </span>
                      </div>

                      {/* Subtitle */}
                      <p className="text-[11px] text-slate-500 mt-3 line-clamp-2 leading-relaxed min-h-[32px]">
                        {section.subtitle}
                      </p>

                      {/* Financial Figures Box */}
                      <div className="mt-3.5 p-3 rounded-xl bg-slate-50/90 border border-slate-100/90 space-y-1.5 group-hover:bg-slate-50 transition-colors">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Taxable:</span>
                          <span className="font-semibold text-slate-900 font-mono">
                            {formatCurrency(section.taxable)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Total Tax:</span>
                          <span className={`font-bold font-mono ${currentConfig.tax}`}>
                            {formatCurrency(section.tax)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Status Footer */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                        <span>{section.included} included</span>
                      </span>
                      <span className="font-bold text-xs text-indigo-600 group-hover:text-indigo-700 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        <span>Inspect</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* DRILLDOWN SECTION 2: WHEN GSTR-2B IS SELECTED                  */}
      {/* ------------------------------------------------------------- */}
      {selectedReturn === 'gstr2b' && (
        <div className="space-y-4 pt-1">
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <ArrowDownLeft className="w-5 h-5" />
              </div>
              <div>
                <strong className="text-sm">GSTR-2B Auto-Drafted Input Tax Credit Statement</strong>
                <p className="opacity-80 mt-0.5">
                  Reflects all inward supplies filed by your vendors. Match against your purchase register to claim 100% eligible ITC.
                </p>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsReconcileModalOpen(true)}
              className="shrink-0 bg-blue-600 hover:bg-blue-700"
            >
              <Scale className="w-3.5 h-3.5 mr-1.5" />
              <span>Reconcile with Purchase Bills</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              title="Eligible ITC (B2B Supplies)"
              value={formatCurrency(eligibleItcAmount)}
              subtitle="✓ Available for credit ledger offset"
              variant="fintech"
              icon={CheckCircle2}
            />
            <MetricCard
              title="Ineligible ITC (Section 17(5))"
              value="₹0.00"
              subtitle="Blocked credits & personal use"
              variant="default"
              icon={Lock}
            />
            <MetricCard
              title="Total Inward Supplier Bills"
              value={`${g2bCount} Inward Records`}
              subtitle="Verified with vendor filings"
              variant="default"
              icon={FileText}
            />
          </div>

          {/* GSTR-2B Table Breakdown */}
          {gstr2bData?.rows && gstr2bData.rows.length > 0 ? (
            <div className="bg-white rounded-xl border border-surface-border overflow-hidden shadow-xs mt-4">
              <div className="p-3.5 bg-slate-50 border-b border-surface-border flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">GSTR-2B ITC Line Item Breakdown</span>
                <span className="text-xs text-slate-500 font-mono">Period: {formatPeriod(period)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50/50 text-slate-600 font-semibold border-b border-surface-border">
                    <tr>
                      <th className="py-2.5 px-3.5">Table / Category</th>
                      <th className="text-right py-2.5 px-3">Taxable Value (₹)</th>
                      <th className="text-right py-2.5 px-3">IGST (₹)</th>
                      <th className="text-right py-2.5 px-3">CGST (₹)</th>
                      <th className="text-right py-2.5 px-3">SGST (₹)</th>
                      <th className="text-right py-2.5 px-3.5">Total Tax (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gstr2bData.rows.map((r, idx) => (
                      <tr key={idx} className="border-b border-surface-border/50 hover:bg-slate-50/50">
                        <td className="py-2.5 px-3.5 font-medium text-slate-800">{r.label}</td>
                        <td className="text-right py-2.5 px-3 font-mono">{formatCurrency(r.taxable || 0)}</td>
                        <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(r.igst || 0)}</td>
                        <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(r.cgst || 0)}</td>
                        <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(r.sgst || 0)}</td>
                        <td className="text-right py-2.5 px-3.5 font-mono font-bold text-brand-700">
                          {formatCurrency((r.igst || 0) + (r.cgst || 0) + (r.sgst || 0) + (r.cess || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t-2 border-surface-border">
                    <tr>
                      <td className="py-2.5 px-3.5 text-slate-900">Total Eligible ITC</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.taxable || 0)}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.igst || 0)}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.cgst || 0)}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(g2bTotals.sgst || 0)}</td>
                      <td className="text-right py-2.5 px-3.5 font-mono text-brand-700">{formatCurrency(eligibleItcAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-white rounded-xl border border-surface-border text-center text-xs text-slate-500">
              No auto-drafted vendor records found in GSTR-2B for {formatPeriod(period)}. Suppliers file GSTR-1 by 11th, and GSTR-2B auto-drafts by 14th.
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* DRILLDOWN SECTION 3: WHEN GSTR-3B IS SELECTED                  */}
      {/* ------------------------------------------------------------- */}
      {selectedReturn === 'gstr3b' && (
        <div className="space-y-4 pt-1">
          <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <strong className="text-sm">GSTR-3B Summary Return & Tax Offsetting</strong>
                <p className="opacity-80 mt-0.5">
                  Final monthly return calculating outward liability against eligible ITC credits. Net cash must be settled by 20th.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsNilModalOpen(true)}
                className="shrink-0 border-purple-300 text-purple-800 bg-white hover:bg-purple-50"
              >
                <Zap className="w-3.5 h-3.5 mr-1" />
                <span>File Nil GSTR-3B</span>
              </Button>

              <Button
                variant="fintech"
                size="sm"
                onClick={() => {
                  setEvcReturnType('GSTR3B');
                  setIsEvcModalOpen(true);
                }}
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-xs shrink-0"
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                <span>File GSTR-3B with EVC</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <MetricCard
              title="Table 3.1 Outward Liability"
              value={formatCurrency(outwardLiability)}
              subtitle="Total sales tax owed"
              variant="default"
              icon={TrendingUp}
            />
            <MetricCard
              title="Table 4 Eligible ITC"
              value={formatCurrency(eligibleItcAmount)}
              subtitle="From GSTR-2B match"
              variant="fintech"
              icon={CheckCircle2}
            />
            <MetricCard
              title="ITC Utilized"
              value={formatCurrency(itcUtilized)}
              subtitle="Adjusted against liability"
              variant="default"
              icon={Scale}
            />
            <MetricCard
              title="Table 6.1 Net Cash Payable"
              value={formatCurrency(netCashPayable)}
              subtitle="Due via cash ledger"
              variant={netCashPayable > 0 ? "warning" : "default"}
              icon={Zap}
            />
          </div>

          {/* Statutory Tax Head Settlement Ledger Table */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden shadow-xs mt-4">
            <div className="p-3.5 bg-slate-50 border-b border-surface-border flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">Table 6.1 Payment of Tax Settlement Ledger</span>
              <span className="text-xs text-slate-500 font-mono">Period: {formatPeriod(period)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50/50 text-slate-600 font-semibold border-b border-surface-border">
                  <tr>
                    <th className="py-2.5 px-3.5">Tax Description</th>
                    <th className="text-right py-2.5 px-3">Tax Payable (₹)</th>
                    <th className="text-right py-2.5 px-3">ITC Available (₹)</th>
                    <th className="text-right py-2.5 px-3">ITC Utilized (₹)</th>
                    <th className="text-right py-2.5 px-3.5">Net Cash Payable (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-surface-border/50 hover:bg-slate-50/50">
                    <td className="py-2.5 px-3.5 font-medium text-slate-800">Integrated Tax (IGST)</td>
                    <td className="text-right py-2.5 px-3 font-mono">{formatCurrency(settlementIgst)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(g2bTotals.igst || 0)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-600">
                      {formatCurrency(Math.min(settlementIgst, g2bTotals.igst || 0))}
                    </td>
                    <td className="text-right py-2.5 px-3.5 font-mono font-bold text-amber-700">
                      {formatCurrency(Math.max(0, settlementIgst - (g2bTotals.igst || 0)))}
                    </td>
                  </tr>
                  <tr className="border-b border-surface-border/50 hover:bg-slate-50/50">
                    <td className="py-2.5 px-3.5 font-medium text-slate-800">Central Tax (CGST)</td>
                    <td className="text-right py-2.5 px-3 font-mono">{formatCurrency(settlementCgst)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(g2bTotals.cgst || 0)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-600">
                      {formatCurrency(Math.min(settlementCgst, g2bTotals.cgst || 0))}
                    </td>
                    <td className="text-right py-2.5 px-3.5 font-mono font-bold text-amber-700">
                      {formatCurrency(Math.max(0, settlementCgst - (g2bTotals.cgst || 0)))}
                    </td>
                  </tr>
                  <tr className="border-b border-surface-border/50 hover:bg-slate-50/50">
                    <td className="py-2.5 px-3.5 font-medium text-slate-800">State Tax (SGST)</td>
                    <td className="text-right py-2.5 px-3 font-mono">{formatCurrency(settlementSgst)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-600">{formatCurrency(g2bTotals.sgst || 0)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-600">
                      {formatCurrency(Math.min(settlementSgst, g2bTotals.sgst || 0))}
                    </td>
                    <td className="text-right py-2.5 px-3.5 font-mono font-bold text-amber-700">
                      {formatCurrency(Math.max(0, settlementSgst - (g2bTotals.sgst || 0)))}
                    </td>
                  </tr>
                </tbody>
                <tfoot className="bg-slate-50 font-bold border-t-2 border-surface-border">
                  <tr>
                    <td className="py-2.5 px-3.5 text-slate-900">Total Tax Settlement</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(outwardLiability)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(eligibleItcAmount)}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-slate-900">{formatCurrency(itcUtilized)}</td>
                    <td className="text-right py-2.5 px-3.5 font-mono text-brand-700">{formatCurrency(netCashPayable)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* INVOICE TABLE DRILLDOWN MODAL (SAFE EXCLUSION WITHOUT DB DELETE)*/}
      {/* ------------------------------------------------------------- */}
      {activeSection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-5xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-surface-border animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-surface-border shadow-xs flex items-center justify-center text-slate-700">
                  {(() => {
                    const IconComp = activeSection.icon;
                    return <IconComp className="w-5 h-5 text-brand-600" />;
                  })()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold uppercase text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                      {activeSection.tableCode}
                    </span>
                    <h3 className="text-base font-bold text-slate-900">
                      {activeSection.title}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeSection.subtitle}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="w-8 h-8 rounded-full border border-surface-border bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 transition cursor-pointer"
                onClick={() => setActiveSectionKey(null)}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Search & Count Bar */}
            <div className="px-6 py-3 border-b border-surface-border bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search invoice number, buyer name, or GSTIN..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-surface-border focus:outline-none focus:border-brand-500 bg-white"
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">
                  Showing <strong>{modalFilteredItems.length}</strong> items
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-brand-700 font-semibold">
                  {modalFilteredItems.filter((i) => !i.isExcluded).length} included in return
                </span>
              </div>
            </div>

            {/* Context Banner: Portal Return vs Local DB */}
            {isPortalGstr1Active ? (
              <div className="px-6 py-2.5 bg-emerald-50/80 border-b border-emerald-100 text-emerald-900 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    <strong>Government GST Portal Records:</strong> Viewing official filed return data retrieved from GSTN for {formatPeriod(period)}.
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                  GST Portal Filed
                </span>
              </div>
            ) : (
              <div className="px-6 py-2.5 bg-amber-50/80 border-b border-amber-100 text-amber-900 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>Safe Invoice Exclusion:</strong> Clicking <strong>"Exclude"</strong> removes the invoice from this GSTR-1 return filing payload without deleting it from your database!
                  </span>
                </div>
                <Link
                  to="/sales/invoices"
                  className="text-xs font-semibold text-amber-800 hover:underline shrink-0"
                >
                  + Create Invoice
                </Link>
              </div>
            )}

            {/* Table Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeSection.key === 'docIssue' && activeSection.docRange && (
                <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[11px] text-slate-500 font-medium">Serial Number Range</p>
                    <p className="text-xs font-mono font-bold text-slate-800 truncate mt-0.5">
                      {activeSection.docRange.from || 'INV-001'} → {activeSection.docRange.to || 'INV-001'}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[11px] text-slate-500 font-medium">Total Issued</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">
                      {activeSection.docRange.totnum || activeSection.items?.length || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[11px] text-slate-500 font-medium">Cancelled</p>
                    <p className="text-sm font-bold text-rose-600 mt-0.5">
                      {activeSection.docRange.canc || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[11px] text-slate-500 font-medium">Net Valid Documents</p>
                    <p className="text-sm font-bold text-emerald-600 mt-0.5">
                      {activeSection.docRange.net_issue || activeSection.items?.length || 0}
                    </p>
                  </div>
                </div>
              )}

              {modalFilteredItems.length === 0 ? (
                <div className="py-12 px-6 text-center max-w-lg mx-auto">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-xs">
                    <FileText className="w-7 h-7" />
                  </div>
                  <h4 className="text-base font-bold text-slate-900">
                    {tableSearch ? 'No matching invoices found' : `No Invoices in ${activeSection.title} Table`}
                  </h4>
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                    {tableSearch ? (
                      <>
                        No invoices match search term "<strong>{tableSearch}</strong>". Clear search bar to view all.
                      </>
                    ) : (
                      <>
                        GSTR-1 return populates from sales invoices in period <strong>{formatPeriod(period)}</strong>.
                        No matching invoices exist in this active workspace for this period.
                      </>
                    )}
                  </p>

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <Link to="/sales/invoices">
                      <Button variant="primary" size="sm">
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        <span>Create Sales Invoice</span>
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-surface-border">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-surface-border">
                      <tr>
                        <th className="py-3 px-3 w-12 text-center">Status</th>
                        <th className="py-3 px-3">Invoice #</th>
                        <th className="py-3 px-3">Date</th>
                        <th className="py-3 px-3">Customer / Buyer</th>
                        <th className="py-3 px-3">GSTIN</th>
                        <th className="py-3 px-3 text-right">Taxable (₹)</th>
                        <th className="py-3 px-3 text-right">IGST (₹)</th>
                        <th className="py-3 px-3 text-right">CGST+SGST (₹)</th>
                        <th className="py-3 px-3 text-right">Grand Total (₹)</th>
                        <th className="py-3 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {modalFilteredItems.map((item) => {
                        const isExcluded = item.isExcluded;
                        return (
                          <tr
                            key={String(item._id)}
                            className={`transition-colors ${
                              isExcluded
                                ? 'bg-slate-50/80 opacity-60 text-slate-400'
                                : 'hover:bg-slate-50/50 text-slate-700'
                            }`}
                          >
                            <td className="py-2.5 px-3 text-center">
                              {isExcluded ? (
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300"
                                  title="Excluded from GSTR-1"
                                />
                              ) : (
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500"
                                  title="Included in GSTR-1"
                                />
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                              {item.invoiceNumber}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {item.dateFormatted || formatDate(item.invoiceDate)}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900 truncate max-w-[160px]" title={item.customerName}>
                              {item.customerName || 'Consumer'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                              {item.customerGstin || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium">
                              {formatCurrency(item.taxableAmount || 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                              {formatCurrency(item.igst || 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                              {formatCurrency((item.cgst || 0) + (item.sgst || 0))}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {formatCurrency(item.grandTotal || 0)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {item.isPortal ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  ✓ Filed on Portal
                                </span>
                              ) : item.isHsnRow || item.isDocRow ? (
                                <span className="text-[10px] text-slate-400 font-medium">System Row</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleExcludeInvoice(item._id)}
                                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition shadow-2xs cursor-pointer ${
                                    isExcluded
                                      ? 'bg-brand-50 text-brand-700 border border-brand-300 hover:bg-brand-100'
                                      : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                                  }`}
                                  title={
                                    isExcluded
                                      ? 'Include this invoice back in the GSTR-1 return filing'
                                      : 'Exclude this invoice from GSTR-1 (Invoice stays safely saved in DB)'
                                  }
                                >
                                  {isExcluded ? '✓ Include Back' : '✕ Exclude'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-surface-border bg-slate-50 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                Active Section: <strong>{activeSection.title}</strong>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveSectionKey(null)}
              >
                Close Table
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* RAW JSON VIEWER MODAL */}
      {isJsonModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl max-h-[85vh] bg-surface-dark text-slate-100 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-brand-400" />
                <h3 className="font-bold text-sm text-white">Official GSTN GSTR-1 Payload</h3>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-white cursor-pointer"
                onClick={() => setIsJsonModalOpen(false)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-brand-300 bg-slate-950">
              <pre>{JSON.stringify(prepareData?.payload || {}, null, 2)}</pre>
            </div>
            <div className="px-6 py-3.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/80">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyJson}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  {copiedJson ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  <span>{copiedJson ? 'Copied!' : 'Copy JSON'}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadOfflineJson}
                  className="border-indigo-500/50 text-indigo-300 hover:bg-indigo-950/60"
                  title="Download JSON schema ready for Government GST Offline Tool"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                  <span>Download GST Offline JSON</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTallyXml}
                  className="border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/60"
                  title="Export DayBook / Sales Vouchers in Tally ERP XML Format"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                  <span>Download Tally XML</span>
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsJsonModalOpen(false)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* NIL RETURN FILING MODAL */}
      <NilReturnModal
        isOpen={isNilModalOpen}
        onClose={() => setIsNilModalOpen(false)}
        initialPeriod={period}
        initialType={selectedReturn === 'gstr3b' ? 'GSTR3B' : 'GSTR1'}
        onSuccess={() => {
          setIsNilModalOpen(false);
          fetchGstr1Data(period);
        }}
      />

      {/* ITC RECONCILIATION MODAL */}
      <ItcReconciliationModal
        isOpen={isReconcileModalOpen}
        onClose={() => setIsReconcileModalOpen(false)}
        period={period}
      />

      {/* GSTR EVC VERIFICATION & STATUTORY FILING MODAL */}
      <Gstr1EvcModal
        isOpen={isEvcModalOpen}
        onClose={() => setIsEvcModalOpen(false)}
        period={period}
        gstin={authGstin}
        returnType={evcReturnType}
        summary={evcReturnType === 'GSTR3B' ? {
          totalTaxable: outwardLiability,
          totalTax: netCashPayable,
          includedInvoices: 1
        } : summary}
        excludedInvoiceIds={excludedIds}
        onSuccess={(result) => {
          setSaveResult({
            message: result.message || `${evcReturnType} successfully filed with EVC verification!`,
            ref_id: result.arn,
            gstin: authGstin
          });
          if (evcReturnType === 'GSTR1') {
            fetchGstr1Data(period, excludedIds);
          } else {
            fetchOtherReturns(period);
          }
        }}
      />
    </div>
  );
}
