import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { downloadCsv, usePlatformData } from '../platform/usePlatformData.js';

function queryString(values) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) parameters.set(key, value);
  return parameters.toString();
}

export default function PlatformAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const values = Object.fromEntries(searchParams.entries());
  const query = queryString({ ...values, page: values.page ?? '1', limit: values.limit ?? '25' });
  const { data, error, loading } = usePlatformData(`/platform/audit-logs?${query}`);

  async function exportLogs() {
    setExportError('');
    setExportNotice('');
    try {
      const truncated = await downloadCsv(
        `/platform/audit-logs/export?${query}`,
        'platform-audit.csv',
      );
      if (truncated)
        setExportNotice(
          'Export reached the 5,000-record limit; narrow filters to export remaining events.',
        );
    } catch (requestError) {
      setExportError(requestError.message);
    }
  }

  const columns = [
    { key: 'occurredAt', label: 'Time', render: (time) => new Date(time).toLocaleString() },
    { key: 'actor', label: 'Actor' },
    { key: 'action', label: 'Action' },
    { key: 'societyId', label: 'Society ID', render: (id) => id ?? 'Platform' },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (outcome) => (
        <StatusBadge tone={outcome === 'success' ? 'success' : 'danger'}>{outcome}</StatusBadge>
      ),
    },
    { key: 'requestId', label: 'Request ID' },
  ];

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Governance</p>
          <h1 id="page-title">Platform audit log</h1>
          <p className="page-heading__description">
            Review immutable platform and tenant lifecycle events.
          </p>
        </div>
        <Button onClick={exportLogs} variant="secondary">
          Export CSV
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {exportError && <Alert tone="danger">{exportError}</Alert>}
      {exportNotice && <Alert tone="warning">{exportNotice}</Alert>}
      <form
        className="platform-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setSearchParams(
            queryString({
              action: form.get('action'),
              outcome: form.get('outcome'),
              societyId: form.get('societyId'),
              sort: form.get('sort'),
              direction: form.get('direction'),
              page: '1',
              limit: '25',
            }),
          );
        }}
      >
        <FormField
          defaultValue={values.action ?? ''}
          id="audit-action"
          label="Action"
          name="action"
        />
        <FormField
          as="select"
          defaultValue={values.outcome ?? ''}
          id="audit-outcome"
          label="Outcome"
          name="outcome"
        >
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </FormField>
        <FormField
          defaultValue={values.societyId ?? ''}
          id="audit-society-id"
          label="Society ID"
          name="societyId"
        />
        <FormField
          as="select"
          defaultValue={values.sort ?? 'occurredAt'}
          id="audit-sort"
          label="Sort by"
          name="sort"
        >
          <option value="occurredAt">Time</option>
          <option value="action">Action</option>
          <option value="outcome">Outcome</option>
        </FormField>
        <FormField
          as="select"
          defaultValue={values.direction ?? 'desc'}
          id="audit-direction"
          label="Order"
          name="direction"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </FormField>
        <Button type="submit">Apply filters</Button>
      </form>
      {loading ? (
        <LoadingState label="Loading platform audit…" />
      ) : (
        <>
          <DataTable
            caption="Platform audit events"
            columns={columns}
            rows={data?.auditLogs ?? []}
          />
          <div className="platform-pagination">
            <span>
              {data?.pagination.total ?? 0} events · Page {data?.pagination.page ?? 1} of{' '}
              {Math.max(data?.pagination.pageCount ?? 0, 1)}
            </span>
            <div className="platform-actions">
              <Button
                disabled={(data?.pagination.page ?? 1) <= 1}
                onClick={() =>
                  setSearchParams(
                    queryString({
                      ...values,
                      page: String((data?.pagination.page ?? 1) - 1),
                      limit: '25',
                    }),
                  )
                }
                variant="secondary"
              >
                Previous
              </Button>
              <Button
                disabled={(data?.pagination.page ?? 1) >= (data?.pagination.pageCount ?? 1)}
                onClick={() =>
                  setSearchParams(
                    queryString({
                      ...values,
                      page: String((data?.pagination.page ?? 1) + 1),
                      limit: '25',
                    }),
                  )
                }
                variant="secondary"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
