import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

const { colors, spacing, typography } = designTokens;

export function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    setError('');
    setSubmitting(true);
    try {
      await login({ email, password });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Text style={styles.brandInitial}>S</Text>
        </View>
        <Text style={styles.brandName}>SocietySAAS</Text>
      </View>
      <ScreenHeading title="Welcome back" description="Sign in to your SocietySAAS account." />
      {error ? (
        <Feedback title="Sign in failed" tone="danger">
          {error}
        </Feedback>
      ) : null}
      <FormField
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        label="Email address"
        onChangeText={setEmail}
        value={email}
      />
      <FormField
        autoCapitalize="none"
        autoComplete="current-password"
        label="Password"
        onChangeText={setPassword}
        secureTextEntry
        value={password}
      />
      <ActionButton disabled={submitting || !email || !password} onPress={handleLogin}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </ActionButton>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('ForgotPassword')}
        style={styles.link}
      >
        <Text style={styles.linkText}>Forgot your password?</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[5] },
  brandMark: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.blue600,
  },
  brandInitial: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
  brandName: { color: colors.navy900, fontWeight: '700', fontSize: typography.fontSize.lg },
  link: { alignSelf: 'center', padding: spacing[2] },
  linkText: { color: colors.info, fontSize: typography.fontSize.sm, fontWeight: '600' },
});
