import { StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';

const { colors, radii, spacing, typography } = designTokens;

export function Panel({ title, children }) {
  return (
    <View style={styles.panel}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing[3],
    padding: spacing[5],
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.semibold,
  },
});
