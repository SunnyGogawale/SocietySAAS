import { Card } from '../components/ui/Card.jsx';

export default function ActivityPage() {
  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 id="page-title">Activity</h1>
          <p className="page-heading__description">
            No activity feed is connected in this foundation.
          </p>
        </div>
      </div>
      <Card title="Nothing to show yet">
        <p className="muted-copy">
          Activity views will be added with an approved product workflow.
        </p>
      </Card>
    </section>
  );
}
