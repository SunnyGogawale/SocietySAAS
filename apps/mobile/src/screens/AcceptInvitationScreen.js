import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

export function AcceptInvitationScreen({ route }) {
  const { request } = useAuth();
  const token = route.params?.token ?? '';
  const [displayName, setDisplayName] = useState('');
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
      const result = await request('/auth/invitations/accept', {
        method: 'POST',
        body: { token, displayName, password },
      });
      setMessage(
        result.emailVerificationRequired
          ? 'Invitation accepted. Check your email to verify your account.'
          : result.membershipStatus === 'pending_verification'
            ? 'Invitation accepted. A society administrator must verify your membership.'
            : 'Invitation accepted. You can now sign in.',
      );
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScreenHeading title="Accept invitation" description="Complete your account setup." />
      {!token ? (
        <Feedback tone="danger">This invitation link is invalid or missing.</Feedback>
      ) : null}
      {message ? <Feedback tone="success">{message}</Feedback> : null}
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {token && !message ? (
        <>
          <FormField label="Full name" onChangeText={setDisplayName} value={displayName} />
          <FormField
            autoComplete="new-password"
            label="Password"
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
            disabled={
              submitting || !displayName || password.length < 12 || confirmation.length < 12
            }
            onPress={handleSubmit}
          >
            {submitting ? 'Accepting…' : 'Accept invitation'}
          </ActionButton>
        </>
      ) : null}
    </Screen>
  );
}
