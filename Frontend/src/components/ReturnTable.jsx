import { formatCurrency } from '../utils/format';

export default function ReturnTable({ rows = [], totals }) {
  return (
    <div className="card shadow-sm border bg-white rounded-3">
      <div className="table-responsive">
        <table className="table table-hover table-striped align-middle mb-0">
          <thead className="table-light border-bottom">
            <tr>
              <th className="py-3 px-3">Description / Label</th>
              <th className="text-end py-3 px-3">Taxable Amount (₹)</th>
              <th className="text-end py-3 px-3">IGST (₹)</th>
              <th className="text-end py-3 px-3">CGST (₹)</th>
              <th className="text-end py-3 px-3">SGST (₹)</th>
              <th className="text-end py-3 px-3">Cess (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="6" className="text-center py-5 text-muted">
                  No return data available for this period.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx}>
                  <td className="fw-medium px-3 text-dark">{row.label}</td>
                  <td className="text-end font-monospace px-3">{formatCurrency(row.taxable || 0)}</td>
                  <td className="text-end font-monospace px-3">{formatCurrency(row.igst || 0)}</td>
                  <td className="text-end font-monospace px-3">{formatCurrency(row.cgst || 0)}</td>
                  <td className="text-end font-monospace px-3">{formatCurrency(row.sgst || 0)}</td>
                  <td className="text-end font-monospace px-3">{formatCurrency(row.cess || 0)}</td>
                </tr>
              ))
            )}
          </tbody>
          {totals && (
            <tfoot className="table-light fw-bold border-top">
              <tr>
                <td className="px-3 text-dark">Total</td>
                <td className="text-end font-monospace px-3">{formatCurrency(totals.taxable || 0)}</td>
                <td className="text-end font-monospace px-3">{formatCurrency(totals.igst || 0)}</td>
                <td className="text-end font-monospace px-3">{formatCurrency(totals.cgst || 0)}</td>
                <td className="text-end font-monospace px-3">{formatCurrency(totals.sgst || 0)}</td>
                <td className="text-end font-monospace px-3">{formatCurrency(totals.cess || 0)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
