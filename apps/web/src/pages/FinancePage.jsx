import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { usePlatformData } from '../platform/usePlatformData.js';

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function startOfYearInput() {
  return `${new Date().getFullYear()}-01-01`;
}

function currencyDigits(currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
}

function toMinorUnits(value, currency) {
  const digits = currencyDigits(currency);
  const normalized = String(value).trim();
  const match = normalized.match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > digits) {
    throw new Error(`Enter an amount with no more than ${digits} decimal places.`);
  }
  const scale = 10 ** digits;
  return Number(match[1]) * scale + Number((match[2] ?? '').padEnd(digits, '0') || 0);
}

function money(amountMinor, currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    (amountMinor ?? 0) / 10 ** currencyDigits(currency),
  );
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function dateIso(value) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function query(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.size ? `?${params}` : '';
}

export default function FinancePage() {
  const { activeSociety } = useAuth();
  const base = activeSociety?.id
    ? `/societies/${encodeURIComponent(activeSociety.id)}/finance`
    : null;
  const [from, setFrom] = useState(startOfYearInput());
  const [to, setTo] = useState(todayInput());
  const [importId, setImportId] = useState('');
  const [selectedJournals, setSelectedJournals] = useState({});
  const [selectedPayment, setSelectedPayment] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [selectedReversal, setSelectedReversal] = useState(null);
  const [reversalReason, setReversalReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const periodQuery = from && to ? query({ from: dateIso(from), to: dateIso(to) }) : '';
  const hasPeriod = Boolean(from && to);
  const reconPath = base ? `${base}/reconciliation/lines${query({ importId })}` : null;
  const gatewayResult = usePlatformData(base ? `${base}/gateway` : null);
  const { data: gateway, error: gatewayError, refresh: refreshGateway } = gatewayResult;
  const accountData = usePlatformData(base ? `${base}/accounts` : null);
  const { data: accountResult, error: accountsError, refresh: refreshAccounts } = accountData;
  const vendorData = usePlatformData(base ? `${base}/vendors` : null);
  const { data: vendorResult, error: vendorsError, refresh: refreshVendors } = vendorData;
  const expenseData = usePlatformData(base ? `${base}/expenses` : null);
  const { data: expenseResult, error: expensesError, refresh: refreshExpenses } = expenseData;
  const paymentData = usePlatformData(base ? `${base}/payments` : null);
  const { data: paymentResult, error: paymentsError, refresh: refreshPayments } = paymentData;
  const reportData = usePlatformData(
    base && hasPeriod ? `${base}/reports/summary${periodQuery}` : null,
  );
  const { data: report, error: reportError, refresh: refreshReport } = reportData;
  const journalData = usePlatformData(base && hasPeriod ? `${base}/journals${periodQuery}` : null);
  const { data: journalResult, error: journalsError, refresh: refreshJournals } = journalData;
  const reconciliationData = usePlatformData(reconPath);
  const {
    data: reconciliation,
    error: reconciliationError,
    refresh: refreshReconciliation,
  } = reconciliationData;

  const accounts = useMemo(() => accountResult?.accounts ?? [], [accountResult]);
  const vendors = vendorResult?.vendors ?? [];
  const expenses = expenseResult?.expenses ?? [];
  const payments = paymentResult?.payments ?? [];
  const journals = journalResult?.journals ?? [];
  const lines = reconciliation?.lines ?? [];
  const currency = report?.currency ?? 'INR';
  const loadingData = [
    gatewayResult.loading,
    accountData.loading,
    vendorData.loading,
    expenseData.loading,
    paymentData.loading,
    reportData.loading,
    journalData.loading,
    reconciliationData.loading,
  ].some(Boolean);
  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'expense' && account.active),
    [accounts],
  );
  const bankAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.type === 'asset' && account.reconciliationEnabled && account.active,
      ),
    [accounts],
  );
  const amountLabel = `Amount (${currency})`;

  async function refreshAll() {
    await Promise.all([
      refreshGateway(),
      refreshAccounts(),
      refreshVendors(),
      refreshExpenses(),
      refreshPayments(),
      refreshReport(),
      refreshJournals(),
      refreshReconciliation(),
    ]);
  }

  async function perform(action, message, refresh = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (refresh) await refreshAll();
      setNotice(message);
      return result;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function submitForm(event, path, makeBody, message) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    void perform(async () => {
      const data = await apiRequest(`${base}${path}`, {
        method: path === '/gateway' ? 'PUT' : 'POST',
        body: makeBody(values),
      });
      form.reset();
      return data;
    }, message);
  }

  function paymentColumns() {
    return [
      { key: 'createdAt', label: 'Date', render: (value) => dateTime(value) },
      { key: 'method', label: 'Method' },
      {
        key: 'amountMinor',
        label: 'Amount',
        render: (value, row) => money(value, row.currency ?? currency),
      },
      {
        key: 'status',
        label: 'Status',
        render: (value, row) => (
          <div className="finance-row-actions">
            <span className="status-badge status-badge--neutral">{value.replaceAll('_', ' ')}</span>
            {row.receiptId?.receiptNumber ? <span>{row.receiptId.receiptNumber}</span> : null}
          </div>
        ),
      },
      {
        key: 'actions',
        label: 'Refund',
        render: (_value, row) =>
          row.status === 'captured' ? (
            <Button
              onClick={() => {
                setSelectedPayment(row.id);
                setRefundAmount(
                  String(
                    (row.amountMinor - (row.refundedMinor ?? 0)) /
                      10 ** currencyDigits(row.currency ?? currency),
                  ),
                );
              }}
              type="button"
              variant="secondary"
            >
              Request refund
            </Button>
          ) : (
            '—'
          ),
      },
    ];
  }

  const paymentRows = payments.map((payment) => ({
    ...payment,
    actions: '',
    createdAt: payment.createdAt,
    method: payment.method,
  }));
  const accountColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Account' },
    { key: 'type', label: 'Type' },
    { key: 'normalBalance', label: 'Normal balance' },
  ];
  const expenseColumns = [
    { key: 'description', label: 'Expense' },
    { key: 'incurredAt', label: 'Incurred', render: (value) => dateTime(value) },
    {
      key: 'amountMinor',
      label: 'Amount',
      render: (value, row) => money(value, row.currency ?? currency),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value) => (
        <span className="status-badge status-badge--neutral">{value.replaceAll('_', ' ')}</span>
      ),
    },
    {
      key: 'actions',
      label: 'Action',
      render: (_value, row) => (
        <div className="finance-row-actions">
          {row.status === 'pending_approval' ? (
            <Button
              disabled={busy}
              onClick={() =>
                void perform(
                  () =>
                    apiRequest(`${base}/expenses/${encodeURIComponent(row._id)}/approve`, {
                      method: 'POST',
                      body: {},
                    }),
                  'Expense approval recorded.',
                )
              }
              type="button"
              variant="secondary"
            >
              Approve expense
            </Button>
          ) : null}
          {(row.vendorPayments ?? [])
            .filter((payment) => !payment.reversalJournalEntryId)
            .map((payment) => (
              <Button
                disabled={busy}
                key={payment._id}
                onClick={() =>
                  setSelectedReversal({
                    expenseId: row._id,
                    vendorPaymentId: payment._id,
                  })
                }
                type="button"
                variant="secondary"
              >
                Reverse {money(payment.amountMinor, row.currency ?? currency)} payment
              </Button>
            ))}
          {row.status === 'posted' && (row.paidMinor ?? 0) === 0 ? (
            <Button
              disabled={busy}
              onClick={() => setSelectedReversal({ expenseId: row._id })}
              type="button"
              variant="secondary"
            >
              Reverse expense
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  const journalColumns = [
    { key: 'entryNumber', label: 'Entry' },
    { key: 'entryDate', label: 'Date', render: (value) => dateTime(value) },
    { key: 'description', label: 'Description' },
    {
      key: 'debitTotalMinor',
      label: 'Debit',
      render: (value) => money(value, currency),
    },
    {
      key: 'creditTotalMinor',
      label: 'Credit',
      render: (value) => money(value, currency),
    },
  ];

  async function requestRefund(event) {
    event.preventDefault();
    if (!selectedPayment) return;
    let amountMinor;
    try {
      amountMinor = toMinorUnits(refundAmount, currency);
    } catch (requestError) {
      setError(requestError.message);
      return;
    }
    const result = await perform(
      () =>
        apiRequest(`${base}/payments/${encodeURIComponent(selectedPayment)}/refunds`, {
          method: 'POST',
          body: { amountMinor, reason: refundReason },
        }),
      'Refund request submitted for approval.',
    );
    if (result) {
      setSelectedPayment('');
      setRefundAmount('');
      setRefundReason('');
    }
  }

  async function approveRefund(paymentId, refundId) {
    await perform(
      () =>
        apiRequest(
          `${base}/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}/approve`,
          { method: 'POST', body: {} },
        ),
      'Refund approval recorded. Provider outcome will be confirmed by callback.',
    );
  }

  async function submitReversal(event) {
    event.preventDefault();
    if (!selectedReversal) return;
    const path = selectedReversal.vendorPaymentId
      ? `/expenses/${encodeURIComponent(selectedReversal.expenseId)}/payments/${encodeURIComponent(selectedReversal.vendorPaymentId)}/reverse`
      : `/expenses/${encodeURIComponent(selectedReversal.expenseId)}/reverse`;
    const result = await perform(
      () =>
        apiRequest(`${base}${path}`, {
          method: 'POST',
          body: { reason: reversalReason },
        }),
      'Reversal posted and linked to its original journal entry.',
    );
    if (result) {
      setSelectedReversal(null);
      setReversalReason('');
    }
  }

  async function importStatement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const result = await perform(
      () =>
        apiRequest(`${base}/reconciliation/import`, {
          method: 'POST',
          body: {
            accountId: values.accountId,
            sourceName: values.sourceName,
            csv: values.csv,
            mapping: {
              date: values.dateColumn,
              description: values.descriptionColumn,
              reference: values.referenceColumn,
              debit: values.debitColumn,
              credit: values.creditColumn,
              balance: values.balanceColumn,
            },
          },
        }),
      'Bank statement imported. Review each row before matching it to a ledger entry.',
      false,
    );
    if (result?.statement?._id) {
      setImportId(result.statement._id);
      setSelectedJournals({});
      await refreshReconciliation();
      form.reset();
    }
  }

  async function matchLine(line) {
    const journalEntryId = selectedJournals[line._id];
    if (!journalEntryId) return;
    await perform(
      () =>
        apiRequest(`${base}/reconciliation/lines/${encodeURIComponent(line._id)}/match`, {
          method: 'POST',
          body: { journalEntryId },
        }),
      'Statement line matched to a journal entry.',
    );
  }

  const reconciliationSummary = reconciliation?.summary;
  const errors = [
    gatewayError,
    accountsError,
    vendorsError,
    expensesError,
    paymentsError,
    reportError,
    journalsError,
    reconciliationError,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Society finance</p>
          <h1>Payments and accounting</h1>
          <p>
            Manage your society&apos;s own Razorpay account, expenses, ledger and bank
            reconciliation.
          </p>
        </div>
      </header>
      {error || errors ? <Alert tone="danger">{error || errors}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!base ? <Alert>Select a society to manage its finances.</Alert> : null}
      {busy ? <LoadingState label="Saving finance changes" /> : null}
      {!busy && loadingData ? <LoadingState label="Loading society finance" /> : null}

      <Card title="Financial summary">
        <div className="finance-toolbar">
          <FormField
            id="report-from"
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <FormField
            id="report-to"
            label="To"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button
            disabled={busy || !hasPeriod}
            onClick={() => void refreshReport()}
            type="button"
            variant="secondary"
          >
            Refresh report
          </Button>
        </div>
        {report ? (
          <>
            <p className="finance-currency">
              Reporting currency: <strong>{report.currency}</strong>
            </p>
            <div className="finance-summary-grid">
              {[
                ['Issued bills', report.billIssuedMinor],
                ['Collections', report.collectedMinor],
                ['Refunds', report.refundedMinor],
                ['Net collections', report.netCollectionsMinor],
                ['Posted expenses', report.expensesPostedMinor],
                ['Outstanding dues', report.duesMinor],
              ].map(([label, amount]) => (
                <div className="finance-summary-item" key={label}>
                  <span>{label}</span>
                  <strong>{money(amount, report.currency)}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Report data will appear when finance records exist for this period.
          </p>
        )}
      </Card>

      <div className="finance-grid">
        <Card title="Razorpay gateway">
          <p className="muted">
            Credentials apply only to this society&apos;s Razorpay merchant account. Secret values
            are write-only and encrypted by the backend.
          </p>
          <p>
            Status: <strong>{gateway?.configured ? 'Configured' : 'Not configured'}</strong>
          </p>
          {gateway?.keyId ? <p>Key ID: {gateway.keyId}</p> : null}
          {gateway?.webhookUrl ? (
            <p className="finance-webhook">Webhook endpoint: {gateway.webhookUrl}</p>
          ) : null}
          <form
            className="finance-form"
            onSubmit={(event) =>
              submitForm(
                event,
                '/gateway',
                (values) => ({
                  keyId: values.keyId,
                  keySecret: values.keySecret,
                  webhookSecret: values.webhookSecret,
                }),
                'Razorpay credentials saved securely.',
              )
            }
          >
            <FormField
              autoComplete="off"
              id="gateway-key-id"
              label="Razorpay key ID"
              name="keyId"
              required
            />
            <FormField
              autoComplete="new-password"
              id="gateway-key-secret"
              label="Razorpay key secret"
              name="keySecret"
              required
              type="password"
            />
            <FormField
              autoComplete="new-password"
              id="gateway-webhook-secret"
              label="Webhook signing secret"
              name="webhookSecret"
              required
              type="password"
            />
            <Button disabled={busy} type="submit">
              Save credentials
            </Button>
          </form>
        </Card>

        <Card title="Add vendor">
          <form
            className="finance-form"
            onSubmit={(event) =>
              submitForm(
                event,
                '/vendors',
                (values) => ({
                  name: values.name,
                  contactName: values.contactName || null,
                  email: values.email || null,
                  phone: values.phone || null,
                  taxIdentifier: values.taxIdentifier || null,
                }),
                'Vendor added.',
              )
            }
          >
            <FormField id="vendor-name" label="Vendor name" name="name" required />
            <FormField id="vendor-contact" label="Contact name" name="contactName" />
            <FormField id="vendor-email" label="Email" name="email" type="email" />
            <FormField id="vendor-phone" label="Phone" name="phone" type="tel" />
            <FormField id="vendor-tax" label="Tax identifier" name="taxIdentifier" />
            <Button disabled={busy} type="submit">
              Add vendor
            </Button>
          </form>
        </Card>
      </div>

      <Card title="Record an expense">
        {!vendors.length || !expenseAccounts.length ? (
          <p className="muted">
            Add a vendor and ensure an expense account exists before recording expenses.
          </p>
        ) : null}
        <form
          className="finance-form finance-form--wide"
          onSubmit={(event) =>
            submitForm(
              event,
              '/expenses',
              (values) => ({
                vendorId: values.vendorId,
                expenseAccountId: values.expenseAccountId,
                amountMinor: toMinorUnits(values.amount, currency),
                currency,
                incurredAt: dateIso(values.incurredAt),
                description: values.description,
                reference: values.reference || null,
                supportingDocument: values.supportingDocument || null,
              }),
              'Expense submitted for approval. Posting follows the configured approval policy.',
            )
          }
        >
          <label className="form-field">
            <span className="form-field__label">Vendor</span>
            <select className="form-control" name="vendorId" required>
              <option value="">Select vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor._id} value={vendor._id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-field__label">Expense account</span>
            <select className="form-control" name="expenseAccountId" required>
              <option value="">Select account</option>
              {expenseAccounts.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
          <FormField
            id="expense-amount"
            label={amountLabel}
            name="amount"
            min="0.01"
            required
            step="0.01"
            type="number"
          />
          <FormField
            id="expense-date"
            label="Incurred on"
            name="incurredAt"
            required
            type="date"
            defaultValue={todayInput()}
          />
          <FormField id="expense-description" label="Description" name="description" required />
          <FormField id="expense-reference" label="Invoice/reference" name="reference" />
          <FormField
            id="expense-document"
            hint="Private file upload/storage is not configured; enter an authorized document reference only."
            label="Supporting document reference"
            name="supportingDocument"
          />
          <Button disabled={busy || !vendors.length || !expenseAccounts.length} type="submit">
            Submit expense
          </Button>
        </form>
        {selectedReversal ? (
          <form className="finance-refund-form" onSubmit={(event) => void submitReversal(event)}>
            <FormField
              as="textarea"
              id="finance-reversal-reason"
              label="Reason for reversal"
              onChange={(event) => setReversalReason(event.target.value)}
              required
              value={reversalReason}
            />
            <div className="finance-row-actions">
              <Button disabled={busy} type="submit">
                Post reversal
              </Button>
              <Button
                onClick={() => {
                  setSelectedReversal(null);
                  setReversalReason('');
                }}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        <DataTable
          caption="Society expenses"
          columns={expenseColumns}
          emptyMessage="No expenses recorded."
          rows={expenses.map((expense) => ({ ...expense, actions: '' }))}
        />
      </Card>

      <Card title="Payment collection and refunds">
        <p className="muted">
          Provider callbacks determine online payment status. Refund requests require Society Admin
          approval.
        </p>
        {selectedPayment ? (
          <form
            className="finance-form finance-refund-form"
            onSubmit={(event) => void requestRefund(event)}
          >
            <FormField
              id="refund-amount"
              label={`Refund amount (${currency})`}
              min="0.01"
              onChange={(event) => setRefundAmount(event.target.value)}
              required
              step="0.01"
              type="number"
              value={refundAmount}
            />
            <FormField
              id="refund-reason"
              label="Reason"
              onChange={(event) => setRefundReason(event.target.value)}
              required
              value={refundReason}
            />
            <Button disabled={busy} type="submit">
              Submit refund request
            </Button>
            <Button onClick={() => setSelectedPayment('')} type="button" variant="secondary">
              Cancel
            </Button>
          </form>
        ) : null}
        <DataTable
          caption="Society payment history"
          columns={paymentColumns()}
          rows={paymentRows}
          emptyMessage="No payments recorded."
        />
        {payments.some((payment) =>
          payment.refunds?.some((refund) => refund.status === 'pending'),
        ) ? (
          <div className="finance-refund-list">
            {payments.flatMap((payment) =>
              (payment.refunds ?? [])
                .filter((refund) => refund.status === 'pending')
                .map((refund) => (
                  <div className="finance-inline" key={`${payment.id}-${refund._id}`}>
                    <span>
                      Refund {money(refund.amountMinor, payment.currency)} · {refund.reason}
                    </span>
                    <Button
                      disabled={busy}
                      onClick={() => void approveRefund(payment.id, refund._id)}
                      type="button"
                    >
                      Approve refund
                    </Button>
                  </div>
                )),
            )}
          </div>
        ) : null}
      </Card>

      <Card title="Chart of accounts">
        <form
          className="finance-form finance-form--wide"
          onSubmit={(event) =>
            submitForm(
              event,
              '/accounts',
              (values) => ({
                code: values.code,
                name: values.name,
                type: values.type,
                reconciliationEnabled: values.reconciliationEnabled === 'on',
              }),
              'Account added to the society chart.',
            )
          }
        >
          <FormField id="account-code" label="Code" name="code" required />
          <FormField id="account-name" label="Account name" name="name" required />
          <label className="form-field">
            <span className="form-field__label">Account type</span>
            <select className="form-control" name="type" required>
              {['asset', 'liability', 'equity', 'income', 'expense'].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-checkbox">
            <input name="reconciliationEnabled" type="checkbox" />
            Enable bank reconciliation for this account
          </label>
          <Button disabled={busy} type="submit">
            Add account
          </Button>
        </form>
        <DataTable
          caption="Chart of accounts"
          columns={accountColumns}
          rows={accounts}
          emptyMessage="No accounts configured."
        />
      </Card>

      <Card title="Vendor payments">
        <p className="muted">
          Approved expenses post to accounts payable. Record payment separately; posted transactions
          are corrected by reversal, not deletion.
        </p>
        {expenses
          .filter((expense) => ['posted', 'partially_paid'].includes(expense.status))
          .map((expense) => {
            const due = expense.amountMinor - (expense.paidMinor ?? 0);
            return (
              <VendorPaymentForm
                busy={busy}
                currency={expense.currency ?? currency}
                expense={expense}
                key={expense._id}
                onSubmit={(body) =>
                  perform(
                    () =>
                      apiRequest(`${base}/expenses/${encodeURIComponent(expense._id)}/payments`, {
                        method: 'POST',
                        body,
                      }),
                    'Vendor payment recorded and posted to the ledger.',
                  )
                }
                dueMinor={due}
              />
            );
          })}
        {!expenses.some((expense) => ['posted', 'partially_paid'].includes(expense.status)) ? (
          <p className="muted">No approved expenses have an outstanding payable.</p>
        ) : null}
      </Card>

      <Card title="Bank settlement and CSV reconciliation">
        <form
          className="finance-form finance-form--wide"
          onSubmit={(event) =>
            submitForm(
              event,
              '/settlements',
              (values) => ({
                bankAccountId: values.bankAccountId,
                reference: values.reference,
                amountMinor: toMinorUnits(values.amount, currency),
                settledAt: dateIso(values.settledAt),
              }),
              'Gateway settlement recorded and posted to the ledger.',
            )
          }
        >
          <label className="form-field">
            <span className="form-field__label">Bank account</span>
            <select className="form-control" name="bankAccountId" required>
              <option value="">Select bank account</option>
              {bankAccounts.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
          <FormField
            id="settlement-reference"
            label="Settlement reference"
            name="reference"
            required
          />
          <FormField
            id="settlement-amount"
            label={amountLabel}
            min="0.01"
            name="amount"
            required
            step="0.01"
            type="number"
          />
          <FormField
            id="settlement-date"
            label="Settled on"
            name="settledAt"
            required
            type="date"
            defaultValue={todayInput()}
          />
          <Button disabled={busy || !bankAccounts.length} type="submit">
            Record settlement
          </Button>
        </form>
        <form
          className="finance-form finance-form--wide"
          onSubmit={(event) => void importStatement(event)}
        >
          <label className="form-field">
            <span className="form-field__label">Bank account for statement</span>
            <select className="form-control" name="accountId" required>
              <option value="">Select bank account</option>
              {bankAccounts.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
          <FormField
            id="statement-source"
            label="Statement source name"
            name="sourceName"
            required
          />
          {[
            ['dateColumn', 'Date column', 'Date'],
            ['descriptionColumn', 'Description column', 'Description'],
            ['referenceColumn', 'Reference column', 'Reference'],
            ['debitColumn', 'Debit column', 'Debit'],
            ['creditColumn', 'Credit column', 'Credit'],
            ['balanceColumn', 'Balance column', 'Balance'],
          ].map(([name, label, value]) => (
            <FormField
              defaultValue={value}
              id={`statement-${name}`}
              key={name}
              label={label}
              name={name}
              required
            />
          ))}
          <FormField
            as="textarea"
            hint="CSV is processed by the tenant-scoped backend and not uploaded to third-party services."
            id="statement-csv"
            label="Statement CSV"
            name="csv"
            required
            rows={7}
          />
          <Button disabled={busy || !bankAccounts.length} type="submit">
            Import statement
          </Button>
        </form>
        <div className="finance-reconciliation">
          <div className="finance-inline">
            <h3>Imported statement rows</h3>
            <span>
              {reconciliationSummary?.matchedCount ?? 0} matched /{' '}
              {reconciliationSummary?.transactionCount ?? 0} total
            </span>
          </div>
          {!lines.length ? <p className="muted">No statement rows imported.</p> : null}
          {lines.map((line) => {
            const expectedSide = line.creditMinor > 0 ? 'debit' : 'credit';
            const expectedAmount = line.creditMinor || line.debitMinor;
            const candidateJournals = journals.filter((journal) =>
              journal.lineSnapshots?.some(
                (entryLine) =>
                  String(entryLine.accountId) === String(line.accountId) &&
                  entryLine.side === expectedSide &&
                  entryLine.amountMinor === expectedAmount,
              ),
            );
            return (
              <div className="finance-reconcile-row" key={line._id}>
                <span>
                  {dateTime(line.transactionDate)} · {line.description} ·{' '}
                  {money(expectedAmount, currency)}
                  {line.matchedJournalEntryId ? ' · Matched' : ''}
                </span>
                {!line.matchedJournalEntryId ? (
                  <div className="finance-inline">
                    <select
                      aria-label={`Journal entry for ${line.description}`}
                      className="form-control"
                      onChange={(event) =>
                        setSelectedJournals((current) => ({
                          ...current,
                          [line._id]: event.target.value,
                        }))
                      }
                      value={selectedJournals[line._id] ?? ''}
                    >
                      <option value="">Select matching journal</option>
                      {candidateJournals.map((journal) => (
                        <option key={journal._id} value={journal._id}>
                          {journal.entryNumber} · {journal.description}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={busy || !selectedJournals[line._id]}
                      onClick={() => void matchLine(line)}
                      type="button"
                    >
                      Match
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Journal entries">
        <DataTable
          caption="Journal entries for selected date range"
          columns={journalColumns}
          emptyMessage="No journal entries in this period."
          rows={journals}
        />
      </Card>
    </div>
  );
}

function VendorPaymentForm({ busy, currency, dueMinor, expense, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="finance-vendor-payment"
      onSubmit={async (event) => {
        event.preventDefault();
        let amountMinor;
        try {
          amountMinor = toMinorUnits(amount, currency);
        } catch (requestError) {
          setError(requestError.message);
          return;
        }
        setError('');
        const result = await onSubmit({ amountMinor, method, reference: reference || null });
        if (result) {
          setAmount('');
          setReference('');
        }
      }}
    >
      <div>
        <strong>{expense.description}</strong>
        <span className="muted">Outstanding: {money(dueMinor, currency)}</span>
      </div>
      <FormField
        id={`vendor-payment-${expense._id}`}
        label={`Payment amount (${currency})`}
        min="0.01"
        onChange={(event) => setAmount(event.target.value)}
        required
        step="0.01"
        type="number"
        value={amount}
      />
      <label className="form-field">
        <span className="form-field__label">Method</span>
        <select
          className="form-control"
          onChange={(event) => setMethod(event.target.value)}
          value={method}
        >
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
      </label>
      <FormField
        id={`vendor-reference-${expense._id}`}
        label="Reference"
        onChange={(event) => setReference(event.target.value)}
        value={reference}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button disabled={busy} type="submit">
        Record payment
      </Button>
    </form>
  );
}
