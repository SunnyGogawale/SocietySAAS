import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { usePlatformData } from '../platform/usePlatformData.js';

function read(form, name) {
  const field = new FormData(form).get(name);
  return field === '' ? null : field;
}

function readNumber(form, name) {
  const value = read(form, name);
  return value === null ? null : Number(value);
}

function readCheckbox(form, name) {
  return new FormData(form).has(name);
}

function jsonField(form, name) {
  try {
    return JSON.parse(read(form, name));
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
}

function formatDateInput(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export default function SocietySettingsPage() {
  const { activeSociety, refresh: refreshIdentity } = useAuth();
  const isAdmin = activeSociety?.role === 'society_admin';
  const path = activeSociety?.id
    ? `/societies/${encodeURIComponent(activeSociety.id)}/settings`
    : null;
  const { data, error, loading, refresh: refreshSettings, setError } = usePlatformData(path);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const latestChargeRules = data?.chargeRuleHistory?.[0] ?? data?.chargeRules;

  async function save(event, section, convert) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(path, {
        method: 'PATCH',
        body: { [section]: convert(event.currentTarget) },
      });
      await refreshSettings();
      if (section === 'profile') await refreshIdentity();
      setNotice('Society configuration saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!activeSociety) {
    return (
      <section aria-labelledby="page-title">
        <h1 id="page-title">Society settings</h1>
        <Alert tone="info">Select an active society to view its settings.</Alert>
      </section>
    );
  }

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{activeSociety.name}</p>
          <h1 id="page-title">Society settings</h1>
          <p className="page-heading__description">
            {isAdmin
              ? 'Configure society identity, operating rules, billing defaults and communications.'
              : 'View society identity and resident-facing financial settings.'}
          </p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {loading && <LoadingState label="Loading society configuration…" />}
      {data && (
        <div className="settings-stack">
          <Card title="Society identity">
            {isAdmin ? (
              <form
                className="platform-form platform-form--grid"
                onSubmit={(event) =>
                  save(event, 'profile', (form) => ({
                    name: read(form, 'name'),
                    address: read(form, 'address'),
                    contactName: read(form, 'contactName'),
                    contactEmail: read(form, 'contactEmail'),
                    contactPhone: read(form, 'contactPhone'),
                    registrationNumber: read(form, 'registrationNumber'),
                    logoUrl: read(form, 'logoUrl'),
                  }))
                }
              >
                <FormField
                  id="society-name"
                  label="Society name"
                  name="name"
                  required
                  defaultValue={data.society.name}
                />
                <FormField
                  id="registration-number"
                  label="Registration number"
                  name="registrationNumber"
                  defaultValue={data.society.registrationNumber ?? ''}
                />
                <FormField
                  id="society-address"
                  label="Address"
                  name="address"
                  defaultValue={data.society.address ?? ''}
                />
                <FormField
                  id="contact-name"
                  label="Contact name"
                  name="contactName"
                  defaultValue={data.society.contactName ?? ''}
                />
                <FormField
                  id="contact-email"
                  label="Contact email"
                  name="contactEmail"
                  type="email"
                  defaultValue={data.society.contactEmail ?? ''}
                />
                <FormField
                  id="contact-phone"
                  label="Contact phone"
                  name="contactPhone"
                  defaultValue={data.society.contactPhone ?? ''}
                />
                <FormField
                  id="logo-url"
                  label="Logo URL (HTTPS)"
                  name="logoUrl"
                  type="url"
                  defaultValue={data.society.logoUrl ?? ''}
                />
                <div className="platform-form__actions">
                  <Button disabled={busy} type="submit">
                    {busy ? 'Saving…' : 'Save identity'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="settings-readonly">
                <p>
                  <strong>{data.society.name}</strong>
                </p>
                <p>{data.society.address || 'No address configured'}</p>
                {data.society.logoUrl && (
                  <img
                    className="society-logo-preview"
                    src={data.society.logoUrl}
                    alt={`${data.society.name} logo`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            )}
          </Card>

          <Card title="Locale, numbering and society operations">
            <div
              className="settings-brand-preview"
              style={{
                '--brand-primary': data.settings.branding.primaryColor,
                '--brand-accent': data.settings.branding.accentColor,
              }}
            >
              {data.society.logoUrl ? (
                <img
                  alt=""
                  className="settings-brand-preview__logo"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  src={data.society.logoUrl}
                />
              ) : (
                <span aria-hidden="true" className="settings-brand-preview__mark">
                  {data.society.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span>{data.society.name}</span>
            </div>
            {isAdmin ? (
              <form
                className="platform-form platform-form--grid"
                onSubmit={(event) =>
                  save(event, 'settings', (form) => ({
                    timeZone: read(form, 'timeZone'),
                    currency: read(form, 'currency'),
                    dateFormat: read(form, 'dateFormat'),
                    financialYearStartMonth: readNumber(form, 'financialYearStartMonth'),
                    financialYearStartDay: readNumber(form, 'financialYearStartDay'),
                    numbering: {
                      building: read(form, 'buildingNumbering'),
                      wing: read(form, 'wingNumbering'),
                      flat: read(form, 'flatNumbering'),
                    },
                    visitorRules: {
                      requirePreApproval: readCheckbox(form, 'visitorPreApproval'),
                      maxVisitDaysAhead: readNumber(form, 'maxVisitDaysAhead'),
                    },
                    complaintRules: {
                      acknowledgmentHours: readNumber(form, 'acknowledgmentHours'),
                      resolutionTargetHours: readNumber(form, 'resolutionTargetHours'),
                    },
                    notificationRules: {
                      emailEnabled: readCheckbox(form, 'emailEnabled'),
                      pushEnabled: readCheckbox(form, 'pushEnabled'),
                      smsEnabled: readCheckbox(form, 'smsEnabled'),
                    },
                    facilityBookingRules: {
                      maxDaysAhead: readNumber(form, 'bookingMaxDaysAhead'),
                      requireApproval: readCheckbox(form, 'bookingRequiresApproval'),
                      maxBookingsPerDay: readNumber(form, 'maxBookingsPerDay'),
                    },
                    branding: {
                      primaryColor: read(form, 'primaryColor'),
                      accentColor: read(form, 'accentColor'),
                    },
                  }))
                }
              >
                <FormField
                  id="time-zone"
                  label="IANA time zone"
                  name="timeZone"
                  required
                  defaultValue={data.settings.timeZone}
                />
                <FormField
                  id="currency"
                  label="Currency code"
                  name="currency"
                  required
                  maxLength={3}
                  defaultValue={data.settings.currency}
                />
                <FormField
                  as="select"
                  id="date-format"
                  label="Date format"
                  name="dateFormat"
                  defaultValue={data.settings.dateFormat}
                >
                  {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((format) => (
                    <option key={format}>{format}</option>
                  ))}
                </FormField>
                <FormField
                  as="select"
                  id="fy-month"
                  label="Financial year start month"
                  name="financialYearStartMonth"
                  defaultValue={data.settings.financialYearStartMonth}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {new Date(2000, index).toLocaleString('en', { month: 'long' })}
                    </option>
                  ))}
                </FormField>
                <FormField
                  id="fy-day"
                  label="Financial year start day"
                  name="financialYearStartDay"
                  type="number"
                  min="1"
                  max="31"
                  defaultValue={data.settings.financialYearStartDay}
                />
                <FormField
                  id="building-numbering"
                  label="Building numbering pattern"
                  name="buildingNumbering"
                  defaultValue={data.settings.numbering.building}
                />
                <FormField
                  id="wing-numbering"
                  label="Wing numbering pattern"
                  name="wingNumbering"
                  defaultValue={data.settings.numbering.wing}
                />
                <FormField
                  id="flat-numbering"
                  label="Flat numbering pattern"
                  name="flatNumbering"
                  defaultValue={data.settings.numbering.flat}
                />
                <FormField
                  id="max-visit-days"
                  label="Visitor bookings allowed ahead (days)"
                  name="maxVisitDaysAhead"
                  type="number"
                  min="0"
                  max="365"
                  defaultValue={data.settings.visitorRules.maxVisitDaysAhead}
                />
                <FormField
                  id="ack-hours"
                  label="Complaint acknowledgment target (hours)"
                  name="acknowledgmentHours"
                  type="number"
                  min="1"
                  max="720"
                  defaultValue={data.settings.complaintRules.acknowledgmentHours}
                />
                <FormField
                  id="resolution-hours"
                  label="Complaint resolution target (hours)"
                  name="resolutionTargetHours"
                  type="number"
                  min="1"
                  max="8760"
                  defaultValue={data.settings.complaintRules.resolutionTargetHours}
                />
                <FormField
                  id="booking-days"
                  label="Facility booking allowed ahead (days)"
                  name="bookingMaxDaysAhead"
                  type="number"
                  min="0"
                  max="365"
                  defaultValue={data.settings.facilityBookingRules.maxDaysAhead}
                />
                <FormField
                  id="booking-cap"
                  label="Maximum bookings per day"
                  name="maxBookingsPerDay"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={data.settings.facilityBookingRules.maxBookingsPerDay}
                />
                <FormField
                  id="primary-color"
                  label="Primary brand color"
                  name="primaryColor"
                  type="color"
                  defaultValue={data.settings.branding.primaryColor}
                />
                <FormField
                  id="accent-color"
                  label="Accent brand color"
                  name="accentColor"
                  type="color"
                  defaultValue={data.settings.branding.accentColor}
                />
                <div className="settings-checks">
                  <label>
                    <input
                      defaultChecked={data.settings.visitorRules.requirePreApproval}
                      name="visitorPreApproval"
                      type="checkbox"
                    />{' '}
                    Require visitor pre-approval
                  </label>
                  <label>
                    <input
                      defaultChecked={data.settings.facilityBookingRules.requireApproval}
                      name="bookingRequiresApproval"
                      type="checkbox"
                    />{' '}
                    Require facility booking approval
                  </label>
                  <label>
                    <input
                      defaultChecked={data.settings.notificationRules.emailEnabled}
                      name="emailEnabled"
                      type="checkbox"
                    />{' '}
                    Enable email notifications
                  </label>
                  <label>
                    <input
                      defaultChecked={data.settings.notificationRules.pushEnabled}
                      name="pushEnabled"
                      type="checkbox"
                    />{' '}
                    Enable push notifications
                  </label>
                  <label>
                    <input
                      defaultChecked={data.settings.notificationRules.smsEnabled}
                      name="smsEnabled"
                      type="checkbox"
                    />{' '}
                    Enable SMS notifications
                  </label>
                </div>
                <div className="platform-form__actions">
                  <Button disabled={busy} type="submit">
                    {busy ? 'Saving…' : 'Save society settings'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="settings-readonly">
                <p>
                  Time zone: <strong>{data.settings.timeZone}</strong>
                </p>
                <p>
                  Currency: <strong>{data.settings.currency}</strong>
                </p>
                <p>
                  Date format: <strong>{data.settings.dateFormat}</strong>
                </p>
                <p>
                  Financial year starts:{' '}
                  <strong>
                    {data.settings.financialYearStartMonth}/{data.settings.financialYearStartDay}
                  </strong>
                </p>
                <p>
                  Building / wing / flat:{' '}
                  <strong>
                    {data.settings.numbering.building} / {data.settings.numbering.wing} /{' '}
                    {data.settings.numbering.flat}
                  </strong>
                </p>
              </div>
            )}
          </Card>

          {!isAdmin && data.chargeRules && (
            <Card title="Maintenance schedule">
              <div className="settings-readonly">
                <p>
                  Frequency: <strong>{data.chargeRules.frequency.replaceAll('_', ' ')}</strong>
                </p>
                <p>
                  Due day of period: <strong>{data.chargeRules.dueDayOfPeriod}</strong>
                </p>
                <p>
                  Grace period: <strong>{data.chargeRules.gracePeriodDays} days</strong>
                </p>
                <p>
                  Effective from:{' '}
                  <strong>{new Date(data.chargeRules.effectiveFrom).toLocaleDateString()}</strong>
                </p>
                <p>
                  Configured charges:{' '}
                  <strong>
                    {data.chargeRules.charges.map((charge) => charge.name).join(', ')}
                  </strong>
                </p>
              </div>
            </Card>
          )}

          {isAdmin && (
            <>
              <Card title="Maintenance charge rules">
                <p className="muted-copy">
                  Saving creates a new, dated version. It does not update previously issued bills.
                </p>
                <form
                  className="platform-form platform-form--grid"
                  onSubmit={(event) =>
                    save(event, 'chargeRules', (form) => {
                      const lateFeeType = read(form, 'lateFeeType');
                      const lateFee =
                        lateFeeType === 'fixed'
                          ? { type: 'fixed', amountMinor: readNumber(form, 'lateFeeAmountMinor') }
                          : lateFeeType === 'percentage'
                            ? {
                                type: 'percentage',
                                rateBasisPoints: readNumber(form, 'lateFeeBasisPoints'),
                              }
                            : { type: 'none' };
                      return {
                        effectiveFrom: `${read(form, 'effectiveFrom')}T00:00:00.000Z`,
                        frequency: read(form, 'frequency'),
                        areaUnit: read(form, 'areaUnit'),
                        charges: jsonField(form, 'charges'),
                        dueDayOfPeriod: readNumber(form, 'dueDayOfPeriod'),
                        lateFee,
                        gracePeriodDays: readNumber(form, 'gracePeriodDays'),
                      };
                    })
                  }
                >
                  <FormField
                    id="effective-from"
                    label="Effective from"
                    name="effectiveFrom"
                    type="date"
                    defaultValue={formatDateInput(latestChargeRules?.effectiveFrom)}
                    required
                  />
                  <FormField
                    as="select"
                    id="charge-frequency"
                    label="Billing frequency"
                    name="frequency"
                    defaultValue={latestChargeRules?.frequency ?? 'monthly'}
                  >
                    {['monthly', 'quarterly', 'half_yearly', 'yearly'].map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {frequency.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </FormField>
                  <FormField
                    id="charge-due-day"
                    label="Due day of billing period"
                    name="dueDayOfPeriod"
                    type="number"
                    min="1"
                    max="28"
                    defaultValue={latestChargeRules?.dueDayOfPeriod ?? 10}
                  />
                  <FormField
                    as="select"
                    id="charge-area-unit"
                    label="Area unit (for area-based charges)"
                    name="areaUnit"
                    defaultValue={latestChargeRules?.areaUnit ?? ''}
                  >
                    <option value="">Not used</option>
                    <option value="square_foot">Square foot</option>
                    <option value="square_metre">Square metre</option>
                  </FormField>
                  <FormField
                    id="grace-period"
                    label="Grace period (days)"
                    name="gracePeriodDays"
                    type="number"
                    min="0"
                    max="365"
                    defaultValue={latestChargeRules?.gracePeriodDays ?? 7}
                  />
                  <FormField
                    as="select"
                    id="late-fee-type"
                    label="Late fee"
                    name="lateFeeType"
                    defaultValue={latestChargeRules?.lateFee?.type ?? 'none'}
                  >
                    <option value="none">None</option>
                    <option value="fixed">Fixed amount</option>
                    <option value="percentage">Percentage</option>
                  </FormField>
                  <FormField
                    id="late-fee-amount"
                    label="Fixed fee (minor currency units)"
                    name="lateFeeAmountMinor"
                    type="number"
                    min="0"
                    defaultValue={latestChargeRules?.lateFee?.amountMinor ?? 0}
                  />
                  <FormField
                    id="late-fee-rate"
                    label="Percentage (basis points)"
                    name="lateFeeBasisPoints"
                    type="number"
                    min="0"
                    max="10000"
                    defaultValue={latestChargeRules?.lateFee?.rateBasisPoints ?? 0}
                  />
                  <FormField
                    as="textarea"
                    id="charge-items"
                    label="Charge items (JSON)"
                    name="charges"
                    hint='Example: [{"code":"maintenance","name":"Maintenance","calculation":"fixed_per_home","amountMinor":100000}]'
                    defaultValue={JSON.stringify(
                      latestChargeRules?.charges ?? [
                        {
                          code: 'maintenance',
                          name: 'Maintenance',
                          calculation: 'fixed_per_home',
                          amountMinor: 0,
                        },
                      ],
                      null,
                      2,
                    )}
                    rows={5}
                  />
                  <div className="platform-form__actions">
                    <Button disabled={busy} type="submit">
                      {busy ? 'Saving…' : 'Create new charge-rule version'}
                    </Button>
                  </div>
                </form>
                {data.chargeRuleHistory?.length > 0 && (
                  <ul className="settings-history">
                    {data.chargeRuleHistory.map((rule) => (
                      <li key={rule.id}>
                        Version {rule.version} · effective{' '}
                        {new Date(rule.effectiveFrom).toLocaleDateString()} · {rule.frequency}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Approval policies">
                <p className="muted-copy">
                  Policies are stored for use by the relevant workflows; those workflows are
                  separate from configuration.
                </p>
                <form
                  className="platform-form"
                  onSubmit={(event) =>
                    save(event, 'approvalPolicies', (form) => ({
                      policies: jsonField(form, 'policies'),
                    }))
                  }
                >
                  <FormField
                    as="textarea"
                    id="approval-policies"
                    label="Operation policies (JSON)"
                    name="policies"
                    hint="Use keys such as expense, facility_booking, notice, or visitor_preapproval; custom lowercase keys are supported."
                    defaultValue={JSON.stringify(data.approvalPolicies ?? [], null, 2)}
                    rows={7}
                  />
                  <Button disabled={busy} type="submit">
                    {busy ? 'Saving…' : 'Save approval policies'}
                  </Button>
                </form>
              </Card>

              <Card title="Notification templates">
                <p className="muted-copy">
                  Templates are configured here; delivery and template-variable rendering are not
                  part of this settings module.
                </p>
                <form
                  className="platform-form"
                  onSubmit={(event) =>
                    save(event, 'notificationTemplates', (form) => ({
                      templates: jsonField(form, 'templates'),
                    }))
                  }
                >
                  <FormField
                    as="textarea"
                    id="notification-templates"
                    label="Templates (JSON)"
                    name="templates"
                    hint="Each template needs key, channel (email/sms/push), body, and enabled; email can include a subject."
                    defaultValue={JSON.stringify(data.notificationTemplates ?? [], null, 2)}
                    rows={8}
                  />
                  <Button disabled={busy} type="submit">
                    {busy ? 'Saving…' : 'Save notification templates'}
                  </Button>
                </form>
              </Card>
            </>
          )}
        </div>
      )}
    </section>
  );
}
