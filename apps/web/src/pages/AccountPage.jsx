import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { FormField } from '../components/ui/FormField.jsx';

export default function AccountPage() {
  const { updateProfile, user } = useAuth();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback('');
    setError('');
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await updateProfile({
        displayName: form.get('displayName'),
        phone: form.get('phone'),
      });
      setFeedback('Profile updated.');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 id="page-title">Account</h1>
          <p className="page-heading__description">Manage your profile and account details.</p>
        </div>
      </div>
      {feedback && <Alert tone="success">{feedback}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Card title="Profile">
        <form className="profile-form" onSubmit={handleSubmit}>
          <FormField
            autoComplete="name"
            defaultValue={user?.displayName}
            id="display-name"
            label="Full name"
            name="displayName"
            required
          />
          <FormField
            autoComplete="email"
            defaultValue={user?.email}
            disabled
            id="email"
            label="Email address"
            name="email"
            type="email"
          />
          <FormField
            autoComplete="tel"
            defaultValue={user?.phone ?? ''}
            id="phone"
            label="Phone number"
            name="phone"
            type="tel"
          />
          <Button disabled={saving} type="submit">
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </form>
      </Card>
    </section>
  );
}
