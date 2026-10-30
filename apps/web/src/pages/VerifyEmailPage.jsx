import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { AuthPage } from '../components/auth/AuthPage.jsx';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get('token') ?? '');
  const location = useLocation();
  const navigate = useNavigate();
  const hasToken = searchParams.has('token');
  const [state, setState] = useState({ loading: true, error: '' });

  useEffect(() => {
    if (hasToken) {
      navigate(location.pathname, { replace: true });
    }
  }, [hasToken, location.pathname, navigate]);

  useEffect(() => {
    let active = true;
    if (!token) {
      setState({ loading: false, error: 'This verification link is invalid or missing.' });
      return () => {
        active = false;
      };
    }
    apiRequest('/auth/email/verify', { method: 'POST', body: { token } })
      .then(() => active && setState({ loading: false, error: '' }))
      .catch((error) => active && setState({ loading: false, error: error.message }));
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <AuthPage
      description="Confirm the email address associated with your account."
      title="Email verification"
    >
      {state.loading ? (
        <p role="status">Verifying your email…</p>
      ) : state.error ? (
        <Alert tone="danger">{state.error}</Alert>
      ) : (
        <Alert tone="success">Your email address has been verified. You can sign in.</Alert>
      )}
      <Link className="auth-link" to="/login">
        Continue to sign in
      </Link>
    </AuthPage>
  );
}
