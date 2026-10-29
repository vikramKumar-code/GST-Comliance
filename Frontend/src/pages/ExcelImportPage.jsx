import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { importInvoices, importBills } from '../api/import.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';

const SAMPLE_SALES = [
  {
    'Invoice Number': 'INV-2026-001',
    'Date': '2026-10-25',
    'Customer Name': 'Reliance Retail Ltd',
    'Customer GSTIN': '27AAACR7197Q1ZV',
    'Place of Supply': '27-Maharashtra',
    'Item Name': 'Industrial Steel Coil',
    'HSN': '7208',
    'Quantity': 10,
    'Rate': 5000,
    'Discount Amount': 500,
    'Tax Rate': 18
  },
  {
    'Invoice Number': 'INV-2026-002',
    'Date': '2026-10-26',
    'Customer Name': 'Tata Motors Ltd',
    'Customer GSTIN': '27AAAAT1234A1Z5',
    'Place of Supply': '27-Maharashtra',
    'Item Name': 'Auto Engine Parts',
    'HSN': '8407',
    'Quantity': 5,
    'Rate': 12000,
    'Discount Amount': 0,
    'Tax Rate': 28
  },
  {
    'Invoice Number': 'INV-2026-003',
    'Date': '2026-10-27',
    'Customer Name': 'Infosys BPM',
    'Customer GSTIN': '29AAACI4567B1Z8',
    'Place of Supply': '29-Karnataka',
    'Item Name': 'IT Cloud Software Setup',
    'HSN': '9983',
    'Quantity': 1,
    'Rate': 75000,
    'Discount Amount': 2500,
    'Tax Rate': 18
  }
];

const SAMPLE_PURCHASES = [
  {
    'Bill Number': 'BILL-9801',
    'Date': '2026-10-20',
    'Vendor Name': 'Godrej Supplies Ltd',
    'Vendor GSTIN': '27AAACG1234D1Z9',
    'Place of Supply': '27-Maharashtra',
    'Item Name': 'Raw Metal Sheets',
    'HSN': '7208',
    'Quantity': 20,
    'Rate': 3500,
    'Tax Rate': 18
  },
  {
    'Bill Number': 'BILL-9802',
    'Date': '2026-10-22',
    'Vendor Name': 'Havells Power Cables',
    'Vendor GSTIN': '07AAAAP4321E1Z3',
    'Place of Supply': '07-Delhi',
    'Item Name': 'Electrical Copper Wires',
    'HSN': '8544',
    'Quantity': 15,
    'Rate': 4200,
    'Tax Rate': 18
  },
  {
    'Bill Number': 'BILL-9803',
    'Date': '2026-10-24',
    'Vendor Name': 'Apex Packaging',
    'Vendor GSTIN': '27AAACA5678F1Z2',
    'Place of Supply': '27-Maharashtra',
    'Item Name': 'Corrugated Shipping Boxes',
    'HSN': '4819',
    'Quantity': 100,
    'Rate': 65,
    'Tax Rate': 12
  }
];

export default function ExcelImportPage() {
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
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('Workbook contains no sheets or readable data.');
        }
        const worksheet = workbook.Sheets[firstSheetName];
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
        ws['!cols'] = isSales
          ? [
              { wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 18 }, { wch: 18 },
              { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }
            ]
          : [
              { wch: 18 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 18 },
              { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
            ];
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename, { bookType: format });
    } catch {
      // Fallback to backend download endpoint if client-side write encounters any sandbox issue
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
          Bulk import your sales invoices and purchase bills from Excel or CSV spreadsheets with automated GST tax calculation.
        </p>
      </div>

      <div className="zoho-page-body" style={{ maxWidth: '900px' }}>
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
              Supports Microsoft Excel (.xlsx, .xls) & standard CSV with column headers. Auto-calculates GST.
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

          {/* Parsed Preview Table */}
          {parsedRows.length > 0 && !result && (
            <div className="mt-4 pt-3 border-top">
              <div className="d-flex justify-content-between align-items-center mb-2">
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

              {/* Preview Table snippet */}
              <div className="table-responsive border rounded mb-3" style={{ maxHeight: '220px' }}>
                <table className="table table-sm table-hover mb-0 small">
                  <thead className="table-light">
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
                    <span className="badge bg-success me-1">{result.importedCount} Imported</span>
                    {result.skippedCount > 0 && (
                      <span className="badge bg-secondary me-1">{result.skippedCount} Skipped (Duplicates)</span>
                    )}
                    {result.errors?.length > 0 && (
                      <span className="badge bg-danger">{result.errors.length} Failed</span>
                    )}
                  </div>
                </div>
                <p className="small mb-2">
                  Processed {result.totalProcessed || parsedRows.length} transactions into your active workspace.
                </p>
                <div className="d-flex gap-2">
                  {importType === 'sales' ? (
                    <Link to="/invoices" className="btn btn-sm btn-outline-dark fw-semibold">
                      📋 View Invoices
                    </Link>
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
                  <ul className="small text-danger mb-0 ps-3">
                    {result.errors.map((err, idx) => (
                      <li key={idx}>
                        {err.invoiceNumber || err.billNumber ? `[${err.invoiceNumber || err.billNumber}] ` : ''}
                        {err.row ? `Row ${err.row}: ` : ''}
                        {err.error}
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
            To ensure zero validation errors, follow standard GST offline specifications:
          </p>
          <div className="row g-3 small text-secondary">
            <div className="col-md-6">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark mb-1">Sales Invoices Format</div>
                <p className="mb-0">
                  Includes Invoice Number, Customer Name, 15-digit Customer GSTIN, Place of Supply (e.g. 27-Maharashtra), HSN code, Qty, Rate, and GST Rate (5, 12, 18, 28).
                </p>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark mb-1">Purchase Bills Format</div>
                <p className="mb-0">
                  Includes Bill Number, Vendor Name, Vendor GSTIN, Category (Expense, Inventory, Asset), Item Description, Quantity, Rate, and Tax Rate.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
