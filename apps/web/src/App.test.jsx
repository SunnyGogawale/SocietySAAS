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
});
