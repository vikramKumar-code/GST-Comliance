import { useParams, Link } from 'react-router-dom';
import PeriodSelector from '../components/PeriodSelector';
import ReturnTable from '../components/ReturnTable';

export default function ReturnDetailPage() {
  const { type } = useParams();
  const formattedType = type ? type.toUpperCase() : 'RETURN';

  return (
    <div className="container py-4">
      <div className="mb-3">
        <Link to="/dashboard" className="text-decoration-none small">
          ← Back to Dashboard
        </Link>
      </div>

      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
        <div>
          <h2 className="fw-bold mb-1">{formattedType} Return Breakdown</h2>
          <p className="text-secondary small mb-0">Detailed taxable line items and breakdown for {formattedType}.</p>
        </div>
        <PeriodSelector selectedPeriod="092026" onPeriodChange={() => {}} />
      </div>

      <ReturnTable rows={[]} totals={null} />
    </div>
  );
}
