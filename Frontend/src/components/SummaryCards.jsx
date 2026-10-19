export default function SummaryCards({ data }) {
  return (
    <div className="row g-3 mb-4">
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-primary h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Total Sales</span>
            <h3 className="card-title font-monospace fw-bold text-dark mb-0">
              ₹{data?.sales?.total?.toLocaleString('en-IN') || '0'}
            </h3>
          </div>
        </div>
      </div>

      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-info h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Total Purchases</span>
            <h3 className="card-title font-monospace fw-bold text-dark mb-0">
              ₹{data?.purchases?.total?.toLocaleString('en-IN') || '0'}
            </h3>
          </div>
        </div>
      </div>

      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-success h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Eligible ITC</span>
            <h3 className="card-title font-monospace fw-bold text-dark mb-0">
              ₹{data?.itc?.available?.toLocaleString('en-IN') || '0'}
            </h3>
          </div>
        </div>
      </div>

      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card shadow-sm border-0 border-start border-4 border-warning h-100 bg-white">
          <div className="card-body p-3">
            <span className="text-muted text-uppercase fw-semibold small d-block mb-1">Tax Payable</span>
            <h3 className="card-title font-monospace fw-bold text-dark mb-0">
              ₹{data?.taxPayable?.toLocaleString('en-IN') || '0'}
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
}
