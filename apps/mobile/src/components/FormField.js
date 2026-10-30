import { StyleSheet, Text, TextInput, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';

const { colors, radii, spacing, typography } = designTokens;

export function FormField({ label, hint, error, ...inputProps }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error || hint}
        style={[styles.input, error ? styles.inputError : null]}
        placeholderTextColor={colors.textMuted}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[2] },
  label: {
    color: colors.text,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: spacing[3],
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: typography.fontSize.md,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: typography.fontSize.xs },
  hint: { color: colors.textMuted, fontSize: typography.fontSize.xs },
});
