import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

const { colors, spacing, typography } = designTokens;

export function AccountScreen() {
  const { activeSociety, logout, selectSociety, societies, updateProfile, user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  async function saveProfile() {
    setError('');
    setFeedback('');
    try {
      await updateProfile({ displayName, phone });
      setFeedback('Profile updated.');
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function handleSelectSociety(societyId) {
    setError('');
    setFeedback('');
    try {
      await selectSociety(societyId);
      setFeedback('Active society updated.');
    } catch (selectError) {
      setError(selectError.message);
    }
  }

  async function handleLogout() {
    setError('');
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  return (
    <Screen>
      <ScreenHeading title="Account" description="Manage your profile and active society." />
      {feedback ? <Feedback tone="success">{feedback}</Feedback> : null}
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <Panel title="Profile">
        <Text style={styles.email}>{user?.email}</Text>
        <FormField label="Full name" onChangeText={setDisplayName} value={displayName} />
        <FormField
          autoComplete="tel"
          keyboardType="phone-pad"
          label="Phone number"
          onChangeText={setPhone}
          value={phone}
        />
        <ActionButton onPress={saveProfile}>Save profile</ActionButton>
      </Panel>
      {societies.length > 1 ? (
        <Panel title="Select society">
          {societies.map((society) => (
            <View key={society.id} style={styles.societyRow}>
              <View style={styles.societyDetails}>
                <Text style={styles.societyName}>{society.name}</Text>
                <Text style={styles.societyRole}>{society.role.replace('_', ' ')}</Text>
              </View>
              {activeSociety?.id === society.id ? (
                <Text accessibilityLabel="Active society" style={styles.activeLabel}>
                  Active
                </Text>
              ) : (
                <ActionButton onPress={() => handleSelectSociety(society.id)} variant="secondary">
                  Select
                </ActionButton>
              )}
            </View>
          ))}
        </Panel>
      ) : activeSociety ? (
        <Panel title="Active society">
          <Text style={styles.societyName}>{activeSociety.name}</Text>
        </Panel>
      ) : null}
      <ActionButton onPress={handleLogout} variant="secondary">
        Sign out
      </ActionButton>
    </Screen>
  );
}

const styles = StyleSheet.create({
  email: { color: colors.textMuted, fontSize: typography.fontSize.sm },
  societyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  societyDetails: { flex: 1, gap: spacing[1] },
  societyName: {
    color: colors.text,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  societyRole: { color: colors.textMuted, fontSize: typography.fontSize.xs },
  activeLabel: { color: colors.success, fontWeight: '600' },
});
