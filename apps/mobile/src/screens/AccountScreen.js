import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';
import { Text } from 'react-native';
import designTokens from '@societysaas/design-tokens';

export function AccountScreen() {
  return (
    <Screen>
      <ScreenHeading
        title="Account"
        description="Identity and account management are not connected yet."
      />
      <Panel title="Account settings">
        <Text style={{ color: designTokens.colors.textMuted }}>
          Authentication and profile workflows will follow the approved identity requirements.
        </Text>
      </Panel>
    </Screen>
  );
}
