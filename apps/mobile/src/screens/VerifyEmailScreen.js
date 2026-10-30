import { useEffect, useState } from 'react';
import { Feedback } from '../components/Feedback';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';
import { useAuth } from '../auth/AuthContext';

export function VerifyEmailScreen({ route }) {
  const { request } = useAuth();
  const token = route.params?.token ?? '';
  const [result, setResult] = useState({ loading: true, error: '' });

  useEffect(() => {
    let active = true;
    if (!token) {
      setResult({ loading: false, error: 'This verification link is invalid or missing.' });
      return () => {
        active = false;
      };
    }
    request('/auth/email/verify', { method: 'POST', body: { token } })
      .then(() => active && setResult({ loading: false, error: '' }))
      .catch((error) => active && setResult({ loading: false, error: error.message }));
    return () => {
      active = false;
    };
  }, [request, token]);

  return (
    <Screen>
      <ScreenHeading title="Email verification" description="Confirm your email address." />
      {result.loading ? (
        <Feedback>Verifying your email…</Feedback>
      ) : result.error ? (
        <Feedback tone="danger">{result.error}</Feedback>
      ) : (
        <Feedback tone="success">Your email is verified. You can sign in.</Feedback>
      )}
    </Screen>
  );
}
