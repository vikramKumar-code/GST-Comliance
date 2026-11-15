import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { importInvoices, importBills } from '../api/import.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';

const SAMPLE_SALES = [
  {
    'Invoice Number': 'INV-001',
    'Invoice Date': '30-10-2026',
    'Document Type': 'INVOICE',
    'Customer Name': 'om enterprises',
    'Customer GSTIN': '06AAHBP8621K1ZR',
    'Customer Address': 'Plot 45, Phase 1, Industrial Area, Gurugram, Haryana',
    'Place of Supply': '06',
    'Item Name': 'BOPP TAPE',
    'HSN/SAC': '5603',
    'Unit (UQC)': 'PCS',
    'Quantity': 1,
    'Rate': 100,
    'Discount': 0,
    'Taxable Amount': 100,
    'GST Rate (%)': 18,
    'IGST Amount': 0,
    'CGST Amount': 9,
    'SGST Amount': 9,
    'Total Amount': 118
  },
  {
    'Invoice Number': 'CN-001',
    'Invoice Date': '30-10-2026',
    'Document Type': 'CREDIT_NOTE',
    'Customer Name': 'Rahul Retail',
    'Customer GSTIN': '',
    'Customer Address': 'Shop 12, Main Market, Faridabad, Haryana',
    'Place of Supply': '06',
    'Item Name': 'Office Chair',
    'HSN/SAC': '9403',
    'Unit (UQC)': 'NOS',
    'Quantity': 1,
    'Rate': 500,
    'Discount': 0,
    'Taxable Amount': 500,
    'GST Rate (%)': 18,
    'IGST Amount': 0,
    'CGST Amount': 45,
    'SGST Amount': 45,
    'Total Amount': 590
  }
];

const SAMPLE_PURCHASES = [
  {
    'Bill Number': 'BILL-001',
    'Bill Date': '30-10-2026',
    'Document Type': 'INVOICE',
    'Vendor Name': 'Godrej Supplies Ltd',
    'Vendor GSTIN': '06AAACG1234D1Z9',
    'Place of Supply': '06',
    'Item Name': 'Raw Metal Sheets',
    'HSN/SAC': '7208',
    'Unit (UQC)': 'PCS',
    'Quantity': 10,
    'Rate': 350,
    'Discount': 0,
    'Taxable Amount': 3500,
    'GST Rate (%)': 18,
    'IGST Amount': 0,
    'CGST Amount': 315,
    'SGST Amount': 315,
    'Total Amount': 4130
  }
];

