import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';
import { Text } from 'react-native';
import designTokens from '@societysaas/design-tokens';

export function ActivityScreen() {
  return (
    <Screen>
      <ScreenHeading
        title="Activity"
        description="No activity feed is connected in this foundation."
      />
      <Panel title="Nothing to show yet">
        <Text style={{ color: designTokens.colors.textMuted }}>
          Activity views will be added with an approved product workflow.
        </Text>
      </Panel>
    </Screen>
  );
}
