import { formatCurrency } from '../utils/format';

export default function SummaryCards({ data }) {
  const salesTotal = data?.sales?.total ?? data?.sales?.taxable ?? 0;
  const purchasesTotal = data?.purchases?.total ?? data?.purchases?.taxable ?? 0;
  const itcAvailable = data?.itc?.available ?? 0;
  const taxPayable = data?.taxPayable ?? 0;

  return (
    <div className="row g-3 mb-4">
      {/* Total Sales */}
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-primary h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Total Sales (GSTR-1)</span>
            <div className="card-title font-monospace fw-bold text-dark fs-4 mb-1">
              {formatCurrency(salesTotal)}
            </div>
            {data?.sales?.igst !== undefined && (
              <div className="text-muted small">
                Taxable: {formatCurrency(data.sales.taxable || 0)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Total Purchases */}
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-info h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Total Purchases (GSTR-2B)</span>
            <div className="card-title font-monospace fw-bold text-dark fs-4 mb-1">
              {formatCurrency(purchasesTotal)}
            </div>
            {data?.purchases?.taxable !== undefined && (
              <div className="text-muted small">
                Taxable: {formatCurrency(data.purchases.taxable || 0)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Eligible ITC */}
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-success h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Eligible ITC</span>
            <div className="card-title font-monospace fw-bold text-dark fs-4 mb-1">
              {formatCurrency(itcAvailable)}
            </div>
            {data?.itc?.claimed !== undefined && (
              <div className="text-muted small">
                Claimed: {formatCurrency(data.itc.claimed || 0)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tax Payable */}
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-warning h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Net Tax Payable (GSTR-3B)</span>
            <div className="card-title font-monospace fw-bold text-dark fs-4 mb-1">
              {formatCurrency(taxPayable)}
            </div>
            <div className="text-muted small">Liability after credit offset</div>
          </div>
        </div>
      </div>
    </div>
  );
}
