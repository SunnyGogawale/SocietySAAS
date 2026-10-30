import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { AuthPage } from '../components/auth/AuthPage.jsx';

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate replace to="/" />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await login({
        email: form.get('email'),
        password: form.get('password'),
      });
      navigate('/', { replace: true });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage description="Sign in to your SocietySAAS account." title="Welcome back">
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
        <FormField
          autoComplete="current-password"
          id="password"
          label="Password"
          name="password"
          required
          type="password"
        />
        <Button className="auth-form__submit" disabled={submitting} type="submit">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <Link className="auth-link" to="/forgot-password">
        Forgot your password?
      </Link>
      <Link className="auth-link" to="/register-society">
        Register a society
      </Link>
    </AuthPage>
  );
}
