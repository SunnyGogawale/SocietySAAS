import { Alert } from '../components/ui/Alert.jsx';
import { Card } from '../components/ui/Card.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';

export default function OverviewPage() {
  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 id="page-title">Overview</h1>
          <p className="page-heading__description">
            The application foundation is ready for approved product features.
          </p>
        </div>
        <StatusBadge tone="info">Foundation</StatusBadge>
      </div>
      <Alert title="Business workflows are not enabled">
        This starter workspace contains reusable interface components and no live society data.
      </Alert>
      <div className="overview-grid">
        <Card title="Workspace status">
          <div className="status-line">
            <StatusBadge tone="success">Ready</StatusBadge>
            <span>Application shell</span>
          </div>
          <p className="muted-copy">
            Navigation, shared design tokens, and accessible UI building blocks are in place.
          </p>
        </Card>
        <Card title="Next step">
          <p className="muted-copy">
            Review the Phase 1 specification and implementation dependencies before starting
            business modules.
          </p>
        </Card>
      </div>
      <Card className="component-preview" title="Feedback state">
        <LoadingState label="Loading states are available to application screens" />
      </Card>
    </section>
  );
}
