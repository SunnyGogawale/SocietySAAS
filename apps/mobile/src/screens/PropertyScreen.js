import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';
import { useAuth } from '../auth/AuthContext';
import { Feedback, LoadingState } from '../components/Feedback';
import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

const { colors, spacing, typography } = designTokens;

function propertyLabel(property) {
  const { flat, ownerships, occupancies } = property;
  const structure = [flat.buildingId?.name, flat.wingId?.name, flat.floorId?.label]
    .filter(Boolean)
    .join(' · ');
  const relation = ownerships.map((ownership) => ownership.type.replace('_', ' ')).join(', ');
  return { structure, relation, occupancies };
}

export function PropertyScreen() {
  const { activeSociety, request, token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!activeSociety?.id) {
      setData(null);
      setError('');
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setData(null);
    setError('');
    setLoading(true);
    request(`/societies/${encodeURIComponent(activeSociety.id)}/my-property`, { token })
      .then((result) => {
        if (active) setData(result);
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
        title="My home"
        description="Your property links and resident profile for this society."
      />
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {loading ? <LoadingState label="Loading your property" /> : null}
      {!activeSociety && !loading ? (
        <Feedback>Select a society from Account before viewing your home.</Feedback>
      ) : null}
      {data?.resident?.profile ? (
        <Panel title="Resident profile">
          <Text style={styles.name}>{data.resident.profile.name}</Text>
          <Text style={styles.detail}>{data.resident.profile.email}</Text>
          {data.resident.profile.phone ? (
            <Text style={styles.detail}>{data.resident.profile.phone}</Text>
          ) : null}
          <Text style={styles.detail}>
            Membership status: {data.resident.status.replaceAll('_', ' ')}
          </Text>
        </Panel>
      ) : null}
      {data?.properties?.length ? (
        data.properties.map((property) => {
          const label = propertyLabel(property);
          return (
            <Panel key={String(property.flat._id)} title={`Flat ${property.flat.flatNumber}`}>
              {label.structure ? <Text style={styles.detail}>{label.structure}</Text> : null}
              {label.relation ? (
                <Text style={styles.detail}>Relationship: {label.relation}</Text>
              ) : null}
              <Text style={styles.detail}>
                {property.flat.area} {property.flat.areaUnit.replace('_', ' ')} ·{' '}
                {property.flat.propertyType}
              </Text>
              {label.occupancies.map((occupancy, index) => (
                <Text key={`${occupancy.residentType}-${index}`} style={styles.detail}>
                  {occupancy.residentType.replaceAll('_', ' ')} ·{' '}
                  {new Date(occupancy.startsAt).toLocaleDateString()}
                  {occupancy.endsAt ? ` – ${new Date(occupancy.endsAt).toLocaleDateString()}` : ''}
                </Text>
              ))}
              {property.parkingAssignments?.length ? (
                <View style={styles.group}>
                  <Text style={styles.sectionTitle}>Parking and vehicles</Text>
                  {property.parkingAssignments.map((assignment) => (
                    <Text key={String(assignment._id)} style={styles.detail}>
                      {assignment.parkingSlotId?.slotNumber ?? 'Parking'} ·{' '}
                      {assignment.vehicleId?.registrationNumber ?? 'Vehicle'}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Panel>
          );
        })
      ) : data ? (
        <Feedback>You do not have an active property link in this society.</Feedback>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing[2], marginTop: spacing[2] },
  name: {
    color: colors.text,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.semibold,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  detail: { color: colors.textMuted, fontSize: typography.fontSize.sm, lineHeight: 21 },
});
