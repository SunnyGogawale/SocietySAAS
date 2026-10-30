import { useState } from 'react';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { usePlatformData } from '../platform/usePlatformData.js';

function asLimit(value) {
  return value === '' ? null : Number(value);
}

export default function PlatformPlansPage() {
  const { data, error, loading, refresh, setError } = usePlatformData(
    '/platform/plans?includeArchived=true',
  );
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function createPlan(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/platform/plans', {
        method: 'POST',
        body: {
          name: values.get('name'),
          code: values.get('code'),
          description: values.get('description'),
          limits: {
            maxMembers: asLimit(values.get('maxMembers')),
            maxHomes: asLimit(values.get('maxHomes')),
            maxStorageMb: asLimit(values.get('maxStorageMb')),
          },
          priceMinor: values.get('priceMinor') === '' ? null : Number(values.get('priceMinor')),
          currency: values.get('currency') || null,
        },
      });
      form.reset();
      await refresh();
      setNotice('Subscription plan created.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function updatePlan(plan, event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/plans/${plan.id}`, {
        method: 'PATCH',
        body: {
          name: values.get('name'),
          code: values.get('code'),
          description: values.get('description'),
          priceMinor: values.get('priceMinor') === '' ? null : Number(values.get('priceMinor')),
          currency: values.get('currency') || null,
          limits: {
            maxMembers: asLimit(values.get('maxMembers')),
            maxHomes: asLimit(values.get('maxHomes')),
            maxStorageMb: asLimit(values.get('maxStorageMb')),
          },
        },
      });
      await refresh();
      setNotice(`${plan.name} plan updated.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function setPlanStatus(plan, status) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/plans/${plan.id}`, { method: 'PATCH', body: { status } });
      await refresh();
      setNotice(`${plan.name} ${status}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Commercial configuration</p>
          <h1 id="page-title">Subscription plans</h1>
          <p className="page-heading__description">
            Configure plan limits and set subscription terms during tenant approval.
          </p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="platform-create-card" title="Create a plan">
        <form className="platform-form platform-form--grid" onSubmit={createPlan}>
          <FormField id="plan-name" label="Plan name" name="name" required />
          <FormField id="plan-code" label="Plan code" name="code" required />
          <FormField
            as="textarea"
            id="plan-description"
            label="Description"
            name="description"
            rows={2}
          />
          <FormField
            id="plan-members"
            label="Maximum members (blank = unlimited)"
            min="1"
            name="maxMembers"
            type="number"
          />
          <FormField
            id="plan-homes"
            label="Maximum homes (blank = unlimited)"
            min="1"
            name="maxHomes"
            type="number"
          />
          <FormField
            id="plan-storage"
            label="Maximum storage MB (blank = unlimited)"
            min="1"
            name="maxStorageMb"
            type="number"
          />
          <FormField
            id="plan-price"
            label="Price in minor currency units (optional)"
            min="0"
            name="priceMinor"
            type="number"
          />
          <FormField
            id="plan-currency"
            hint="ISO 4217 alphabetic currency code; required if a price is entered."
            label="Currency (optional)"
            maxLength={3}
            name="currency"
          />
          <div className="platform-form__actions">
            <Button disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Create plan'}
            </Button>
          </div>
        </form>
      </Card>
      {loading ? (
        <LoadingState label="Loading plans…" />
      ) : (
        <div className="platform-plan-grid">
          {(data?.plans ?? []).map((plan) => (
            <Card key={plan.id} title={plan.name}>
              <div className="status-line">
                <StatusBadge tone={plan.status === 'active' ? 'success' : 'neutral'}>
                  {plan.status}
                </StatusBadge>
                <span className="platform-secondary">{plan.code}</span>
              </div>
              <p className="platform-plan-subscribers">{plan.subscribers} subscriptions</p>
              <form className="platform-form" onSubmit={(event) => updatePlan(plan, event)}>
                <FormField
                  defaultValue={plan.name}
                  id={`name-${plan.id}`}
                  label="Plan name"
                  name="name"
                  required
                />
                <FormField
                  defaultValue={plan.code}
                  id={`code-${plan.id}`}
                  label="Plan code"
                  name="code"
                  required
                />
                <FormField
                  as="textarea"
                  defaultValue={plan.description ?? ''}
                  id={`description-${plan.id}`}
                  label="Description"
                  name="description"
                  rows={2}
                />
                <FormField
                  defaultValue={plan.limits?.maxMembers ?? ''}
                  id={`members-${plan.id}`}
                  label="Maximum members"
                  min="1"
                  name="maxMembers"
                  type="number"
                />
                <FormField
                  defaultValue={plan.limits?.maxHomes ?? ''}
                  id={`homes-${plan.id}`}
                  label="Maximum homes"
                  min="1"
                  name="maxHomes"
                  type="number"
                />
                <FormField
                  defaultValue={plan.limits?.maxStorageMb ?? ''}
                  id={`storage-${plan.id}`}
                  label="Maximum storage MB"
                  min="1"
                  name="maxStorageMb"
                  type="number"
                />
                <FormField
                  defaultValue={plan.priceMinor ?? ''}
                  id={`price-${plan.id}`}
                  label="Price (minor units)"
                  min="0"
                  name="priceMinor"
                  type="number"
                />
                <FormField
                  defaultValue={plan.currency ?? ''}
                  id={`currency-${plan.id}`}
                  label="Currency"
                  maxLength={3}
                  name="currency"
                />
                <Button disabled={busy} type="submit" variant="secondary">
                  Save plan
                </Button>
              </form>
              {plan.status === 'active' ? (
                <Button
                  className="platform-card-action"
                  disabled={busy}
                  onClick={() => setPlanStatus(plan, 'archived')}
                  variant="ghost"
                >
                  Archive plan
                </Button>
              ) : (
                <Button
                  className="platform-card-action"
                  disabled={busy}
                  onClick={() => setPlanStatus(plan, 'active')}
                  variant="ghost"
                >
                  Reactivate plan
                </Button>
              )}
            </Card>
          ))}
          {!data?.plans?.length && <p className="muted-copy">No plans have been configured yet.</p>}
        </div>
      )}
    </section>
  );
}