export default function ExcelImportPage() {
  const { user } = useAuth();
  const [importType, setImportType] = useState('sales'); // 'sales' | 'bills'
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const resetState = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setError(null);
    setResult(null);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const processFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('Workbook contains no sheets or readable data.');
        }
        const worksheet = workbook.Sheets[firstSheetName];
        // defval: '' ensures empty cells become empty strings, not undefined
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        if (!rows || rows.length === 0) {
          setError(new Error('The uploaded file is empty or missing data rows.'));
        } else {
          setParsedRows(rows);
        }
      } catch (err) {
        setError(new Error('Failed to read spreadsheet: ' + err.message));
      }
    };
    reader.onerror = () => {
      setError(new Error('Failed to read file from disk.'));
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let res;
      if (importType === 'sales') {
        res = await importInvoices(parsedRows, { skipDuplicates });
      } else {
        res = await importBills(parsedRows, { skipDuplicates });
      }
      setResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (format = 'xlsx') => {
    try {
      const isSales = importType === 'sales';
      const filename = isSales
        ? `sales_invoices_sample_template.${format}`
        : `purchase_bills_sample_template.${format}`;
      const data = isSales ? SAMPLE_SALES : SAMPLE_PURCHASES;
      const sheetName = isSales ? 'Sales Invoices' : 'Purchase Bills';

      const ws = XLSX.utils.json_to_sheet(data);
      if (format === 'xlsx') {
        const standardCols = [
          { wch: 16 }, // Invoice/Bill Number
          { wch: 14 }, // Date
          { wch: 16 }, // Document Type
          { wch: 22 }, // Party Name
          { wch: 18 }, // Party GSTIN
          { wch: 16 }, // Place of Supply
          { wch: 22 }, // Item Name
          { wch: 12 }, // HSN/SAC
          { wch: 12 }, // Unit (UQC)
          { wch: 10 }, // Quantity
          { wch: 10 }, // Rate
          { wch: 10 }, // Discount
          { wch: 16 }, // Taxable Amount
          { wch: 14 }, // GST Rate (%)
          { wch: 14 }, // IGST Amount
          { wch: 14 }, // CGST Amount
          { wch: 14 }, // SGST Amount
          { wch: 16 }  // Total Amount
        ];
        ws['!cols'] = standardCols;
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename, { bookType: format });
    } catch {
      const isSales = importType === 'sales';
      const fallbackUrl = `/api/import/template/${isSales ? 'sales' : 'bills'}?format=${format}`;
      window.location.href = fallbackUrl;
    }
  };

  return (
    <div>
      <div className="zoho-page-header">
        <h1 className="fw-bold fs-4 text-dark mb-1">Excel & CSV Data Import</h1>
        <p className="text-secondary small mb-0">
          Bulk import your sales invoices and purchase bills. <span className="text-success fw-semibold">Backend auto-cleans trailing spaces, formats dates, and validates GSTINs.</span>
        </p>
      </div>

      <div className="zoho-page-body" style={{ maxWidth: '900px' }}>
        {/* Active Client Workspace Context Banner */}
        <div className="card border-0 mb-4 rounded-3 p-3 text-xs" style={{ backgroundColor: '#f8fafc', borderLeft: '4px solid #4f46e5', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="badge px-2.5 py-1 small fw-bold" style={{ backgroundColor: '#e0e7ff', color: '#4338ca' }}>
                  🏢 Active Client: {user?.currentWorkspace?.tradeName || user?.currentWorkspace?.name || user?.workspaceName || 'Client Workspace'}
                </span>
                {user?.currentWorkspace?.gstin || user?.gstin ? (
                  <span className="badge px-2 py-1 small font-monospace" style={{ backgroundColor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                    GSTIN: {user?.currentWorkspace?.gstin || user?.gstin}
                  </span>
                ) : (
                  <span className="badge px-2 py-1 small" style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
                    Unlinked GSTIN
                  </span>
                )}
                {user?.currentWorkspace?.stateCode && (
                  <span className="badge px-2 py-1 small" style={{ backgroundColor: '#f1f5f9', color: '#475569' }}>
                    State: {user.currentWorkspace.stateName || user.currentWorkspace.stateCode} ({user.currentWorkspace.stateCode})
                  </span>
                )}
              </div>
              <div className="text-secondary small mt-1.5" style={{ fontSize: '11px', lineHeight: '1.5' }}>
                <strong className="text-dark">Seller / Supplier Profile:</strong> All imported sales invoices will automatically be assigned to this client. Their registered business address (<span className="text-dark font-medium">{user?.currentWorkspace?.address || 'Configured in Workspace Settings'}</span>) and GST details will show on all printed Tax Invoices and GSTR-1 filings.
              </div>
            </div>
            <Link to="/settings" className="btn btn-outline-secondary btn-sm" style={{ fontSize: '11px' }}>
              ⚙️ Client Settings
            </Link>
          </div>
        </div>

        {/* Import Type Selector */}
        <div className="card border shadow-sm bg-white p-3 mb-4">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div>
              <span className="fw-semibold text-dark me-2 small">Select Module to Import:</span>
              <div className="btn-group btn-group-sm" role="group">
                <button
                  type="button"
                  className={`btn ${importType === 'sales' ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => {
                    setImportType('sales');
                    resetState();
                  }}
                >
                  📤 Sales Invoices
                </button>
                <button
                  type="button"
                  className={`btn ${importType === 'bills' ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => {
                    setImportType('bills');
                    resetState();
                  }}
                >
                  📥 Purchase Bills
                </button>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1.5 shadow-xs"
                onClick={() => handleDownload('xlsx')}
                title="Download Microsoft Excel Spreadsheet (.xlsx)"
              >
                <span>📗</span>
                <span>Download Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1.5 shadow-xs"
                onClick={() => handleDownload('csv')}
                title="Download CSV spreadsheet (.csv)"
              >
                <span>📄</span>
                <span>CSV (.csv)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Upload Box */}
        <div className="card border shadow-sm bg-white p-4 mb-4">
          <h2 className="fs-6 fw-bold text-dark mb-3">
            Upload {importType === 'sales' ? 'Sales Invoices' : 'Purchase Bills'} Spreadsheet (.xlsx, .xls, .csv)
          </h2>

          <div
            className={`border rounded-3 p-5 text-center ${dragActive ? 'border-primary bg-primary-subtle' : 'border-dashed bg-light'}`}
            style={{ borderStyle: 'dashed', borderWidth: '2px', cursor: 'pointer' }}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => document.getElementById('excelFileInput')?.click()}
          >
            <div className="fs-1 mb-2">📊</div>
            <div className="fw-semibold text-dark mb-1">
              {selectedFile ? selectedFile.name : 'Choose an Excel (.xlsx, .xls) or CSV (.csv) file or drag and drop it here'}
            </div>
            <div className="text-muted small mb-3">
              Supports Microsoft Excel (.xlsx, .xls) & standard CSV with column headers.
            </div>
            <input
              id="excelFileInput"
              type="file"
              accept=".xlsx, .xls, .csv"
              className="d-none"
              onChange={handleFileChange}
            />
            <button type="button" className="btn btn-outline-primary btn-sm">
              Browse File
            </button>
          </div>

          {error && (
            <div className="mt-3">
              <ErrorMessage error={error} />
            </div>
          )}

          {/* Parsed Preview Table & GSTR-1 Section Distribution */}
          {parsedRows.length > 0 && !result && (
            <div className="mt-4 pt-3 border-top">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="small fw-semibold text-dark">
                  Found <span className="badge bg-primary text-white">{parsedRows.length}</span> rows in{' '}
                  <code className="text-dark">{selectedFile?.name}</code>
                </span>
                <label className="form-check-label small text-muted d-flex align-items-center gap-1">
                  <input
                    type="checkbox"
                    className="form-check-input mt-0"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                  />
                  Skip existing records if duplicate number
                </label>
              </div>

              {/* GSTR-1 Section Auto-Distribution Cards */}
              {importType === 'sales' && (() => {
                const b2bRows = [];
                const b2clRows = [];
                const b2csRows = [];
                const cdnrRows = [];
                const expRows = [];

                for (const row of parsedRows) {
                  const docType = String(row['Document Type'] || row['documentType'] || 'INVOICE').toUpperCase();
                  const pos = String(row['Place of Supply'] || row['pos'] || '').trim();
                  const gstin = String(row['Customer GSTIN'] || row['customerGstin'] || '').trim().toUpperCase();
                  const totalAmount = Number(row['Total Amount'] || row['totalAmount'] || 0);

                  // ✅ Fixed Logic: Use Document Type for CDNR, valid GSTIN length for B2B
                  if (docType === 'CREDIT_NOTE' || docType === 'DEBIT_NOTE') {
                    cdnrRows.push(row);
                  } else if (pos === '96' || String(row['isExport'] || row['Is Export']).toLowerCase() === 'true') {
                    expRows.push(row);
                  } else if (gstin.length === 15) {
                    b2bRows.push(row);
                  } else if (totalAmount > 250000 && pos.length === 2) {
                    b2clRows.push(row);
                  } else {
                    b2csRows.push(row);
                  }
                }

                return (
                  <div className="mb-4 p-3 bg-slate-50 border rounded-3">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="small fw-bold text-dark d-flex align-items-center gap-1.5">
                        <span>📊</span>
                        <span>Auto-Distributed GSTR-1 Sections Preview</span>
                      </span>
                      <span className="text-muted text-[11px]">Based on GSTIN, POS, and Amount</span>
                    </div>

                    <div className="row g-2">
                      <div className="col-6 col-md">
                        <div className="p-2.5 bg-white border rounded-2 shadow-2xs">
                          <div className="text-[10px] text-muted font-monospace fw-bold">TABLE 4 (B2B)</div>
                          <div className="fw-bold text-dark fs-6 mt-1">{b2bRows.length} Invoices</div>
                          <div className="text-[11px] text-primary">Registered Buyers</div>
                        </div>
                      </div>

                      <div className="col-6 col-md">
                        <div className="p-2.5 bg-white border rounded-2 shadow-2xs">
                          <div className="text-[10px] text-muted font-monospace fw-bold">TABLE 5 (B2CL)</div>
                          <div className="fw-bold text-dark fs-6 mt-1">{b2clRows.length} Invoices</div>
                          <div className="text-[11px] text-indigo-600">Inter-state &gt; 2.5L</div>
                        </div>
                      </div>

                      <div className="col-6 col-md">
                        <div className="p-2.5 bg-white border rounded-2 shadow-2xs">
                          <div className="text-[10px] text-muted font-monospace fw-bold">TABLE 7 (B2CS)</div>
                          <div className="fw-bold text-dark fs-6 mt-1">{b2csRows.length} Invoices</div>
                          <div className="text-[11px] text-teal-600">Consumer / Small</div>
                        </div>
                      </div>

                      <div className="col-6 col-md">
                        <div className="p-2.5 bg-white border rounded-2 shadow-2xs">
                          <div className="text-[10px] text-muted font-monospace fw-bold">TABLE 9B (CDNR)</div>
                          <div className="fw-bold text-dark fs-6 mt-1">{cdnrRows.length} Notes</div>
                          <div className="text-[11px] text-amber-600">Credit / Debit</div>
                        </div>
                      </div>

                      <div className="col-6 col-md">
                        <div className="p-2.5 bg-white border rounded-2 shadow-2xs">
                          <div className="text-[10px] text-muted font-monospace fw-bold">TABLE 6A (EXP)</div>
                          <div className="fw-bold text-dark fs-6 mt-1">{expRows.length} Invoices</div>
                          <div className="text-[11px] text-purple-600">Exports</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Preview Table snippet */}
              <div className="table-responsive border rounded mb-3" style={{ maxHeight: '220px' }}>
                <table className="table table-sm table-hover mb-0 small">
                  <thead className="table-light sticky-top">
                    <tr>
                      {Object.keys(parsedRows[0] || {}).slice(0, 6).map((key) => (
                        <th key={key} className="text-nowrap">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).slice(0, 6).map((val, idx) => (
                          <td key={idx} className="text-nowrap">{String(val)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 5 && (
                <div className="text-muted small fst-italic mb-3">
                  + {parsedRows.length - 5} more rows ready for import.
                </div>
              )}

              <div className="d-flex justify-content-between align-items-center">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={resetState}
                  disabled={loading}
                >
                  Clear File
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm px-4 fw-semibold d-flex align-items-center gap-2"
                  onClick={handleImport}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader size="sm" />
                      <span>Ingesting records...</span>
                    </>
                  ) : (
                    <span>Import {parsedRows.length} Records</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Import Result Feedback */}
          {result && (
            <div className="mt-4 pt-3 border-top">
              <div className={`alert ${result.errors?.length > 0 ? 'alert-warning' : 'alert-success'} py-3 px-3 rounded-2 mb-3`} role="status">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <div className="fw-bold fs-6">
                    {result.errors?.length > 0 ? '⚠️ Import Completed with Warnings' : '✓ Import Completed Successfully!'}
                  </div>
                  <div>
                    <span className="badge bg-success me-1">{result.importedCount || result.successCount} Imported</span>
                    {result.skippedCount > 0 && (
                      <span className="badge bg-secondary me-1">{result.skippedCount} Skipped</span>
                    )}
                    {result.errors?.length > 0 && (
                      <span className="badge bg-danger">{result.errors.length} Failed</span>
                    )}
                  </div>
                </div>
                <p className="small mb-2">
                  Processed {result.totalProcessed || parsedRows.length} transactions into your active workspace.
                </p>
                <div className="d-flex gap-2 flex-wrap">
                  {importType === 'sales' ? (
                    <>
                      <Link to="/returns/gstr1" className="btn btn-sm btn-success fw-semibold">
                        🚀 Proceed to GSTR-1 Preparation →
                      </Link>
                      <Link to="/invoices" className="btn btn-sm btn-outline-dark fw-semibold">
                        📋 View Invoices
                      </Link>
                    </>
                  ) : (
                    <Link to="/bills" className="btn btn-sm btn-outline-dark fw-semibold">
                      📥 View Purchase Bills
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={resetState}
                  >
                    Import Another File
                  </button>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="border border-danger rounded p-3 bg-light">
                  <h4 className="fs-6 fw-bold text-danger mb-2">Row Errors:</h4>
                  <ul className="small text-danger mb-0 ps-3" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                    {result.errors.map((err, idx) => (
                      <li key={idx}>
                        {err.invoiceNumber || err.billNumber ? `[${err.invoiceNumber || err.billNumber}] ` : ''}
                        {err.row ? `Row ${err.row}: ` : ''}
                        {err.error || err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Templates Info Box */}
        <div className="card border shadow-sm bg-white p-4">
          <h3 className="fs-6 fw-bold text-dark mb-2">Spreadsheet Guidelines</h3>
          <p className="text-muted small mb-3">
            To ensure zero validation errors, follow standard GST specifications:
          </p>
          <div className="row g-3 small text-secondary">
            <div className="col-md-6">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark mb-1">Sales Invoices Format</div>
                <p className="mb-0">
                  Includes Invoice Number, Invoice Date (DD-MM-YYYY), Document Type (INVOICE/CREDIT_NOTE), Customer Name, Customer GSTIN, Place of Supply (e.g., 06), Item Name, HSN/SAC, Unit (UQC), Quantity, Rate, Discount, Taxable Amount, GST Rate (%), IGST, CGST, SGST, and Total Amount.
                </p>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark mb-1">Purchase Bills Format</div>
                <p className="mb-0">
                  Includes Bill Number, Bill Date, Document Type, Vendor Name, Vendor GSTIN, Place of Supply, Item Name, HSN/SAC, Unit (UQC), Quantity, Rate, Discount, Taxable Amount, GST Rate (%), IGST, CGST, SGST, and Total Amount.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}