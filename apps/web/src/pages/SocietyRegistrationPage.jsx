import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { AuthPage } from '../components/auth/AuthPage.jsx';

export default function SocietyRegistrationPage() {
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const optionalValue = (name) => form.get(name) || undefined;
    try {
      const result = await apiRequest('/platform/registrations', {
        method: 'POST',
        body: {
          name: form.get('name'),
          slug: form.get('slug'),
          contactName: form.get('contactName'),
          contactEmail: form.get('contactEmail'),
          registrationNumber: optionalValue('registrationNumber'),
          address: optionalValue('address'),
          contactPhone: optionalValue('contactPhone'),
        },
      });
      setSubmitted(result.registration);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage
      description="Submit your society details for platform review."
      title={submitted ? 'Registration received' : 'Register a society'}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {submitted ? (
        <Alert tone="success">
          {submitted.name} is awaiting review. Keep your registration reference:{' '}
          <strong>{submitted.id}</strong>.
        </Alert>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <FormField
            autoComplete="organization"
            id="society-name"
            label="Society name"
            name="name"
            required
          />
          <FormField
            autoComplete="off"
            hint="Use lowercase letters, numbers, and hyphens."
            id="society-slug"
            label="Preferred tenant slug"
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <FormField
            id="registration-number"
            label="Registration number (optional)"
            name="registrationNumber"
          />
          <FormField
            as="textarea"
            autoComplete="street-address"
            id="society-address"
            label="Society address (optional)"
            name="address"
            rows={3}
          />
          <FormField
            autoComplete="name"
            id="contact-name"
            label="Primary admin contact"
            name="contactName"
            required
          />
          <FormField
            autoComplete="email"
            id="contact-email"
            label="Primary admin email"
            name="contactEmail"
            required
            type="email"
          />
          <FormField
            autoComplete="tel"
            id="contact-phone"
            label="Contact phone (optional)"
            name="contactPhone"
          />
          <Button className="auth-form__submit" disabled={submitting} type="submit">
            {submitting ? 'Submitting…' : 'Submit for review'}
          </Button>
        </form>
      )}
      <Link className="auth-link" to="/login">
        Return to sign in
      </Link>
    </AuthPage>
  );
}
