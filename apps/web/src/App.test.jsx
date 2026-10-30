import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, vi } from 'vitest';
import App from './App.jsx';

describe('application shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the sign-in flow when no authenticated session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'authentication_required', message: 'Authentication is required' },
            requestId: 'test',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in through the API and opens the authenticated application shell', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'authentication_required', message: 'Authentication is required' },
            requestId: 'initial',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'user-1',
                email: 'admin@example.test',
                displayName: 'Society Admin',
                platformRole: 'user',
              },
              societies: [],
              activeSociety: null,
              csrfToken: 'csrf-token',
            },
            requestId: 'login',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a very secure password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(
      JSON.stringify({ email: 'admin@example.test', password: 'a very secure password' }),
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows the platform console only for an authenticated Super Admin', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const data = String(url).includes('/auth/me')
        ? {
            user: {
              id: 'platform-user',
              email: 'platform@example.test',
              displayName: 'Platform Admin',
              platformRole: 'super_admin',
            },
            societies: [],
            activeSociety: null,
            csrfToken: 'csrf-token',
          }
        : {
            societies: {
              total: 4,
              active: 3,
              suspended: 1,
              pendingReview: 0,
              provisioning: 0,
              rejected: 0,
              archived: 0,
            },
            subscriptions: {
              total: 3,
              trialing: 1,
              active: 2,
              pastDue: 0,
              suspended: 0,
              canceled: 0,
              plans: [],
            },
            support: { openTickets: 0 },
            operations: {
              status: 'ok',
              database: 'connected',
              uptimeSeconds: 100,
              failuresLast24Hours: 0,
            },
          };
      return new Response(JSON.stringify({ success: true, data, requestId: 'test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Platform dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Subscription plans' })).toHaveAttribute(
      'href',
      '/platform/plans',
    );
    expect(await screen.findByText('Active tenants')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/platform/dashboard'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('lets a Society Admin view and edit tenant-scoped society settings', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const data = String(url).includes('/auth/me')
        ? {
            user: {
              id: 'society-admin',
              email: 'admin@example.test',
              displayName: 'Society Admin',
              platformRole: 'user',
            },
            societies: [{ id: 'society-1', name: 'North Gardens', role: 'society_admin' }],
            activeSociety: { id: 'society-1', name: 'North Gardens', role: 'society_admin' },
            csrfToken: 'csrf-token',
          }
        : {
            society: {
              id: 'society-1',
              name: 'North Gardens',
              address: '1 Garden Road',
              contactName: 'Office',
              contactEmail: 'office@example.test',
              contactPhone: '',
              registrationNumber: 'REG-1',
              logoUrl: null,
            },
            settings: {
              timeZone: 'Asia/Kolkata',
              currency: 'INR',
              dateFormat: 'DD/MM/YYYY',
              financialYearStartMonth: 4,
              financialYearStartDay: 1,
              numbering: {
                building: 'Building {number}',
                wing: 'Wing {letter}',
                flat: '{floor}{number}',
              },
              visitorRules: { requirePreApproval: false, maxVisitDaysAhead: 30 },
              complaintRules: { acknowledgmentHours: 24, resolutionTargetHours: 168 },
              notificationRules: { emailEnabled: true, pushEnabled: true, smsEnabled: false },
              facilityBookingRules: {
                maxDaysAhead: 30,
                requireApproval: true,
                maxBookingsPerDay: 1,
              },
              branding: { primaryColor: '#142b4a', accentColor: '#2563eb' },
            },
            chargeRules: null,
            chargeRuleHistory: [],
            approvalPolicies: [],
            notificationTemplates: [],
          };
      return new Response(JSON.stringify({ success: true, data, requestId: 'settings' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('link', { name: 'Society settings' }));
    expect(await screen.findByRole('heading', { name: 'Society settings' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Society name')).toHaveValue('North Gardens');
    expect(screen.getByLabelText('Billing frequency')).toBeInTheDocument();
  });

  it('loads the Society Admin property workspace with the tenant property data', async () => {
    const societyId = '507f1f77bcf86cd799439011';
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const path = String(url);
      let data = {};
      if (path.includes('/auth/me')) {
        data = {
          user: {
            id: 'society-admin',
            email: 'admin@example.test',
            displayName: 'Society Admin',
            platformRole: 'user',
          },
          societies: [{ id: societyId, name: 'North Gardens', role: 'society_admin' }],
          activeSociety: { id: societyId, name: 'North Gardens', role: 'society_admin' },
          csrfToken: 'csrf-token',
        };
      } else if (path.includes('/properties/structure')) {
        data = { buildings: [], wings: [], floors: [] };
      } else if (path.includes('/properties?')) {
        data = {
          properties: [
            {
              id: '507f1f77bcf86cd799439012',
              flatNumber: '101',
              area: 900,
              areaUnit: 'square_foot',
              propertyType: 'apartment',
              occupancyStatus: 'vacant',
              building: { name: 'North Tower' },
              wing: null,
              owners: [],
              parkingSlots: [],
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, pageCount: 1 },
        };
      } else if (path.includes('/residents')) {
        data = { residents: [], pagination: { page: 1, limit: 20, total: 0, pageCount: 0 } };
      } else if (path.includes('/parking-slots')) {
        data = { parkingSlots: [] };
      } else if (path.includes('/vehicles')) {
        data = { vehicles: [], pagination: { page: 1, limit: 100, total: 0, pageCount: 0 } };
      }
      return new Response(JSON.stringify({ success: true, data, requestId: 'property' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('link', { name: 'Properties and residents' }));
    expect(
      await screen.findByRole('heading', { name: 'Properties and residents' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('101')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export properties' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/societies/${societyId}/properties`),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('lets a Society Admin configure tenant-scoped Razorpay credentials', async () => {
    const societyId = '507f1f77bcf86cd799439011';
    const fetchMock = vi.fn().mockImplementation(async (url, options = {}) => {
      const path = String(url);
      let data = {};
      if (path.includes('/auth/me')) {
        data = {
          user: {
            id: 'society-admin',
            email: 'admin@example.test',
            displayName: 'Society Admin',
            platformRole: 'user',
          },
          societies: [{ id: societyId, name: 'North Gardens', role: 'society_admin' }],
          activeSociety: { id: societyId, name: 'North Gardens', role: 'society_admin' },
          csrfToken: 'csrf-token',
        };
      } else if (path.endsWith('/finance/gateway') && options.method === 'PUT') {
        data = { configured: true, keyId: 'rzp_test_north', webhookUrl: '/webhook' };
      } else if (path.endsWith('/finance/gateway')) {
        data = { configured: false, provider: 'razorpay', webhookUrl: '/webhook' };
      } else if (path.endsWith('/finance/accounts')) {
        data = { accounts: [] };
      } else if (path.endsWith('/finance/vendors')) {
        data = { vendors: [] };
      } else if (path.endsWith('/finance/expenses')) {
        data = { expenses: [] };
      } else if (path.endsWith('/finance/payments')) {
        data = { payments: [] };
      } else if (path.includes('/finance/reports/summary')) {
        data = {
          currency: 'INR',
          billIssuedMinor: 0,
          collectedMinor: 0,
          refundedMinor: 0,
          netCollectionsMinor: 0,
          expensesPostedMinor: 0,
          duesMinor: 0,
        };
      } else if (path.includes('/finance/journals')) {
        data = { journals: [] };
      } else if (path.includes('/finance/reconciliation/lines')) {
        data = { lines: [], summary: { matchedCount: 0, transactionCount: 0 } };
      }
      return new Response(JSON.stringify({ success: true, data, requestId: 'finance' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('link', { name: 'Payments and accounting' }));
    expect(
      await screen.findByRole('heading', { name: 'Payments and accounting' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Razorpay key ID'), {
      target: { value: 'rzp_test_north' },
    });
    fireEvent.change(screen.getByLabelText('Razorpay key secret'), {
      target: { value: 'test-key-secret-123' },
    });
    fireEvent.change(screen.getByLabelText('Webhook signing secret'), {
      target: { value: 'test-webhook-secret-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    expect(await screen.findByText('Razorpay credentials saved securely.')).toBeInTheDocument();
    const saveRequest = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/finance/gateway') && options.method === 'PUT',
    );
    expect(JSON.parse(saveRequest[1].body)).toEqual({
      keyId: 'rzp_test_north',
      keySecret: 'test-key-secret-123',
      webhookSecret: 'test-webhook-secret-123',
    });
    expect(screen.queryByDisplayValue('test-key-secret-123')).not.toBeInTheDocument();
  });
});
