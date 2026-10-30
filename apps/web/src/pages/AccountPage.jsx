import { Card } from '../components/ui/Card.jsx';

export default function AccountPage() {
  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 id="page-title">Account</h1>
          <p className="page-heading__description">
            Identity and account management are not connected yet.
          </p>
        </div>
      </div>
      <Card title="Account settings">
        <p className="muted-copy">
          Authentication and profile workflows will follow the approved identity requirements.
        </p>
      </Card>
    </section>
  );
}
