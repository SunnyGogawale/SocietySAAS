import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback, LoadingState } from '../components/Feedback';
import { Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ScreenHeading } from '../components/ScreenHeading';

const { colors, spacing, typography } = designTokens;

function currency(amountMinor, currencyCode) {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).format(
    (amountMinor ?? 0) / 10 ** digits,
  );
}

function dateLabel(value) {
  return new Date(value).toLocaleDateString();
}

export function BillingScreen() {
  const { activeSociety, request, token } = useAuth();
  const [bills, setBills] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [selectedBill, setSelectedBill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!activeSociety?.id) {
      setBills([]);
      setReminders([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const base = `/societies/${encodeURIComponent(activeSociety.id)}/billing`;
      const [billResult, reminderResult] = await Promise.all([
        request(`${base}/bills?limit=100`, { token }),
        request(`${base}/reminders`, { token }),
      ]);
      setBills(billResult.bills ?? []);
      setReminders(reminderResult.reminders ?? []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [activeSociety?.id, request, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function showBill(billId) {
    if (selectedBill?.id === billId) {
      setSelectedBill(null);
      return;
    }
    setError('');
    try {
      const result = await request(
        `/societies/${encodeURIComponent(activeSociety.id)}/billing/bills/${encodeURIComponent(billId)}`,
        { token },
      );
      setSelectedBill(result);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function markReminderRead(reminderId) {
    setError('');
    try {
      await request(
        `/societies/${encodeURIComponent(activeSociety.id)}/billing/reminders/${encodeURIComponent(reminderId)}/read`,
        { method: 'POST', body: {}, token },
      );
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <Screen>
      <ScreenHeading
        title="Maintenance bills"
        description="Issued bills, itemized charges, outstanding balances, payment history, and in-app reminders."
      />
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {!activeSociety ? <Feedback>Select a society to view bills.</Feedback> : null}
      {loading ? <LoadingState label="Loading your bills" /> : null}
      {reminders.length ? (
        <Panel title="Billing reminders">
          {reminders.map((reminder) => (
            <View key={String(reminder._id)} style={styles.reminder}>
              <Text style={styles.detail}>
                {reminder.kind.replaceAll('_', ' ')} · {dateLabel(reminder.createdAt)}
              </Text>
              {!reminder.readAt ? (
                <ActionButton
                  onPress={() => void markReminderRead(String(reminder._id))}
                  variant="secondary"
                >
                  Mark read
                </ActionButton>
              ) : (
                <Text style={styles.readLabel}>Read</Text>
              )}
            </View>
          ))}
        </Panel>
      ) : null}
      {!loading && activeSociety && bills.length === 0 ? (
        <Feedback>No issued bills are linked to your active home.</Feedback>
      ) : null}
      {bills.map((bill) => (
        <Panel key={bill.id} title={bill.invoiceNumber ?? 'Maintenance bill'}>
          <Text style={styles.detail}>
            Period: {dateLabel(bill.periodStart)} – {dateLabel(bill.periodEnd)}
          </Text>
          <Text style={styles.detail}>Due: {dateLabel(bill.dueDate)}</Text>
          <Text style={styles.detail}>
            Total: {currency(bill.totalMinor, bill.currency)} · Outstanding:{' '}
            {currency(bill.outstandingMinor, bill.currency)}
          </Text>
          <Text style={styles.status}>Status: {bill.status.replaceAll('_', ' ')}</Text>
          <ActionButton onPress={() => void showBill(bill.id)} variant="secondary">
            {selectedBill?.id === bill.id ? 'Hide bill details' : 'View itemized bill'}
          </ActionButton>
          {selectedBill?.id === bill.id ? (
            <View style={styles.details}>
              <Text style={styles.sectionTitle}>Charges</Text>
              {selectedBill.items.map((item) => (
                <Text key={String(item._id)} style={styles.detail}>
                  {item.description}: {item.discount ? '−' : ''}
                  {currency(item.amountMinor, selectedBill.currency)}
                </Text>
              ))}
              <Text style={styles.detail}>
                Flat account outstanding:{' '}
                {currency(selectedBill.accountOutstandingMinor, selectedBill.currency)}
              </Text>
              <Text style={styles.sectionTitle}>Payment history</Text>
              {selectedBill.payments.length ? (
                selectedBill.payments.map((payment) => (
                  <Text key={payment.id} style={styles.detail}>
                    {payment.receiptNumber} · {dateLabel(payment.receivedAt)} ·{' '}
                    {currency(payment.allocatedMinor, payment.currency ?? selectedBill.currency)}
                  </Text>
                ))
              ) : (
                <Text style={styles.detail}>No payments have been allocated to this bill.</Text>
              )}
              {selectedBill.notes?.length ? (
                <>
                  <Text style={styles.sectionTitle}>Adjustments</Text>
                  {selectedBill.notes.map((note) => (
                    <Text key={String(note._id)} style={styles.detail}>
                      {note.direction} · {note.reason} · {note.status}
                    </Text>
                  ))}
                </>
              ) : null}
            </View>
          ) : null}
        </Panel>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  details: { gap: spacing[2], marginTop: spacing[2] },
  detail: { color: colors.textMuted, fontSize: typography.fontSize.sm, lineHeight: 21 },
  readLabel: { color: colors.success, fontSize: typography.fontSize.sm },
  reminder: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  status: {
    color: colors.navy700,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
});
