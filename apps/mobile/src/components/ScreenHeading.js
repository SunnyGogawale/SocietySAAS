import { StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';

const { colors, spacing, typography } = designTokens;

export function ScreenHeading({ eyebrow = 'WORKSPACE', title, description }) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[1] },
  eyebrow: {
    color: colors.textMuted,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: 1,
  },
  title: {
    color: colors.text,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  description: {
    color: colors.textMuted,
    fontSize: typography.fontSize.sm,
    lineHeight: 21,
  },
});
