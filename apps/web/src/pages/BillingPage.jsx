import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiRequest, downloadPdf } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { usePlatformData } from '../platform/usePlatformData.js';

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function money(amount, currency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    (amount ?? 0) / 10 ** digits,
  );
}

function query(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.size ? `?${params}` : '';
}

export default function BillingPage() {
  const { activeSociety } = useAuth();
  const societyPath = activeSociety?.id
    ? `/societies/${encodeURIComponent(activeSociety.id)}/billing`
    : null;
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [billStatus, setBillStatus] = useState('');
  const [selectedBillId, setSelectedBillId] = useState('');
  const [importJson, setImportJson] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previewRun, setPreviewRun] = useState(null);
  const [manualBill, setManualBill] = useState(null);

  const billsPath = societyPath
    ? `${societyPath}/bills${query({ status: billStatus, limit: 100 })}`
    : null;
  const {
    data: billResult,
    error: billsError,
    loading: billsLoading,
    refresh: refreshBills,
  } = usePlatformData(billsPath);
  const { data: runsResult, refresh: refreshRuns } = usePlatformData(
    societyPath ? `${societyPath}/runs` : null,
  );
  const { data: propertiesResult } = usePlatformData(
    activeSociety?.id
      ? `/societies/${encodeURIComponent(activeSociety.id)}/properties?limit=100`
      : null,
  );
  const { data: ageing, refresh: refreshAgeing } = usePlatformData(
    societyPath ? `${societyPath}/ageing` : null,
  );
  const billDetailPath =
    societyPath && selectedBillId
      ? `${societyPath}/bills/${encodeURIComponent(selectedBillId)}`
      : null;
  const { data: billDetail, refresh: refreshBillDetail } = usePlatformData(billDetailPath);
  const bills = billResult?.bills ?? [];
  const properties = useMemo(() => propertiesResult?.properties ?? [], [propertiesResult]);
  const flatOptions = useMemo(
    () =>
      properties.map((property) => ({
        id: property.id,
        label: `${property.flatNumber} · ${property.building?.name ?? ''}`,
        owners: property.owners ?? [],
      })),
    [properties],
  );
  const ownerOptions = useMemo(
    () =>
      flatOptions.flatMap((flat) =>
        flat.owners.map((owner) => ({
          membershipId: owner.membershipId,
          name: `${owner.name} · ${flat.label}`,
          flatId: flat.id,
        })),
      ),
    [flatOptions],
  );
  const selectedBill = bills.find((bill) => bill.id === selectedBillId) ?? manualBill;
  const dataError = [billsError].filter(Boolean).join(' ');

  async function perform(action, message, refresh = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (refresh)
        await Promise.all([refreshBills(), refreshRuns(), refreshAgeing(), refreshBillDetail()]);
      setNotice(message);
      return result;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitRecurring(event) {
    event.preventDefault();
    const result = await perform(async () => {
      const data = await apiRequest(`${societyPath}/runs/preview`, {
        method: 'POST',
        body: { periodStart, periodEnd },
      });
      setPreviewRun(data);
      return data;
    }, 'Billing preview created. Review totals and skipped flats before approval.');
    if (result) setPreviewRun(result);
  }

  async function transitionRun(action) {
    const runId = previewRun?.run?._id ?? previewRun?.run?.id;
    if (!runId) return;
    const result = await perform(
      async () =>
        apiRequest(`${societyPath}/runs/${encodeURIComponent(runId)}/${action}`, {
          method: 'POST',
          body: {},
        }),
      `Billing run ${action}d.`,
    );
    if (result?.run) {
      setPreviewRun((current) => ({ ...current, run: result.run }));
    }
  }

  function submitStandalone(event, source) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const body = {
      flatId: values.flatId,
      amountMinor: Number(values.amountMinor),
      description: values.description,
      reason: values.reason,
      dueDate: values.dueDate,
      ...(source === 'opening-balances' ? { sourceReference: values.sourceReference } : {}),
    };
    void perform(
      async () => {
        const result = await apiRequest(`${societyPath}/${source}`, { method: 'POST', body });
        setManualBill(result.bill);
        setSelectedBillId(result.bill.id);
        form.reset();
        return result;
      },
      `${source === 'ad-hoc' ? 'Ad hoc charge' : 'Opening balance'} added as a draft bill.`,
    );
  }

  async function importOpeningBalances(event) {
    event.preventDefault();
    let body;
    try {
      body = JSON.parse(importJson);
    } catch {
      setError('Enter valid JSON for the opening-balance reconciliation.');
      return;
    }
    await perform(
      () => apiRequest(`${societyPath}/opening-balances/import`, { method: 'POST', body }),
      'Opening balances imported as draft bills after source reconciliation.',
    );
  }

  async function billAction(action, billId = selectedBillId, bill = selectedBill) {
    if (!billId || !bill) return;
    if (action === 'cancel') {
      const reason = document.getElementById('bill-action-reason')?.value?.trim();
      if (!reason) {
        setError('Enter a cancellation reason.');
        return;
      }
      await perform(
        () =>
          apiRequest(`${societyPath}/bills/${billId}/cancel`, {
            method: 'POST',
            body: { reason },
          }),
        'Bill cancelled. A revision can now be created.',
      );
      return;
    }
    if (action === 'revise') {
      const reason = document.getElementById('bill-action-reason')?.value?.trim();
      if (!reason) {
        setError('Enter a revision reason.');
        return;
      }
      const result = await perform(
        () =>
          apiRequest(`${societyPath}/bills/${billId}/revisions`, {
            method: 'POST',
            body: { reason },
          }),
        'Revision created as a new draft; the cancelled bill remains unchanged.',
      );
      if (result?.bill) {
        setManualBill(result.bill);
        setSelectedBillId(result.bill.id);
      }
      return;
    }
    await perform(
      () =>
        apiRequest(`${societyPath}/bills/${billId}/${action}`, {
          method: 'POST',
          body: {},
        }),
      `Bill ${action}d.`,
    );
  }

  async function createAdjustment(event) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    if (!values.billId) {
      setError('Select an issued bill for the adjustment.');
      return;
    }
    const result = await perform(
      () =>
        apiRequest(`${societyPath}/bills/${values.billId}/adjustments`, {
          method: 'POST',
          body: {
            direction: values.direction,
            category: values.category,
            amountMinor: Number(values.amountMinor),
            reason: values.reason,
          },
        }),
      'Adjustment created and awaiting Society Admin approval.',
    );
    if (result?.adjustment) {
      setNotice('Adjustment created. Approve then issue it in the adjustment workflow.');
    }
  }

  async function recordReceipt(event) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const payer = ownerOptions.find((owner) => owner.membershipId === values.payerMembershipId);
    if (!payer || payer.flatId !== values.flatId) {
      setError('Choose an active owner linked to the selected flat.');
      return;
    }
    await perform(
      () =>
        apiRequest(`${societyPath}/receipts`, {
          method: 'POST',
          body: {
            flatId: values.flatId,
            payerMembershipId: values.payerMembershipId,
            amountMinor: Number(values.amountMinor),
            method: values.method,
            reference: values.reference || null,
          },
        }),
      'Receipt recorded and allocated to the oldest outstanding bills first.',
    );
  }

  const billColumns = [
    { key: 'invoiceNumber', label: 'Invoice' },
    {
      key: 'flat',
      label: 'Flat',
      render: (flat) => flat?.flatNumber ?? '—',
    },
    {
      key: 'periodStart',
      label: 'Period',
      render: (_, bill) =>
        `${new Date(bill.periodStart).toLocaleDateString()} – ${new Date(bill.periodEnd).toLocaleDateString()}`,
    },
    {
      key: 'totalMinor',
      label: 'Total / outstanding',
      render: (_, bill) =>
        `${money(bill.totalMinor, bill.currency)} / ${money(bill.outstandingMinor, bill.currency)}`,
    },
    { key: 'dueDate', label: 'Due', render: (value) => new Date(value).toLocaleDateString() },
    {
      key: 'status',
      label: 'Status',
      render: (status) => <StatusBadge status={status} />,
    },
    {
      key: 'id',
      label: 'Actions',
      render: (id, bill) => (
        <div className="platform-form__actions">
          <Button onClick={() => setSelectedBillId(id)} type="button" variant="secondary">
            Details
          </Button>
          {bill.status === 'draft' || bill.status === 'in_review' || bill.status === 'approved' ? (
            <Button
              disabled={busy}
              onClick={() => {
                setSelectedBillId(id);
                void billAction(
                  bill.status === 'draft'
                    ? 'review'
                    : bill.status === 'in_review'
                      ? 'approve'
                      : 'issue',
                  id,
                  bill,
                );
              }}
              type="button"
            >
              {bill.status === 'draft'
                ? 'Review'
                : bill.status === 'in_review'
                  ? 'Approve'
                  : 'Issue'}
            </Button>
          ) : null}
          {bill.status === 'issued' ? (
            <Button
              onClick={() =>
                void perform(
                  () => downloadPdf(`${societyPath}/bills/${id}/pdf`, `${bill.invoiceNumber}.pdf`),
                  'PDF downloaded.',
                  false,
                )
              }
              type="button"
              variant="secondary"
            >
              PDF
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">FINANCE</p>
          <h1>Maintenance billing</h1>
          <p className="muted-copy">
            Preview recurring bills, approve issuance, record receipts, and preserve every
            correction as a linked financial record.
          </p>
        </div>
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {dataError && <Alert tone="danger">{dataError}</Alert>}

      <Card title="Recurring billing run">
        <form className="platform-form platform-form--grid" onSubmit={submitRecurring}>
          <FormField
            id="billing-period-start"
            label="Period starts"
            name="periodStart"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
            required
          />
          <FormField
            id="billing-period-end"
            label="Period ends"
            name="periodEnd"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
            required
          />
          <div className="platform-form__actions">
            <Button disabled={busy || !societyPath} type="submit">
              Preview bills
            </Button>
          </div>
        </form>
        {previewRun?.run ? (
          <div className="page-stack">
            <p>
              <strong>Run status:</strong> {previewRun.run.status} · <strong>Bills:</strong>{' '}
              {previewRun.run.preview.billCount} · <strong>Total:</strong>{' '}
              {money(previewRun.run.preview.totalMinor, previewRun.run.currency)}
            </p>
            <p>
              {previewRun.run.preview.skippedFlatCount} flat(s) skipped because they had no eligible
              active owner.
            </p>
            <DataTable
              caption="Recurring bill preview"
              columns={[
                { key: 'flat', label: 'Flat', render: (flat) => flat?.flatNumber ?? '—' },
                {
                  key: 'subtotalMinor',
                  label: 'Subtotal',
                  render: (amount, bill) => money(amount, bill.currency),
                },
                {
                  key: 'discountMinor',
                  label: 'Discount',
                  render: (amount, bill) => money(amount, bill.currency),
                },
                {
                  key: 'totalMinor',
                  label: 'Total',
                  render: (amount, bill) => money(amount, bill.currency),
                },
                {
                  key: 'dueDate',
                  label: 'Due date',
                  render: (value) => new Date(value).toLocaleDateString(),
                },
              ]}
              rows={previewRun.bills}
            />
            <div className="platform-form__actions">
              {previewRun.run.status === 'draft' ? (
                <Button disabled={busy} onClick={() => void transitionRun('review')} type="button">
                  Submit for review
                </Button>
              ) : null}
              {previewRun.run.status === 'in_review' ? (
                <Button disabled={busy} onClick={() => void transitionRun('approve')} type="button">
                  Approve run
                </Button>
              ) : null}
              {previewRun.run.status === 'approved' ? (
                <Button disabled={busy} onClick={() => void transitionRun('issue')} type="button">
                  Issue all bills
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="content-grid">
        <Card title="Ad hoc charge">
          <form className="platform-form" onSubmit={(event) => submitStandalone(event, 'ad-hoc')}>
            <FormField as="select" id="adhoc-flat" label="Flat" name="flatId" required>
              <option value="">Select flat</option>
              {flatOptions.map((flat) => (
                <option key={flat.id} value={flat.id}>
                  {flat.label}
                </option>
              ))}
            </FormField>
            <FormField
              id="adhoc-description"
              label="Charge description"
              name="description"
              maxLength={200}
              required
            />
            <FormField
              id="adhoc-amount"
              label="Amount (minor currency units)"
              name="amountMinor"
              type="number"
              min="1"
              required
            />
            <FormField
              id="adhoc-due"
              label="Due date"
              name="dueDate"
              type="date"
              defaultValue={todayInput()}
              required
            />
            <FormField as="textarea" id="adhoc-reason" label="Reason" name="reason" required />
            <Button disabled={busy} type="submit">
              Create draft charge
            </Button>
          </form>
        </Card>
        <Card title="Verified opening-balance import">
          <p className="muted-copy">
            Enter rows from verified prior records. The row sum must reconcile exactly to the
            supplied source total; imported balances remain drafts until reviewed and issued.
          </p>
          <form className="platform-form" onSubmit={importOpeningBalances}>
            <FormField
              as="textarea"
              id="opening-balance-json"
              label="Reconciled batch JSON"
              name="openingBalances"
              value={importJson}
              onChange={(event) => setImportJson(event.target.value)}
              hint='{"sourceReference":"FY26-OPEN","sourceTotalMinor":12000,"rows":[{"flatId":"24-character-id","amountMinor":12000,"description":"Opening balance","reason":"Verified against prior register","dueDate":"2026-04-01"}]}'
              rows={5}
              required
            />
            <Button disabled={busy} type="submit">
              Import reconciled balances
            </Button>
          </form>
        </Card>
      </div>

      <div className="content-grid">
        <Card title="Record receipt">
          <form className="platform-form" onSubmit={recordReceipt}>
            <FormField as="select" id="receipt-flat" label="Flat" name="flatId" required>
              <option value="">Select flat</option>
              {flatOptions.map((flat) => (
                <option key={flat.id} value={flat.id}>
                  {flat.label}
                </option>
              ))}
            </FormField>
            <FormField
              as="select"
              id="receipt-payer"
              label="Payer (active owner)"
              name="payerMembershipId"
              required
            >
              <option value="">Select payer</option>
              {ownerOptions.map((owner) => (
                <option key={`${owner.membershipId}-${owner.flatId}`} value={owner.membershipId}>
                  {owner.name}
                </option>
              ))}
            </FormField>
            <FormField
              id="receipt-amount"
              label="Amount (minor currency units)"
              name="amountMinor"
              type="number"
              min="1"
              required
            />
            <FormField as="select" id="receipt-method" label="Method" name="method">
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </FormField>
            <FormField id="receipt-reference" label="Reference" name="reference" maxLength={120} />
            <Button disabled={busy} type="submit">
              Record and allocate FIFO
            </Button>
          </form>
        </Card>
        <Card title="Ageing and reminders">
          {ageing ? (
            <div className="page-stack">
              <p>
                Total outstanding:{' '}
                <strong>{money(ageing.totalOutstandingMinor, ageing.currency)}</strong>
              </p>
              <ul>
                {Object.entries(ageing.ageing).map(([bucket, amount]) => (
                  <li key={bucket}>
                    {bucket.replaceAll(/([A-Z])/g, ' $1')}: {money(amount, ageing.currency)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <LoadingState label="Loading ageing report" />
          )}
          <div className="platform-form__actions">
            <Button
              disabled={busy}
              onClick={() =>
                void perform(
                  () =>
                    apiRequest(`${societyPath}/reminders/issue`, {
                      method: 'POST',
                      body: { daysAhead: 7 },
                    }),
                  'In-app reminders created for upcoming and overdue bills.',
                )
              }
              type="button"
              variant="secondary"
            >
              Create due reminders
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void perform(
                  () => apiRequest(`${societyPath}/late-fees/assess`, { method: 'POST', body: {} }),
                  'Monthly overdue-principal late-fee assessment completed.',
                )
              }
              type="button"
              variant="secondary"
            >
              Assess monthly late fees
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Bills">
        <div className="platform-form__actions">
          <FormField
            as="select"
            id="bill-status-filter"
            label="Status filter"
            name="status"
            value={billStatus}
            onChange={(event) => {
              setBillStatus(event.target.value);
              setSelectedBillId('');
            }}
          >
            <option value="">Active bills</option>
            {['draft', 'in_review', 'approved', 'issued', 'cancelled'].map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </FormField>
        </div>
        {billsLoading ? (
          <LoadingState label="Loading bills" />
        ) : (
          <DataTable
            caption="Maintenance bills"
            columns={billColumns}
            rows={bills}
            emptyMessage="No bills match this filter."
          />
        )}
      </Card>

      {selectedBill ? (
        <Card title={`Bill details · ${selectedBill.invoiceNumber ?? selectedBill.id}`}>
          {billDetail ? (
            <div className="page-stack">
              <p>
                Period {new Date(billDetail.periodStart).toLocaleDateString()} –{' '}
                {new Date(billDetail.periodEnd).toLocaleDateString()} · due{' '}
                {new Date(billDetail.dueDate).toLocaleDateString()}
              </p>
              <DataTable
                caption="Itemized bill charges"
                columns={[
                  { key: 'description', label: 'Item' },
                  { key: 'category', label: 'Category' },
                  {
                    key: 'amountMinor',
                    label: 'Amount',
                    render: (amount, item) =>
                      `${item.discount ? '−' : ''}${money(amount, billDetail.currency)}`,
                  },
                ]}
                rows={billDetail.items}
              />
              <p>
                Outstanding on invoice:{' '}
                <strong>{money(billDetail.outstandingMinor, billDetail.currency)}</strong>
                {' · '}Flat account balance:{' '}
                <strong>{money(billDetail.accountOutstandingMinor, billDetail.currency)}</strong>
              </p>
              <h3>Adjustments</h3>
              <DataTable
                caption="Bill adjustments"
                columns={[
                  { key: 'category', label: 'Type' },
                  { key: 'direction', label: 'Direction' },
                  { key: 'reason', label: 'Reason' },
                  { key: 'status', label: 'Status' },
                  {
                    key: 'id',
                    label: 'Actions',
                    render: (id, note) =>
                      note.status === 'pending_approval' ? (
                        <Button
                          onClick={() =>
                            void perform(
                              () =>
                                apiRequest(`${societyPath}/adjustments/${id}/approve`, {
                                  method: 'POST',
                                  body: {},
                                }),
                              'Adjustment approved.',
                            )
                          }
                          type="button"
                        >
                          Approve
                        </Button>
                      ) : note.status === 'approved' ? (
                        <Button
                          onClick={() =>
                            void perform(
                              () =>
                                apiRequest(`${societyPath}/adjustments/${id}/issue`, {
                                  method: 'POST',
                                  body: {},
                                }),
                              'Adjustment issued.',
                            )
                          }
                          type="button"
                        >
                          Issue
                        </Button>
                      ) : null,
                  },
                ]}
                rows={billDetail.notes}
              />
              <h3>Payment history</h3>
              <DataTable
                caption="Bill payment history"
                columns={[
                  { key: 'receiptNumber', label: 'Receipt' },
                  { key: 'method', label: 'Method' },
                  {
                    key: 'receivedAt',
                    label: 'Received',
                    render: (value) => new Date(value).toLocaleDateString(),
                  },
                  {
                    key: 'allocatedMinor',
                    label: 'Allocated',
                    render: (amount) => money(amount, billDetail.currency),
                  },
                ]}
                rows={billDetail.payments}
              />
              <FormField
                id="bill-action-reason"
                label="Cancellation or revision reason"
                name="reason"
                defaultValue=""
              />
              <div className="platform-form__actions">
                {selectedBill.status !== 'cancelled' ? (
                  <Button
                    disabled={busy}
                    onClick={() => void billAction('cancel')}
                    type="button"
                    variant="secondary"
                  >
                    Cancel bill
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => void billAction('revise')} type="button">
                    Create revision
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <LoadingState label="Loading bill details" />
          )}
        </Card>
      ) : null}

      <Card title="Issue a credit, debit, or penalty adjustment">
        <form
          className="platform-form platform-form--grid"
          id="adjustment-form"
          onSubmit={createAdjustment}
        >
          <FormField as="select" id="adjustment-bill" label="Issued bill" name="billId" required>
            <option value="">Select bill</option>
            {bills
              .filter((bill) => bill.status === 'issued')
              .map((bill) => (
                <option key={bill.id} value={bill.id}>
                  {bill.invoiceNumber} · {bill.flat?.flatNumber} ·{' '}
                  {money(bill.outstandingMinor, bill.currency)}
                </option>
              ))}
          </FormField>
          <FormField as="select" id="adjustment-direction" label="Direction" name="direction">
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
          </FormField>
          <FormField as="select" id="adjustment-category" label="Category" name="category">
            <option value="adjustment">Adjustment</option>
            <option value="discount">Discount</option>
            <option value="penalty">Penalty</option>
          </FormField>
          <FormField
            id="adjustment-amount"
            label="Amount (minor currency units)"
            name="amountMinor"
            type="number"
            min="1"
            required
          />
          <FormField
            as="textarea"
            id="adjustment-reason"
            label="Mandatory reason"
            name="reason"
            required
          />
          <Button disabled={busy} type="submit">
            Create adjustment
          </Button>
        </form>
      </Card>

      {runsResult?.runs?.length ? (
        <Card title="Recent billing runs">
          <DataTable
            caption="Recent billing runs"
            columns={[
              {
                key: 'periodStart',
                label: 'Period start',
                render: (value) => new Date(value).toLocaleDateString(),
              },
              { key: 'revision', label: 'Revision' },
              {
                key: 'status',
                label: 'Status',
                render: (status) => <StatusBadge status={status} />,
              },
              {
                key: 'preview',
                label: 'Bills / total',
                render: (preview, run) =>
                  `${preview.billCount} / ${money(preview.totalMinor, run.currency)}`,
              },
            ]}
            rows={runsResult.runs}
          />
        </Card>
      ) : null}
    </div>
  );
}
