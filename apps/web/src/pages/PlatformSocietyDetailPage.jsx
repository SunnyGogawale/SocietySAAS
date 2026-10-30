import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { usePlatformData } from '../platform/usePlatformData.js';

function value(form, name) {
  const fieldValue = new FormData(form).get(name);
  return fieldValue === '' ? null : fieldValue;
}

export default function PlatformSocietyDetailPage() {
  const { societyId } = useParams();
  const { data, error, loading, refresh, setError } = usePlatformData(
    `/platform/societies/${encodeURIComponent(societyId)}`,
  );
  const { data: plansData } = usePlatformData('/platform/plans?includeArchived=true');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const society = data?.society;
  const plans = plansData?.plans ?? [];
  const activePlans = plans.filter((plan) => plan.status === 'active');

  async function perform(action, message) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await perform(
      () =>
        apiRequest(`/platform/societies/${societyId}/profile`, {
          method: 'PATCH',
          body: {
            name: value(form, 'name'),
            slug: value(form, 'slug'),
            registrationNumber: value(form, 'registrationNumber'),
            address: value(form, 'address'),
            contactName: value(form, 'contactName'),
            contactEmail: value(form, 'contactEmail'),
            contactPhone: value(form, 'contactPhone'),
          },
        }),
      'Society profile updated.',
    );
  }

  async function provision(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await perform(
      () =>
        apiRequest(`/platform/societies/${societyId}/approve`, {
          method: 'POST',
          body: {
            planId: value(form, 'planId'),
            trialDays: Number(value(form, 'trialDays')),
          },
        }),
      'Registration approved, tenant provisioned, and Society Admin invitation sent.',
    );
  }

  async function reject(event) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    await perform(
      () =>
        apiRequest(`/platform/societies/${societyId}/reject`, {
          method: 'POST',
          body: { reason },
        }),
      'Registration rejected.',
    );
  }

  async function changeStatus(status) {
    if (status === 'archived' && !window.confirm('Archive this society? This cannot be undone.')) {
      return;
    }
    await perform(
      () =>
        apiRequest(`/platform/societies/${societyId}/status`, {
          method: 'PATCH',
          body: { status },
        }),
      `Society ${status}.`,
    );
  }

  async function updateSubscription(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const trialDays = value(form, 'trialDays');
    await perform(
      () =>
        apiRequest(`/platform/societies/${societyId}/subscription`, {
          method: 'PATCH',
          body: {
            planId: value(form, 'planId'),
            status: value(form, 'status'),
            ...(trialDays === null ? {} : { trialDays: Number(trialDays) }),
          },
        }),
      'Subscription configuration updated.',
    );
  }

  async function inviteAdmin(event) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    await perform(
      () =>
        apiRequest(`/platform/societies/${societyId}/invitations`, {
          method: 'POST',
          body: { email },
        }),
      'Society Admin invitation sent.',
    );
  }

  if (loading) return <LoadingState label="Loading society details…" />;
  if (!society) {
    return (
      <section>
        {error && <Alert tone="danger">{error}</Alert>}
        <Link className="auth-link" to="/platform/societies">
          Back to societies
        </Link>
      </section>
    );
  }

  const isPending = ['pending_review', 'provisioning'].includes(society.status);
  const canChangeStatus = ['active', 'suspended'].includes(society.status);

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Link className="auth-link" to="/platform/societies">
              Societies
            </Link>{' '}
            / Tenant record
          </p>
          <h1 id="page-title">{society.name}</h1>
          <p className="page-heading__description">
            {society.slug} · <StatusBadge>{society.status.replaceAll('_', ' ')}</StatusBadge>
          </p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {isPending && (
        <div className="platform-columns">
          <Card title="Approve and provision">
            <p className="muted-copy">
              Approval creates the tenant subscription and invites the registered contact as the
              primary Society Admin.
            </p>
            <form className="platform-form" onSubmit={provision}>
              <FormField
                as="select"
                id="approval-plan"
                label="Subscription plan"
                name="planId"
                required
              >
                <option value="">Select a plan</option>
                {activePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </FormField>
              <FormField
                id="trial-days"
                label="Trial period (days)"
                min="0"
                max="3650"
                name="trialDays"
                required
                type="number"
              />
              <Button disabled={busy || activePlans.length === 0} type="submit">
                {busy ? 'Provisioning…' : 'Approve and provision'}
              </Button>
              {!activePlans.length && (
                <p className="form-field__error">Create an active subscription plan first.</p>
              )}
            </form>
          </Card>
          {society.status === 'pending_review' && (
            <Card title="Reject registration">
              <form className="platform-form" onSubmit={reject}>
                <FormField
                  as="textarea"
                  id="rejection-reason"
                  label="Reason"
                  name="reason"
                  minLength={5}
                  required
                  rows={3}
                />
                <Button disabled={busy} type="submit" variant="secondary">
                  Reject registration
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}

      <div className="platform-columns platform-columns--details">
        <Card title="Society profile">
          <form className="platform-form" key={society.id} onSubmit={saveProfile}>
            <FormField
              defaultValue={society.name}
              id="profile-name"
              label="Society name"
              name="name"
              required
            />
            <FormField
              defaultValue={society.slug}
              id="profile-slug"
              label="Tenant slug"
              name="slug"
              required
            />
            <FormField
              defaultValue={society.registrationNumber ?? ''}
              id="profile-reg"
              label="Registration number"
              name="registrationNumber"
            />
            <FormField
              as="textarea"
              defaultValue={society.address ?? ''}
              id="profile-address"
              label="Address"
              name="address"
              rows={3}
            />
            <FormField
              defaultValue={society.contactName ?? ''}
              id="profile-contact-name"
              label="Contact name"
              name="contactName"
            />
            <FormField
              defaultValue={society.contactEmail ?? ''}
              id="profile-contact-email"
              label="Contact email"
              name="contactEmail"
              type="email"
            />
            <FormField
              defaultValue={society.contactPhone ?? ''}
              id="profile-phone"
              label="Contact phone"
              name="contactPhone"
            />
            <Button disabled={busy} type="submit">
              Save profile
            </Button>
          </form>
          <div className="platform-actions platform-actions--wrap">
            {society.status === 'active' && (
              <Button disabled={busy} onClick={() => changeStatus('suspended')} variant="secondary">
                Suspend
              </Button>
            )}
            {society.status === 'suspended' && (
              <Button disabled={busy} onClick={() => changeStatus('active')}>
                Reactivate
              </Button>
            )}
            {canChangeStatus && (
              <Button disabled={busy} onClick={() => changeStatus('archived')} variant="secondary">
                Archive
              </Button>
            )}
          </div>
        </Card>
        <div className="platform-stack">
          <Card title="Primary Society Admin">
            {society.primaryAdmin ? (
              <p>
                <strong>{society.primaryAdmin.displayName}</strong>
                <span className="platform-secondary">{society.primaryAdmin.email}</span>
              </p>
            ) : (
              <p className="muted-copy">No primary administrator assigned.</p>
            )}
            {society.admins?.some((admin) => admin.status === 'active') && (
              <form
                className="platform-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const membershipId = new FormData(event.currentTarget).get('membershipId');
                  perform(
                    () =>
                      apiRequest(`/platform/societies/${societyId}/primary-admin`, {
                        method: 'PUT',
                        body: { membershipId },
                      }),
                    'Primary Society Admin updated.',
                  );
                }}
              >
                <FormField
                  as="select"
                  id="primary-admin"
                  label="Select an active admin"
                  name="membershipId"
                  required
                >
                  {society.admins
                    .filter((admin) => admin.status === 'active')
                    .map((admin) => (
                      <option key={admin.membershipId} value={admin.membershipId}>
                        {admin.displayName} — {admin.email}
                      </option>
                    ))}
                </FormField>
                <Button disabled={busy} type="submit" variant="secondary">
                  Set primary admin
                </Button>
              </form>
            )}
            <form className="platform-form platform-form--spaced" onSubmit={inviteAdmin}>
              <FormField
                id="admin-invite-email"
                label="Invite another Society Admin"
                name="email"
                required
                type="email"
              />
              <Button disabled={busy} type="submit" variant="secondary">
                Send invitation
              </Button>
            </form>
          </Card>
          <Card title="Subscription">
            {society.subscription ? (
              <form className="platform-form" onSubmit={updateSubscription}>
                <FormField
                  as="select"
                  defaultValue={society.subscription.plan?.id ?? ''}
                  id="subscription-plan"
                  label="Plan"
                  name="planId"
                  required
                >
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                      {plan.status === 'archived' ? ' (archived)' : ''}
                    </option>
                  ))}
                </FormField>
                <FormField
                  as="select"
                  defaultValue={society.subscription.status}
                  id="subscription-status"
                  label="Status"
                  name="status"
                >
                  {['trialing', 'active', 'past_due', 'suspended', 'canceled'].map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll('_', ' ')}
                    </option>
                  ))}
                </FormField>
                <FormField
                  id="subscription-trial"
                  label="Reset trial period (days, optional)"
                  min="0"
                  max="3650"
                  name="trialDays"
                  type="number"
                />
                <div className="platform-limit-list">
                  <span>
                    Member limit: {society.subscription.limits?.maxMembers ?? 'Unlimited'}
                  </span>
                  <span>Home limit: {society.subscription.limits?.maxHomes ?? 'Unlimited'}</span>
                  <span>
                    Storage limit:{' '}
                    {society.subscription.limits?.maxStorageMb
                      ? `${society.subscription.limits.maxStorageMb} MB`
                      : 'Unlimited'}
                  </span>
                </div>
                <Button disabled={busy} type="submit">
                  Update subscription
                </Button>
              </form>
            ) : (
              <p className="muted-copy">A subscription is created during registration approval.</p>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}
