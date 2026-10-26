import { useState } from 'react';
import { Link } from 'react-router-dom';
import { importInvoices, importBills } from '../api/import.api';
import Loader from '../components/Loader';
import ErrorMessage from '../components/ErrorMessage';

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const row = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuote && line[i + 1] === '"') {
          entry += '"';
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    return row;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    rows.push(obj);
  }
  return rows;
}

function downloadCsvBlob(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
        const text = event.target.result;
        const rows = parseCsv(text);
        if (rows.length === 0) {
          setError(new Error('The uploaded CSV file is empty or missing data rows.'));
        } else {
          setParsedRows(rows);
        }
      } catch (err) {
        setError(new Error('Failed to parse CSV file: ' + err.message));
      }
    };
    reader.onerror = () => {
      setError(new Error('Failed to read file from disk.'));
    };
    reader.readAsText(file);
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

  const handleDownloadTemplate = (type) => {
    if (type === 'sales') {
      const csv = [
        'Invoice Number,Date,Customer Name,Customer GSTIN,Place of Supply,Item Name,HSN,Quantity,Rate,Discount,GST %,Status',
        'INV-2026-001,2026-10-10,Acme Maharashtra Corp,27AABCA1234A1Z5,27-Maharashtra,Consulting Services,998311,1,25000,0,18,Sent',
        'INV-2026-002,2026-10-12,Global Karnataka Ltd,29AABCG5678B1Z2,29-Karnataka,Hardware Server,847130,2,40000,2000,18,Paid'
      ].join('\n');
      downloadCsvBlob('sales_invoices_sample_template.csv', csv);
    } else {
      const csv = [
        'Bill Number,Date,Vendor Name,Vendor GSTIN,Category,Description,HSN,Quantity,Rate,GST %,Status',
        'BILL-2026-001,2026-10-05,Tech Supplies Ltd,27AABCV1111V1Z1,Inventory,Network Routers,851762,5,3000,18,Paid',
        'BILL-2026-002,2026-10-08,Cloud Hosting Inc,07AABCC2222C1Z2,Expense,Server Hosting,998315,1,12000,18,Paid'
      ].join('\n');
      downloadCsvBlob('purchase_bills_sample_template.csv', csv);
    }
  };

  return (
    <div>
      <div className="zoho-page-header">
        <h1 className="fw-bold fs-4 text-dark mb-1">Excel & CSV Data Import</h1>
        <p className="text-secondary small mb-0">
          Bulk import your sales invoices and purchase bills from CSV spreadsheets with automated GST tax calculation.
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
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => handleDownloadTemplate(importType)}
            >
              ⬇️ Download {importType === 'sales' ? 'Sales' : 'Purchase'} CSV Template
            </button>
          </div>
        </div>

        {/* Upload Box */}
        <div className="card border shadow-sm bg-white p-4 mb-4">
          <h2 className="fs-6 fw-bold text-dark mb-3">
            Upload {importType === 'sales' ? 'Sales Invoices' : 'Purchase Bills'} Spreadsheet (.CSV)
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
              {selectedFile ? selectedFile.name : 'Choose a .csv file or drag and drop it here'}
            </div>
            <div className="text-muted small mb-3">
              Standard UTF-8 CSV with column headers. Auto-calculates CGST, SGST, IGST based on Place of Supply.
            </div>
            <input
              id="excelFileInput"
              type="file"
              accept=".csv"
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
