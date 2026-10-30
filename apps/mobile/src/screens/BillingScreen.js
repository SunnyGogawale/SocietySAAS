import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import designTokens from '@societysaas/design-tokens';
import { useAuth } from '../auth/AuthContext';
import { ActionButton } from '../components/ActionButton';
import { Feedback, LoadingState } from '../components/Feedback';
import { FormField } from '../components/FormField';
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

function amountMinor(value, currencyCode) {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits;
  const match = String(value)
    .trim()
    .match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > digits) {
    throw new Error(`Enter an amount with no more than ${digits} decimal places.`);
  }
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? '').padEnd(digits, '0') || 0);
}

function amountLabel(amount, currencyCode) {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits;
  return (amount / 10 ** digits).toFixed(digits);
}

export function BillingScreen() {
  const { activeSociety, request, token } = useAuth();
  const [bills, setBills] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentAmounts, setPaymentAmounts] = useState({});
  const [notice, setNotice] = useState('');
  const [selectedBill, setSelectedBill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!activeSociety?.id) {
      setBills([]);
      setReminders([]);
      setPayments([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const base = `/societies/${encodeURIComponent(activeSociety.id)}/billing`;
      const [billResult, reminderResult, paymentResult] = await Promise.all([
        request(`${base}/bills?limit=100`, { token }),
        request(`${base}/reminders`, { token }),
        request(`/societies/${encodeURIComponent(activeSociety.id)}/finance/payments`, {
          token,
        }),
      ]);
      setBills(billResult.bills ?? []);
      setReminders(reminderResult.reminders ?? []);
      setPayments(paymentResult.payments ?? []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [activeSociety?.id, request, token]);

  async function payBill(bill) {
    setError('');
    setNotice('');
    try {
      const currencyCode = bill.currency;
      const amount = amountMinor(
        paymentAmounts[bill.id] ?? amountLabel(bill.outstandingMinor, currencyCode),
        currencyCode,
      );
      if (amount > bill.outstandingMinor) {
        throw new Error('Payment cannot exceed the outstanding bill balance.');
      }
      const result = await request(
        `/societies/${encodeURIComponent(activeSociety.id)}/finance/payments`,
        {
          method: 'POST',
          body: {
            billId: bill.id,
            amountMinor: amount,
            idempotencyKey: `mobile-${bill.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          },
          token,
        },
      );
      await Linking.openURL(result.shortUrl);
      setNotice(
        'Secure Razorpay checkout opened. Payment status updates after provider confirmation.',
      );
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

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
      {notice ? <Feedback>{notice}</Feedback> : null}
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
          {bill.outstandingMinor > 0 ? (
            <View style={styles.payment}>
              <FormField
                label={`Payment amount (${bill.currency})`}
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  setPaymentAmounts((current) => ({ ...current, [bill.id]: value }))
                }
                value={paymentAmounts[bill.id] ?? amountLabel(bill.outstandingMinor, bill.currency)}
              />
              <ActionButton onPress={() => void payBill(bill)}>Pay online</ActionButton>
            </View>
          ) : null}
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
      <Panel title="Payment history and receipts">
        {payments.length ? (
          payments.map((payment) => (
            <View key={payment.id} style={styles.paymentHistory}>
              <Text style={styles.detail}>
                {dateLabel(payment.createdAt)} · {payment.method.replaceAll('_', ' ')} ·{' '}
                {currency(payment.amountMinor, payment.currency)}
              </Text>
              <Text style={styles.status}>Status: {payment.status.replaceAll('_', ' ')}</Text>
              {payment.receiptId?.receiptNumber ? (
                <Text style={styles.detail}>
                  Receipt {payment.receiptId.receiptNumber} ·{' '}
                  {dateLabel(payment.receiptId.receivedAt)}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.detail}>No payments or receipts are recorded yet.</Text>
        )}
      </Panel>
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
  payment: { gap: spacing[3], marginTop: spacing[3] },
  paymentHistory: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    paddingVertical: spacing[2],
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
