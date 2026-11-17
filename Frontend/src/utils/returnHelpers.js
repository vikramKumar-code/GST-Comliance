import {
  Building2,
  Store,
  ShoppingBag,
  FileEdit,
  Plane,
  Tag,
  Files
} from 'lucide-react';
import { formatDate } from './format.js';

export const ITEMS_PER_PAGE = 50;

/**
 * 1. Map portal B2B response to UI format
 * @param {Object} liveGstr1Data
 * @returns {Array}
 */
export function mapPortalB2bItems(liveGstr1Data) {
  if (!liveGstr1Data) return [];

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

  if (Array.isArray(liveGstr1Data.b2b) && liveGstr1Data.b2b.length > 0) {
    const items = [];
    liveGstr1Data.b2b.forEach((buyer, bIdx) => {
      const ctin = buyer.ctin || 'Registered Taxpayer';
      const cname = buyer.trdnm || buyer.cname || 'Registered Buyer';
      (buyer.inv || []).forEach((inv, iIdx) => {
        let taxable = 0, igst = 0, cgst = 0, sgst = 0;
        const itms = inv.itms || inv.items || [];
        if (itms.length > 0) {
          itms.forEach((itm) => {
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

  return [];
}

/**
 * 2. Sum IGST + CGST + SGST
 * @param {Array} items
 * @returns {number}
 */
export function calculatePortalTax(items = []) {
  if (!Array.isArray(items)) return 0;
  return Number(
    items.reduce(
      (acc, i) => acc + Number(i.igst || 0) + Number(i.cgst || 0) + Number(i.sgst || 0),
      0
    ).toFixed(2)
  );
}

/**
 * 3. Sum taxable amounts
 * @param {Array} items
 * @returns {number}
 */
export function calculatePortalTaxable(items = []) {
  if (!Array.isArray(items)) return 0;
  return Number(
    items.reduce((acc, i) => acc + Number(i.taxableAmount || 0), 0).toFixed(2)
  );
}

/**
 * 4. Async copy with fallback for older browsers
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch (fallbackErr) {
      console.error('Copy failed:', fallbackErr);
      return false;
    }
  }
}
export const safeCopyToClipboard = copyToClipboard;

/**
 * 5. Safe blob file download
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 * @returns {boolean}
 */
export function downloadFile(content, filename, mimeType) {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Download failed:', err);
    return false;
  }
}
export const safeDownloadFile = downloadFile;

/**
 * 6. Format due date string (11th of next month)
 * @param {string} period MMYYYY
 * @returns {string}
 */
export function getDueDateDisplay(period) {
  if (!period || period.length !== 6) return '11th of next month';
  const month = parseInt(period.slice(0, 2), 10);
  const year = parseInt(period.slice(2), 10);
  const nextDate = new Date(year, month, 11);
  return nextDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sum tax amounts across rows
 * @param {Array} rows
 * @returns {number}
 */
export function totalTaxForRows(rows = []) {
  return Number(rows.reduce(
    (total, row) => total + Number(row.igst || 0) + Number(row.cgst || 0) + Number(row.sgst || 0) + Number(row.cess || 0),
    0
  ).toFixed(2));
}

/**
 * Build Tally XML representation from prepareData
 * @param {Object} prepareData
 * @returns {string}
 */
export function generateTallyXml(prepareData) {
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

  return xmlLines.join('\n');
}

/**
 * Trigger download of offline JSON
 */
export function downloadOfflineJson(prepareData, authGstin, period) {
  const payload = prepareData?.payload || {};
  const jsonString = JSON.stringify(payload, null, 2);
  return downloadFile(
    jsonString,
    `GSTR1_${authGstin}_${period}_offline.json`,
    'application/json'
  );
}

/**
 * Trigger download of Tally XML
 */
export function downloadTallyXml(prepareData, authGstin, period) {
  const xmlContent = generateTallyXml(prepareData);
  return downloadFile(
    xmlContent,
    `Tally_Sales_${authGstin}_${period}.xml`,
    'application/xml'
  );
}

/**
 * Styling color definitions for the 7 GSTR-1 sections
 */
export const SECTION_COLOR_CONFIG = {
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
  rose: {
    icon: 'bg-rose-50 text-rose-600 border-rose-100 group-hover:bg-rose-600 group-hover:text-white',
    badge: 'bg-rose-50 text-rose-700 border-rose-200/80',
    border: 'hover:border-rose-400',
    tax: 'text-rose-600'
  }
};

/**
 * Builds the array of section cards from return data
 */
export function buildSectionCards({
  isPortalGstr1Active,
  portalB2bItems = [],
  portalB2clItems = [],
  portalB2csItems = [],
  portalCdnrItems = [],
  portalExpItems = [],
  portalHsnItems = [],
  portalDocItems = [],
  portalAllInvoices = [],
  portalB2clTaxable = 0,
  portalB2clTax = 0,
  portalB2csTaxable = 0,
  portalB2csTax = 0,
  portalCdnrTaxable = 0,
  portalCdnrTax = 0,
  portalExpTaxable = 0,
  portalExpTax = 0,
  portalHsnTaxable = 0,
  portalHsnTax = 0,
  summary = {},
  sectionDetails = {},
  prepareData = null,
  g1Taxable = 0,
  g1TotalTax = 0
}) {
  const sections = summary.sections || {};
  const sumLocalItems = (items) => {
    const active = (items || []).filter((i) => !i.isExcluded);
    const taxable = active.reduce((s, i) => s + Number(i.taxableAmount || 0), 0);
    const tax = active.reduce((s, i) => s + Number(i.igst || 0) + Number(i.cgst || 0) + Number(i.sgst || 0), 0);
    return { taxable, tax };
  };

  return [
    {
      key: 'b2b',
      tableCode: 'Table 4',
      title: 'B2B Invoices',
      subtitle: isPortalGstr1Active
        ? 'Filed B2B supplies retrieved from GST portal'
        : 'Taxable supplies to registered persons',
      icon: Building2,
      count: isPortalGstr1Active
        ? portalB2bItems.length
        : (sections.b2bCount ?? sectionDetails.b2b?.length ?? 0),
      included: isPortalGstr1Active
        ? portalB2bItems.length
        : (sections.b2bIncluded ?? sectionDetails.b2b?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active
        ? (calculatePortalTaxable(portalB2bItems) || g1Taxable)
        : (sections.b2bTaxable ?? sumLocalItems(sectionDetails.b2b).taxable),
      tax: isPortalGstr1Active
        ? (calculatePortalTax(portalB2bItems) || g1TotalTax)
        : (sections.b2bTax ?? sumLocalItems(sectionDetails.b2b).tax),
      items: isPortalGstr1Active ? portalB2bItems : (sectionDetails.b2b || []),
      color: 'blue'
    },
    {
      key: 'b2cl',
      tableCode: 'Table 5',
      title: 'B2C (Large)',
      subtitle: isPortalGstr1Active
        ? 'Inter-state consumer supplies > ₹2.5L (Portal)'
        : 'Inter-state supplies to consumers > ₹2.5 Lakhs',
      icon: Store,
      count: isPortalGstr1Active
        ? portalB2clItems.length
        : (sections.b2clCount ?? sectionDetails.b2cl?.length ?? 0),
      included: isPortalGstr1Active
        ? portalB2clItems.length
        : (sections.b2clIncluded ?? sectionDetails.b2cl?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active
        ? portalB2clTaxable
        : (sections.b2clTaxable ?? sumLocalItems(sectionDetails.b2cl).taxable),
      tax: isPortalGstr1Active
        ? portalB2clTax
        : (sections.b2clTax ?? sumLocalItems(sectionDetails.b2cl).tax),
      items: isPortalGstr1Active ? portalB2clItems : (sectionDetails.b2cl || []),
      color: 'indigo'
    },
    {
      key: 'b2cs',
      tableCode: 'Table 7',
      title: 'B2C (Small)',
      subtitle: isPortalGstr1Active
        ? 'Intra-state & small retail supplies (Portal)'
        : 'Intra-state & small consumer supplies',
      icon: ShoppingBag,
      count: isPortalGstr1Active
        ? portalB2csItems.length
        : (sections.b2csCount ?? sectionDetails.b2cs?.length ?? 0),
      included: isPortalGstr1Active
        ? portalB2csItems.length
        : (sections.b2csIncluded ?? sectionDetails.b2cs?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active
        ? portalB2csTaxable
        : (sections.b2csTaxable ?? sumLocalItems(sectionDetails.b2cs).taxable),
      tax: isPortalGstr1Active
        ? portalB2csTax
        : (sections.b2csTax ?? sumLocalItems(sectionDetails.b2cs).tax),
      items: isPortalGstr1Active ? portalB2csItems : (sectionDetails.b2cs || []),
      color: 'teal'
    },
    {
      key: 'cdnr',
      tableCode: 'Table 9B',
      title: 'Credit / Debit Notes',
      subtitle: isPortalGstr1Active
        ? 'Registered buyer adjustments (Portal)'
        : 'Registered buyer credit/debit adjustments',
      icon: FileEdit,
      count: isPortalGstr1Active
        ? portalCdnrItems.length
        : (sections.cdnrCount ?? sectionDetails.cdnr?.length ?? 0),
      included: isPortalGstr1Active
        ? portalCdnrItems.length
        : (sectionDetails.cdnr?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active
        ? portalCdnrTaxable
        : (sections.cdnrTaxable ?? sumLocalItems(sectionDetails.cdnr).taxable),
      tax: isPortalGstr1Active
        ? portalCdnrTax
        : (sections.cdnrTax ?? sumLocalItems(sectionDetails.cdnr).tax),
      items: isPortalGstr1Active ? portalCdnrItems : (sectionDetails.cdnr || []),
      color: 'amber'
    },
    {
      key: 'exp',
      tableCode: 'Table 6A',
      title: 'Exports (EXP)',
      subtitle: isPortalGstr1Active
        ? 'Zero-rated export supplies (Portal)'
        : 'Zero-rated export supplies with/without duty',
      icon: Plane,
      count: isPortalGstr1Active
        ? portalExpItems.length
        : (sections.expCount ?? sectionDetails.exp?.length ?? 0),
      included: isPortalGstr1Active
        ? portalExpItems.length
        : (sections.expIncluded ?? sectionDetails.exp?.filter((i) => !i.isExcluded).length ?? 0),
      taxable: isPortalGstr1Active
        ? portalExpTaxable
        : (sections.expTaxable ?? sumLocalItems(sectionDetails.exp).taxable),
      tax: isPortalGstr1Active
        ? portalExpTax
        : (sections.expTax ?? sumLocalItems(sectionDetails.exp).tax),
      items: isPortalGstr1Active ? portalExpItems : (sectionDetails.exp || []),
      color: 'purple'
    },
    {
      key: 'hsn',
      tableCode: 'Table 12',
      title: 'HSN Summary',
      subtitle: isPortalGstr1Active
        ? 'HSN/SAC summary of supplies (Portal)'
        : 'HSN/SAC summary of outward supplies',
      icon: Tag,
      count: isPortalGstr1Active
        ? (portalHsnItems.length || (g1Taxable > 0 ? 1 : 0))
        : (sections.hsnCount ?? (sectionDetails.hsn?.length || prepareData?.payload?.hsn?.data?.length || 0)),
      included: isPortalGstr1Active
        ? (portalHsnItems.length || (g1Taxable > 0 ? 1 : 0))
        : (sections.hsnCount ?? (sectionDetails.hsn?.length || prepareData?.payload?.hsn?.data?.length || 0)),
      taxable: isPortalGstr1Active
        ? (portalHsnTaxable || calculatePortalTaxable(portalHsnItems) || g1Taxable)
        : (summary.totalTaxable ?? 0),
      tax: isPortalGstr1Active
        ? (portalHsnTax || calculatePortalTax(portalHsnItems) || g1TotalTax)
        : (summary.totalTax ?? 0),
      items: isPortalGstr1Active
        ? portalHsnItems
        : (prepareData?.payload?.hsn?.data && prepareData.payload.hsn.data.length > 0
            ? prepareData.payload.hsn.data.map((h, idx) => ({
                _id: `hsn-${h.num || idx + 1}`,
                invoiceNumber: h.hsn_sc || 'HSN',
                customerName: h.desc || 'General Goods/Services',
                taxableAmount: Number(h.txval || 0),
                igst: Number(h.iamt || 0),
                cgst: Number(h.camt || 0),
                sgst: Number(h.samt || 0),
                grandTotal: Number(h.txval || 0) + Number(h.iamt || 0) + Number(h.camt || 0) + Number(h.samt || 0),
                isHsnRow: true
              }))
            : (sectionDetails.hsn || [])),
      color: 'emerald'
    },
    {
      key: 'docIssue',
      tableCode: 'Table 13',
      title: 'Documents Issued',
      subtitle: isPortalGstr1Active
        ? 'Invoice series range filed on portal'
        : 'Serial numbering of invoices & notes',
      icon: Files,
      count: isPortalGstr1Active
        ? (portalAllInvoices.length || portalB2bItems.length)
        : (sectionDetails.docIssueList?.length ?? sections.docRange?.totalCount ?? summary.totalInvoices ?? 0),
      included: isPortalGstr1Active
        ? (portalAllInvoices.length || portalB2bItems.length)
        : (sectionDetails.docIssueList?.filter((i) => !i.isExcluded)?.length ?? sections.docRange?.net_issue ?? summary.totalInvoices ?? 0),
      taxable: isPortalGstr1Active
        ? calculatePortalTaxable(portalAllInvoices)
        : (summary.totalTaxable ?? 0),
      tax: isPortalGstr1Active
        ? calculatePortalTax(portalAllInvoices)
        : (summary.totalTax ?? 0),
      items: isPortalGstr1Active
        ? (portalAllInvoices.length > 0 ? portalAllInvoices : portalDocItems)
        : (sectionDetails.docIssueList && sectionDetails.docIssueList.length > 0
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
        : (sections.docRange || sectionDetails.docIssue || null),
      color: 'rose'
    }
  ];
}
