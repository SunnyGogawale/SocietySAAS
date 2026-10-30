import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

export function ResetPasswordScreen({ route }) {
  const { request } = useAuth();
  const token = route.params?.token ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setMessage('');
    setError('');
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await request('/auth/password/reset', { method: 'POST', body: { token, password } });
      setMessage('Password updated. Sign in with your new password.');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScreenHeading title="Choose a new password" description="Use 12 to 128 characters." />
      {!token ? <Feedback tone="danger">This reset link is invalid or missing.</Feedback> : null}
      {message ? <Feedback tone="success">{message}</Feedback> : null}
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {token && !message ? (
        <>
          <FormField
            autoComplete="new-password"
            label="New password"
            onChangeText={setPassword}
            secureTextEntry
            value={password}
          />
          <FormField
            autoComplete="new-password"
            label="Confirm password"
            onChangeText={setConfirmation}
            secureTextEntry
            value={confirmation}
          />
          <ActionButton
            disabled={submitting || password.length < 12 || confirmation.length < 12}
            onPress={handleSubmit}
          >
            {submitting ? 'Updating…' : 'Update password'}
          </ActionButton>
        </>
      ) : null}
    </Screen>
  );
}
