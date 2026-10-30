import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { AuthPage } from '../components/auth/AuthPage.jsx';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get('token') ?? '');
  const location = useLocation();
  const navigate = useNavigate();
  const hasToken = searchParams.has('token');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hasToken) {
      navigate(location.pathname, { replace: true });
    }
  }, [hasToken, location.pathname, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const password = form.get('password');
    if (password !== form.get('confirmPassword')) {
      setError('Passwords do not match.');
      setSubmitting(false);
      return;
    }
    try {
      await apiRequest('/auth/password/reset', {
        method: 'POST',
        body: { token, password },
      });
      setMessage('Your password has been updated. Sign in with your new password.');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage description="Choose a new password for your account." title="Choose a new password">
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {!token && <Alert tone="danger">This reset link is invalid or missing.</Alert>}
      {token && !message && (
        <form className="auth-form" onSubmit={handleSubmit}>
          <FormField
            autoComplete="new-password"
            hint="Use 12 to 128 characters."
            id="password"
            label="New password"
            minLength={12}
            name="password"
            required
            type="password"
          />
          <FormField
            autoComplete="new-password"
            id="confirm-password"
            label="Confirm password"
            minLength={12}
            name="confirmPassword"
            required
            type="password"
          />
          <Button className="auth-form__submit" disabled={submitting} type="submit">
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
      <Link className="auth-link" to="/login">
        Return to sign in
      </Link>
    </AuthPage>
  );
}
