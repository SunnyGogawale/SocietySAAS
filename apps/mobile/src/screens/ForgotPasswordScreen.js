import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

export function ForgotPasswordScreen() {
  const { request } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setMessage('');
    setError('');
    setSubmitting(true);
    try {
      const result = await request('/auth/password/forgot', {
        method: 'POST',
        body: { email },
      });
      setMessage(result.message);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScreenHeading
        title="Reset password"
        description="Enter your email and we’ll send reset instructions if an account matches."
      />
      {message ? <Feedback tone="success">{message}</Feedback> : null}
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <FormField
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        label="Email address"
        onChangeText={setEmail}
        value={email}
      />
      <ActionButton disabled={submitting || !email} onPress={handleSubmit}>
        {submitting ? 'Sending…' : 'Send reset link'}
      </ActionButton>
    </Screen>
  );
}
