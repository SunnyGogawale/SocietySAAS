import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { Feedback, LoadingState } from '../components/Feedback';
import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

export function SocietySettingsScreen() {
  const { activeSociety, request, token } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!activeSociety?.id) {
      setSettings(null);
      setError('');
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setSettings(null);
    setLoading(true);
    setError('');
    request(`/societies/${encodeURIComponent(activeSociety.id)}/settings`, { token })
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeSociety?.id, request, token]);

  return (
    <Screen>
      <ScreenHeading
        title="Society settings"
        description="Read-only society details and resident-facing rules."
      />
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {loading ? <LoadingState label="Loading society settings" /> : null}
      {!activeSociety && !loading ? (
        <Feedback>Select a society from Account before viewing its settings.</Feedback>
      ) : null}
      {settings ? (
        <>
          <Panel title={settings.society.name}>
            {settings.society.address ? <Text>{settings.society.address}</Text> : null}
            <Text>Time zone: {settings.settings.timeZone}</Text>
            <Text>Currency: {settings.settings.currency}</Text>
            <Text>Date format: {settings.settings.dateFormat}</Text>
            <Text>
              Financial year starts: {settings.settings.financialYearStartMonth}/
              {settings.settings.financialYearStartDay}
            </Text>
          </Panel>
          <Panel title="Home numbering">
            <Text>Building: {settings.settings.numbering.building}</Text>
            <Text>Wing: {settings.settings.numbering.wing}</Text>
            <Text>Flat: {settings.settings.numbering.flat}</Text>
          </Panel>
          {settings.chargeRules ? (
            <Panel title="Maintenance schedule">
              <Text>Frequency: {settings.chargeRules.frequency.replaceAll('_', ' ')}</Text>
              <Text>Due day of period: {settings.chargeRules.dueDayOfPeriod}</Text>
              <Text>Grace period: {settings.chargeRules.gracePeriodDays} days</Text>
              <Text>
                Rules effective from:{' '}
                {new Date(settings.chargeRules.effectiveFrom).toLocaleDateString()}
              </Text>
            </Panel>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
