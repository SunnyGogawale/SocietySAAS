import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { AuthPage } from '../components/auth/AuthPage.jsx';

export default function AcceptInvitationPage() {
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
      const result = await apiRequest('/auth/invitations/accept', {
        method: 'POST',
        body: {
          token,
          displayName: form.get('displayName'),
          password,
        },
      });
      setMessage(
        result.emailVerificationRequired
          ? 'Your invitation is accepted. Check your email to verify your account.'
          : result.membershipStatus === 'pending_verification'
            ? 'Your invitation is accepted. A society administrator must verify your membership.'
            : 'Your invitation is accepted. You can now sign in.',
      );
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage
      description="Complete your account setup to join your society."
      title="Accept invitation"
    >
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {!token && <Alert tone="danger">This invitation link is invalid or missing.</Alert>}
      {token && !message && (
        <form className="auth-form" onSubmit={handleSubmit}>
          <FormField
            autoComplete="name"
            id="display-name"
            label="Full name"
            name="displayName"
            required
          />
          <FormField
            autoComplete="new-password"
            hint="Use 12 to 128 characters."
            id="password"
            label="Password"
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
            {submitting ? 'Accepting…' : 'Accept invitation'}
          </Button>
        </form>
      )}
      <Link className="auth-link" to="/login">
        Return to sign in
      </Link>
    </AuthPage>
  );
}
