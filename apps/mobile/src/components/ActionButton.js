import { Pressable, StyleSheet, Text } from 'react-native';
import designTokens from '@societysaas/design-tokens';

const { colors, radii, spacing, typography } = designTokens;

export function ActionButton({ children, onPress, variant = 'primary', disabled = false }) {
  const secondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondary : styles.primary,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.label, secondary ? styles.secondaryLabel : null]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderRadius: radii.md,
  },
  primary: { borderColor: colors.navy900, backgroundColor: colors.navy900 },
  secondary: { borderColor: colors.border, backgroundColor: colors.surface },
  label: {
    color: '#ffffff',
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  secondaryLabel: { color: colors.text },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
});
