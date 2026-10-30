import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';

const { colors, radii, spacing, typography } = designTokens;

const feedbackColors = {
  info: { background: colors.infoSurface, foreground: colors.info },
  success: { background: colors.successSurface, foreground: colors.success },
  warning: { background: colors.warningSurface, foreground: colors.warning },
  danger: { background: colors.dangerSurface, foreground: colors.danger },
};

export function Feedback({ children, tone = 'info', title }) {
  const palette = feedbackColors[tone] ?? feedbackColors.info;

  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'summary'}
      style={[styles.alert, { backgroundColor: palette.background }]}
    >
      <View>
        {title ? (
          <Text style={[styles.alertTitle, { color: palette.foreground }]}>{title}</Text>
        ) : null}
        <Text style={[styles.alertText, { color: palette.foreground }]}>{children}</Text>
      </View>
    </View>
  );
}

export function LoadingState({ label = 'Loading' }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
      <ActivityIndicator color={colors.blue600} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: { padding: spacing[4], borderRadius: radii.md },
  alertTitle: {
    marginBottom: spacing[1],
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  alertText: { fontSize: typography.fontSize.sm, lineHeight: 21 },
  loading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  loadingText: { color: colors.textMuted, fontSize: typography.fontSize.sm },
});
