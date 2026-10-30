import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { downloadCsv, usePlatformData } from '../platform/usePlatformData.js';
import { useAuth } from '../auth/AuthContext.jsx';

function queryString(values) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) parameters.set(key, value);
  return parameters.toString();
}

export default function PlatformSupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [busyTicket, setBusyTicket] = useState('');
  const { user } = useAuth();
  const values = Object.fromEntries(searchParams.entries());
  const query = queryString({ ...values, page: values.page ?? '1', limit: values.limit ?? '25' });
  const { data, error, loading, refresh } = usePlatformData(`/platform/support-tickets?${query}`);

  async function exportTickets() {
    setExportError('');
    setExportNotice('');
    try {
      const truncated = await downloadCsv(
        `/platform/support-tickets/export?${query}`,
        'support-tickets.csv',
      );
      if (truncated)
        setExportNotice(
          'Export reached the 5,000-record limit; narrow filters to export remaining tickets.',
        );
    } catch (requestError) {
      setExportError(requestError.message);
    }
  }

  async function updateTicket(ticket, changes) {
    setBusyTicket(ticket.id);
    setUpdateError('');
    try {
      await apiRequest(`/platform/support-tickets/${ticket.id}`, {
        method: 'PATCH',
        body: { status: ticket.status, ...changes },
      });
      await refresh();
    } catch (requestError) {
      setUpdateError(requestError.message);
    } finally {
      setBusyTicket('');
    }
  }

  const columns = [
    { key: 'society', label: 'Society' },
    {
      key: 'subject',
      label: 'Ticket',
      render: (subject, ticket) => (
        <details className="platform-ticket">
          <summary>{subject}</summary>
          <p>{ticket.description}</p>
        </details>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (priority) => (
        <StatusBadge tone={priority === 'urgent' ? 'danger' : 'neutral'}>{priority}</StatusBadge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (status, ticket) => (
        <FormField
          aria-label={`Status for ${ticket.subject}`}
          as="select"
          disabled={busyTicket === ticket.id}
          id={`ticket-status-${ticket.id}`}
          onChange={(event) => updateTicket(ticket, { status: event.target.value })}
          value={status}
        >
          {['open', 'in_progress', 'resolved', 'closed'].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </FormField>
      ),
    },
    {
      key: 'assignedTo',
      label: 'Assigned to',
      render: (assignee) => assignee?.displayName ?? 'Unassigned',
    },
    {
      key: 'actions',
      label: 'Assignment',
      render: (_, ticket) =>
        ticket.assignedTo?.id === user?.id ? (
          <span className="platform-secondary">Assigned to you</span>
        ) : (
          <Button
            disabled={busyTicket === ticket.id}
            onClick={() => updateTicket(ticket, { assignedTo: user.id })}
            variant="secondary"
          >
            Assign to me
          </Button>
        ),
    },
    { key: 'updatedAt', label: 'Updated', render: (time) => new Date(time).toLocaleString() },
  ];

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 id="page-title">Support tickets</h1>
          <p className="page-heading__description">
            Track support requests across society tenants.
          </p>
        </div>
        <Button onClick={exportTickets} variant="secondary">
          Export CSV
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {exportError && <Alert tone="danger">{exportError}</Alert>}
      {exportNotice && <Alert tone="warning">{exportNotice}</Alert>}
      {updateError && <Alert tone="danger">{updateError}</Alert>}
      <form
        className="platform-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setSearchParams(
            queryString({
              q: form.get('q'),
              status: form.get('status'),
              sort: form.get('sort'),
              direction: form.get('direction'),
              page: '1',
              limit: '25',
            }),
          );
        }}
      >
        <FormField defaultValue={values.q ?? ''} id="ticket-search" label="Search" name="q" />
        <FormField
          as="select"
          defaultValue={values.status ?? ''}
          id="ticket-filter-status"
          label="Status"
          name="status"
        >
          <option value="">All statuses</option>
          {['open', 'in_progress', 'resolved', 'closed'].map((status) => (
            <option key={status} value={status}>
              {status.replaceAll('_', ' ')}
            </option>
          ))}
        </FormField>
        <FormField
          as="select"
          defaultValue={values.sort ?? 'updatedAt'}
          id="ticket-sort"
          label="Sort by"
          name="sort"
        >
          <option value="updatedAt">Last updated</option>
          <option value="createdAt">Created</option>
          <option value="status">Status</option>
          <option value="priority">Priority</option>
        </FormField>
        <FormField
          as="select"
          defaultValue={values.direction ?? 'desc'}
          id="ticket-direction"
          label="Order"
          name="direction"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </FormField>
        <Button type="submit">Apply filters</Button>
      </form>
      {loading ? (
        <LoadingState label="Loading support tickets…" />
      ) : (
        <>
          <DataTable
            caption="Platform support tickets"
            columns={columns}
            rows={data?.tickets ?? []}
          />
          <div className="platform-pagination">
            <span>
              {data?.pagination.total ?? 0} tickets · Page {data?.pagination.page ?? 1} of{' '}
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
