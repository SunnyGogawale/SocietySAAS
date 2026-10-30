import { Feedback, LoadingState } from '../components/Feedback';
import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';
import designTokens from '@societysaas/design-tokens';
import { StyleSheet, Text, View } from 'react-native';

const { colors, spacing, typography } = designTokens;

export function OverviewScreen() {
  return (
    <Screen>
      <ScreenHeading
        title="Overview"
        description="The mobile foundation is ready for approved product features."
      />
      <Feedback title="Business workflows are not enabled">
        This starter app contains reusable controls and no live society data.
      </Feedback>
      <Panel title="Workspace status">
        <View style={styles.statusLine}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Application shell ready</Text>
        </View>
        <Text style={styles.copy}>
          Shared design tokens, navigation, and accessible screen components are in place.
        </Text>
      </Panel>
      <Panel title="Feedback state">
        <LoadingState label="Loading states are available to screens" />
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.success },
  statusText: {
    color: colors.text,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  copy: { color: colors.textMuted, fontSize: typography.fontSize.sm, lineHeight: 21 },
});
