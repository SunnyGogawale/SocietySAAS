import { Link } from 'react-router-dom';
import { Alert } from '../components/ui/Alert.jsx';
import { Card } from '../components/ui/Card.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { usePlatformData } from '../platform/usePlatformData.js';

const cards = [
  ['Total societies', (data) => data.societies.total],
  ['Active tenants', (data) => data.societies.active],
  ['Suspended tenants', (data) => data.societies.suspended],
  ['Awaiting review', (data) => data.societies.pendingReview],
  ['Trial subscriptions', (data) => data.subscriptions.trialing],
  ['Active subscriptions', (data) => data.subscriptions.active],
];

export default function PlatformDashboardPage() {
  const { data, error, loading } = usePlatformData('/platform/dashboard');

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform administration</p>
          <h1 id="page-title">Platform dashboard</h1>
          <p className="page-heading__description">
            Tenant lifecycle, subscriptions, support, and service health.
          </p>
        </div>
        <Link className="button button--primary" to="/platform/societies?status=pending_review">
          Review registrations
        </Link>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {loading && <LoadingState label="Loading platform summary…" />}
      {data && (
        <>
          <div className="platform-stats">
            {cards.map(([label, value]) => (
              <Card key={label}>
                <p className="platform-stat__label">{label}</p>
                <p className="platform-stat__value">{value(data)}</p>
              </Card>
            ))}
          </div>
          <div className="platform-columns">
            <Card title="Subscriptions by plan">
              {data.subscriptions.plans.length ? (
                <ul className="platform-list">
                  {data.subscriptions.plans.map((plan) => (
                    <li key={plan.id}>
                      <span>{plan.name}</span>
                      <strong>{plan.tenants} tenants</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No active plans configured.</p>
              )}
              <Link className="auth-link platform-card-link" to="/platform/plans">
                Manage plans
              </Link>
            </Card>
            <Card title="Support queue">
              <p className="platform-stat__value">{data.support.openTickets}</p>
              <p className="muted-copy">Open or in-progress tickets</p>
              <Link className="auth-link platform-card-link" to="/platform/support">
                Open support queue
              </Link>
            </Card>
            <Card title="System status">
              <div className="status-line">
                <StatusBadge tone={data.operations.status === 'ok' ? 'success' : 'danger'}>
                  {data.operations.status === 'ok' ? 'Operational' : 'Degraded'}
                </StatusBadge>
                <span>API service</span>
              </div>
              <div className="status-line">
                <StatusBadge tone={data.operations.database === 'connected' ? 'success' : 'danger'}>
                  {data.operations.database}
                </StatusBadge>
                <span>Database</span>
              </div>
              <p className="muted-copy">
                {data.operations.failuresLast24Hours} failed audit events in the last 24 hours
              </p>
              <Link className="auth-link platform-card-link" to="/platform/audit">
                Review platform audit
              </Link>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
