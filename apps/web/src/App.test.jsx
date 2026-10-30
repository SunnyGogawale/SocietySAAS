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
});
