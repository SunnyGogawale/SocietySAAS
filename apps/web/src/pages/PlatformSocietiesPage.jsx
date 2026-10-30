import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { downloadCsv, usePlatformData } from '../platform/usePlatformData.js';

const statusTone = {
  active: 'success',
  suspended: 'danger',
  pending_review: 'warning',
  provisioning: 'info',
  rejected: 'danger',
  archived: 'neutral',
};

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export default function PlatformSocietiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') ?? '');
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const query = Object.fromEntries(searchParams.entries());
  const search = queryString({ ...query, page: query.page ?? '1', limit: query.limit ?? '25' });
  const { data, error, loading } = usePlatformData(`/platform/societies?${search}`);
  const societies = data?.societies ?? [];

  async function handleExport() {
    setExportError('');
    setExportNotice('');
    setExporting(true);
    try {
      const truncated = await downloadCsv(`/platform/societies/export?${search}`, 'societies.csv');
      if (truncated)
        setExportNotice(
          'Export reached the 5,000-record limit; narrow filters to export remaining societies.',
        );
    } catch (downloadError) {
      setExportError(downloadError.message);
    } finally {
      setExporting(false);
    }
  }

  const columns = [
    {
      key: 'name',
      label: 'Society',
      render: (_, society) => (
        <div>
          <Link className="platform-record-link" to={`/platform/societies/${society.id}`}>
            {society.name}
          </Link>
          <span className="platform-secondary">{society.slug}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (status) => (
        <StatusBadge tone={statusTone[status]}>{status.replaceAll('_', ' ')}</StatusBadge>
      ),
    },
    {
      key: 'primaryAdmin',
      label: 'Primary admin',
      render: (admin) =>
        admin ? (
          <span>
            {admin.displayName}
            <span className="platform-secondary">{admin.email}</span>
          </span>
        ) : (
          'Not assigned'
        ),
    },
    {
      key: 'subscription',
      label: 'Subscription',
      render: (subscription) =>
        subscription ? (
          <span>
            {subscription.plan?.name ?? 'Unknown plan'}
            <span className="platform-secondary">{subscription.status}</span>
          </span>
        ) : (
          'Not configured'
        ),
    },
    {
      key: 'createdAt',
      label: 'Submitted',
      render: (createdAt) => new Date(createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, society) => (
        <Link
          className="button button--secondary platform-small-button"
          to={`/platform/societies/${society.id}`}
        >
          Review
        </Link>
      ),
    },
  ];

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tenant management</p>
          <h1 id="page-title">Societies</h1>
          <p className="page-heading__description">
            Review registrations and manage approved society accounts.
          </p>
        </div>
        <Button disabled={exporting} onClick={handleExport} variant="secondary">
          {exporting ? 'Preparing…' : 'Export CSV'}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {exportError && <Alert tone="danger">{exportError}</Alert>}
      {exportNotice && <Alert tone="warning">{exportNotice}</Alert>}
      <form
        className="platform-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearchParams(
            queryString({
              q: draftQuery.trim(),
              status: event.currentTarget.elements.status.value,
              sort: event.currentTarget.elements.sort.value,
              direction: event.currentTarget.elements.direction.value,
              page: '1',
              limit: '25',
            }),
          );
        }}
      >
        <FormField
          id="society-search"
          label="Search"
          name="q"
          onChange={(event) => setDraftQuery(event.target.value)}
          value={draftQuery}
        />
        <FormField
          as="select"
          id="society-status"
          label="Status"
          name="status"
          defaultValue={query.status ?? ''}
        >
          <option value="">All statuses</option>
          {['pending_review', 'provisioning', 'active', 'suspended', 'rejected', 'archived'].map(
            (status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ),
          )}
        </FormField>
        <FormField
          as="select"
          id="society-sort"
          label="Sort by"
          name="sort"
          defaultValue={query.sort ?? 'createdAt'}
        >
          <option value="createdAt">Submitted</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
        </FormField>
        <FormField
          as="select"
          id="society-direction"
          label="Order"
          name="direction"
          defaultValue={query.direction ?? 'desc'}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </FormField>
        <Button type="submit">Apply filters</Button>
      </form>
      {loading ? (
        <LoadingState label="Loading societies…" />
      ) : (
        <>
          <DataTable caption="Society accounts" columns={columns} rows={societies} />
          <div className="platform-pagination">
            <span>
              {data?.pagination.total ?? 0} societies · Page {data?.pagination.page ?? 1} of{' '}
              {Math.max(data?.pagination.pageCount ?? 0, 1)}
            </span>
            <div className="platform-actions">
              <Button
                disabled={(data?.pagination.page ?? 1) <= 1}
                onClick={() =>
                  setSearchParams(
                    queryString({
                      ...query,
                      page: String((data?.pagination.page ?? 1) - 1),
                      limit: query.limit ?? '25',
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
                      ...query,
                      page: String((data?.pagination.page ?? 1) + 1),
                      limit: query.limit ?? '25',
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
