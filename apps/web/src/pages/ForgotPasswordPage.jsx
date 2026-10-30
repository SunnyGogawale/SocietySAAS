import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { AuthPage } from '../components/auth/AuthPage.jsx';

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    setSubmitting(true);
    try {
      const form = new FormData(event.currentTarget);
      const result = await apiRequest('/auth/password/forgot', {
        method: 'POST',
        body: { email: form.get('email') },
      });
      setMessage(result.message);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage
      description="Enter your email address and we’ll send reset instructions if an account matches."
      title="Reset password"
    >
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <FormField
          autoComplete="email"
          id="email"
          label="Email address"
          name="email"
          required
          type="email"
        />
        <Button className="auth-form__submit" disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <Link className="auth-link" to="/login">
        Return to sign in
      </Link>
    </AuthPage>
  );
}
