import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiRequest } from '../api/client.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card } from '../components/ui/Card.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { FormField } from '../components/ui/FormField.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { downloadCsv, usePlatformData } from '../platform/usePlatformData.js';

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.size ? `?${params}` : '';
}

export default function PropertyManagementPage() {
  const { activeSociety } = useAuth();
  const [search, setSearch] = useState('');
  const [residentSearch, setResidentSearch] = useState('');
  const [residentStatus, setResidentStatus] = useState('');
  const [residentType, setResidentType] = useState('');
  const [residentSort, setResidentSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [residentPage, setResidentPage] = useState(1);
  const [occupancyFilter, setOccupancyFilter] = useState('');
  const [selectedVehicleFlatId, setSelectedVehicleFlatId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [importText, setImportText] = useState('');
  const [importType, setImportType] = useState('properties');
  const [importErrorPath, setImportErrorPath] = useState('');
  const [sort, setSort] = useState('flatNumber');
  const [direction, setDirection] = useState('asc');
  const societyPath = activeSociety?.id
    ? `/societies/${encodeURIComponent(activeSociety.id)}`
    : null;
  const {
    data: structure,
    error: structureError,
    loading: structureLoading,
    refresh: refreshStructure,
  } = usePlatformData(societyPath ? `${societyPath}/properties/structure` : null);
  const propertyQuery = queryString({
    q: search.trim(),
    occupancyStatus: occupancyFilter,
    sort,
    direction,
    page,
    limit: 20,
  });
  const propertiesDataPath = societyPath ? `${societyPath}/properties${propertyQuery}` : null;
  const {
    data: propertiesResult,
    error: propertiesError,
    loading: propertiesLoading,
    refresh: refreshProperties,
  } = usePlatformData(propertiesDataPath);
  const { data: propertyOptionsResult, refresh: refreshPropertyOptions } = usePlatformData(
    societyPath
      ? `${societyPath}/properties${queryString({ q: search.trim(), limit: 100 })}`
      : null,
  );
  const residentQuery = queryString({
    q: residentSearch.trim(),
    status: residentStatus,
    residentType,
    sort: residentSort,
    page: residentPage,
    limit: 20,
  });
  const residentsPath = societyPath ? `${societyPath}/residents${residentQuery}` : null;
  const {
    data: residentsResult,
    error: residentsError,
    loading: residentsLoading,
    refresh: refreshResidents,
  } = usePlatformData(residentsPath);
  const {
    data: parkingResult,
    error: parkingError,
    refresh: refreshParking,
  } = usePlatformData(societyPath ? `${societyPath}/parking-slots` : null);
  const {
    data: vehiclesResult,
    error: vehiclesError,
    refresh: refreshVehicles,
  } = usePlatformData(societyPath ? `${societyPath}/vehicles?limit=100` : null);
  const properties = useMemo(() => propertiesResult?.properties ?? [], [propertiesResult]);
  const residents = residentsResult?.residents ?? [];
  const buildings = structure?.buildings ?? [];
  const wings = structure?.wings ?? [];
  const floors = structure?.floors ?? [];
  const flatOptions = useMemo(
    () =>
      (propertyOptionsResult?.properties ?? []).map((property) => ({
        id: property.id,
        label: `${property.flatNumber} · ${property.building?.name ?? ''}`,
        owners: property.owners,
      })),
    [propertyOptionsResult],
  );
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const buildingWings = wings.filter(
    (wing) => wing.buildingId === selectedBuildingId || wing.buildingId?._id === selectedBuildingId,
  );
  const buildingFloors = floors.filter(
    (floor) =>
      floor.buildingId === selectedBuildingId || floor.buildingId?._id === selectedBuildingId,
  );
  const selectedVehicleOwners =
    flatOptions.find((flat) => flat.id === selectedVehicleFlatId)?.owners ?? [];
  const parkingSlots = parkingResult?.parkingSlots ?? [];
  const vehicles = vehiclesResult?.vehicles ?? [];
  const dataError = [structureError, propertiesError, residentsError, parkingError, vehiclesError]
    .filter(Boolean)
    .join(' ');

  async function runAction(action, successMessage, actionName = 'action') {
    setBusy(actionName);
    setError('');
    setNotice('');
    try {
      const actionMessage = await action();
      await Promise.all([
        refreshStructure(),
        refreshProperties(),
        refreshPropertyOptions(),
        refreshResidents(),
        refreshParking(),
        refreshVehicles(),
      ]);
      setNotice(typeof actionMessage === 'string' ? actionMessage : successMessage);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy('');
    }
  }

  async function submitForm(event, endpoint, body, message) {
    event.preventDefault();
    const form = event.currentTarget;
    await runAction(async () => {
      await apiRequest(`${societyPath}${endpoint}`, { method: 'POST', body: body(form) });
      form.reset();
    }, message);
  }

  async function download(path, filename) {
    setError('');
    try {
      const truncated = await downloadCsv(`${societyPath}${path}`, filename);
      setNotice(
        truncated
          ? 'Export downloaded. The result was capped at 5,000 rows.'
          : 'Export downloaded.',
      );
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  async function endResident(resident) {
    if (!window.confirm(`End this ${resident.residentType.replace('_', ' ')} record?`)) return;
    const isOwnership = ['owner', 'co_owner'].includes(resident.residentType);
    await runAction(
      () =>
        apiRequest(
          `${societyPath}/${isOwnership ? 'ownerships' : 'occupancies'}/${resident.id}/end`,
          { method: 'PATCH', body: {} },
        ),
      'Resident record ended. Access was reviewed against other active property links.',
    );
  }

  async function submitImport(event) {
    event.preventDefault();
    let records;
    try {
      records = JSON.parse(importText);
      if (!Array.isArray(records)) throw new Error('Provide a JSON array of records.');
    } catch (parseError) {
      setError(parseError.message);
      return;
    }
    await runAction(
      async () => {
        const result = await apiRequest(`${societyPath}/property-imports`, {
          method: 'POST',
          body: { type: importType, records },
        });
        setImportErrorPath(result.errorReportUrl);
        setImportText('');
        return `Import finished: ${result.createdCount} created, ${result.errorCount} errors.`;
      },
      'Import complete.',
      'import',
    );
  }

  if (!activeSociety) {
    return (
      <section aria-labelledby="page-title">
        <h1 id="page-title">Properties and residents</h1>
        <Alert tone="info">Select an active society to manage properties and residents.</Alert>
      </section>
    );
  }

  const propertyPagination = propertiesResult?.pagination;
  const residentPagination = residentsResult?.pagination;

  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{activeSociety.name}</p>
          <h1 id="page-title">Properties and residents</h1>
          <p className="page-heading__description">
            Manage the property hierarchy, household links, occupancy, parking and authorized
            imports.
          </p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {dataError && <Alert tone="danger">{dataError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {(structureLoading || propertiesLoading) && (
        <LoadingState label="Loading society properties" />
      )}

      <div className="settings-stack">
        <Card title="Property structure">
          <div className="platform-form platform-form--grid">
            <form
              className="platform-form"
              onSubmit={(event) =>
                submitForm(event, '/buildings', (form) => formValues(form), 'Building created.')
              }
            >
              <FormField id="building-name" label="Building name" name="name" required />
              <FormField id="building-code" label="Building code" name="code" required />
              <Button disabled={Boolean(busy)} type="submit">
                Add building
              </Button>
            </form>
            <form
              className="platform-form"
              onSubmit={(event) =>
                submitForm(
                  event,
                  '/wings',
                  (form) => ({ ...formValues(form), buildingId: selectedBuildingId }),
                  'Wing created.',
                )
              }
            >
              <FormField
                as="select"
                id="wing-building"
                label="Building for wing"
                value={selectedBuildingId}
                onChange={(event) => setSelectedBuildingId(event.target.value)}
              >
                <option value="">Select a building</option>
                {buildings.map((building) => (
                  <option key={building._id} value={building._id}>
                    {building.name}
                  </option>
                ))}
              </FormField>
              <FormField id="wing-name" label="Wing name" name="name" required />
              <FormField id="wing-code" label="Wing code" name="code" required />
              <Button disabled={!selectedBuildingId || Boolean(busy)} type="submit">
                Add wing
              </Button>
            </form>
            <form
              className="platform-form"
              onSubmit={(event) =>
                submitForm(
                  event,
                  '/floors',
                  (form) => {
                    const values = formValues(form);
                    return {
                      ...values,
                      buildingId: selectedBuildingId,
                      wingId: values.wingId || null,
                      floorNumber: Number(values.floorNumber),
                    };
                  },
                  'Floor created.',
                )
              }
            >
              <FormField
                as="select"
                id="floor-building"
                label="Building for floor"
                value={selectedBuildingId}
                onChange={(event) => setSelectedBuildingId(event.target.value)}
              >
                <option value="">Select a building</option>
                {buildings.map((building) => (
                  <option key={building._id} value={building._id}>
                    {building.name}
                  </option>
                ))}
              </FormField>
              <FormField as="select" id="floor-wing" label="Wing (optional)" name="wingId">
                <option value="">No wing</option>
                {buildingWings.map((wing) => (
                  <option key={wing._id} value={wing._id}>
                    {wing.name}
                  </option>
                ))}
              </FormField>
              <FormField
                id="floor-number"
                label="Floor number"
                name="floorNumber"
                type="number"
                required
              />
              <FormField id="floor-label" label="Floor label" name="label" />
              <Button disabled={!selectedBuildingId || Boolean(busy)} type="submit">
                Add floor
              </Button>
            </form>
          </div>

          <form
            className="platform-form platform-form--grid"
            onSubmit={(event) =>
              submitForm(
                event,
                '/flats',
                (form) => {
                  const values = formValues(form);
                  return {
                    ...values,
                    buildingId: selectedBuildingId,
                    wingId: values.wingId || null,
                    area: Number(values.area),
                  };
                },
                'Flat created.',
              )
            }
          >
            <FormField
              as="select"
              id="flat-building"
              label="Building for flat"
              value={selectedBuildingId}
              onChange={(event) => setSelectedBuildingId(event.target.value)}
            >
              <option value="">Select a building</option>
              {buildings.map((building) => (
                <option key={building._id} value={building._id}>
                  {building.name}
                </option>
              ))}
            </FormField>
            <FormField as="select" id="flat-wing" label="Wing" name="wingId">
              <option value="">No wing</option>
              {buildingWings.map((wing) => (
                <option key={wing._id} value={wing._id}>
                  {wing.name}
                </option>
              ))}
            </FormField>
            <FormField as="select" id="flat-floor" label="Floor" name="floorId" required>
              <option value="">Select a floor</option>
              {buildingFloors.map((floor) => (
                <option key={floor._id} value={floor._id}>
                  {floor.label || floor.floorNumber}
                </option>
              ))}
            </FormField>
            <FormField id="flat-number" label="Flat number" name="flatNumber" required />
            <FormField id="flat-area" label="Area" name="area" type="number" min="1" required />
            <FormField as="select" id="flat-area-unit" label="Area unit" name="areaUnit" required>
              <option value="">Select unit</option>
              <option value="square_foot">Square foot</option>
              <option value="square_metre">Square metre</option>
            </FormField>
            <FormField as="select" id="flat-type" label="Property type" name="propertyType">
              {['apartment', 'penthouse', 'studio', 'commercial', 'other'].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </FormField>
            <Button disabled={!selectedBuildingId || Boolean(busy)} type="submit">
              Add flat
            </Button>
          </form>
        </Card>

        <Card title="Flats and parking">
          <div className="platform-form platform-form--grid">
            <FormField
              id="property-search"
              label="Search flats"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <FormField
              as="select"
              id="occupancy-filter"
              label="Occupancy"
              value={occupancyFilter}
              onChange={(event) => {
                setOccupancyFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="vacant">Vacant</option>
              <option value="occupied">Occupied</option>
              <option value="partially_occupied">Partially occupied</option>
            </FormField>
            <FormField
              as="select"
              id="property-sort"
              label="Sort by"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="flatNumber">Flat number</option>
              <option value="area">Area</option>
              <option value="createdAt">Date added</option>
            </FormField>
            <FormField
              as="select"
              id="property-sort-direction"
              label="Direction"
              value={direction}
              onChange={(event) => {
                setDirection(event.target.value);
                setPage(1);
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </FormField>
            <Button
              onClick={() =>
                download(
                  `/properties/export${queryString({
                    q: search.trim(),
                    occupancyStatus: occupancyFilter,
                    sort,
                    direction,
                  })}`,
                  'properties.csv',
                )
              }
              variant="secondary"
            >
              Export properties
            </Button>
          </div>
          <DataTable
            caption="Society property listings"
            columns={[
              { key: 'flatNumber', label: 'Flat' },
              { key: 'building', label: 'Building', render: (building) => building?.name ?? '—' },
              { key: 'wing', label: 'Wing', render: (wing) => wing?.name ?? '—' },
              {
                key: 'area',
                label: 'Area',
                render: (area, property) =>
                  `${area} ${property.areaUnit?.replace('_', ' ') ?? ''}`.trim(),
              },
              {
                key: 'occupancyStatus',
                label: 'Status',
                render: (status) => (
                  <StatusBadge
                    tone={
                      status === 'occupied'
                        ? 'success'
                        : status === 'partially_occupied'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {status?.replaceAll('_', ' ') ?? 'unknown'}
                  </StatusBadge>
                ),
              },
              {
                key: 'owners',
                label: 'Owners',
                render: (owners) => owners?.map((owner) => owner.name).join(', ') || '—',
              },
              {
                key: 'parkingSlots',
                label: 'Parking slots',
                render: (slots) => slots?.map((slot) => slot.slotNumber).join(', ') || '—',
              },
            ]}
            rows={properties}
            emptyMessage="No flats match this search."
          />
          <div className="platform-form__actions">
            <Button
              disabled={!propertyPagination || page <= 1}
              onClick={() => setPage((value) => value - 1)}
              variant="secondary"
            >
              Previous
            </Button>
            <span aria-live="polite">
              Page {propertyPagination?.page ?? page} of {propertyPagination?.pageCount ?? 0}
            </span>
            <Button
              disabled={!propertyPagination || page >= propertyPagination.pageCount}
              onClick={() => setPage((value) => value + 1)}
              variant="secondary"
            >
              Next
            </Button>
          </div>
          <div className="settings-stack">
            <form
              className="platform-form platform-form--grid"
              onSubmit={(event) =>
                submitForm(
                  event,
                  '/parking-slots',
                  (form) => ({
                    ...formValues(form),
                    buildingId: selectedBuildingId,
                    flatId: formValues(form).flatId || null,
                  }),
                  'Parking slot created.',
                )
              }
            >
              <h3>Add parking slot</h3>
              <FormField
                as="select"
                id="parking-building"
                label="Building"
                value={selectedBuildingId}
                onChange={(event) => setSelectedBuildingId(event.target.value)}
              >
                <option value="">Select a building</option>
                {buildings.map((building) => (
                  <option key={building._id} value={building._id}>
                    {building.name}
                  </option>
                ))}
              </FormField>
              <FormField
                as="select"
                id="parking-flat"
                label="Reserved flat (optional)"
                name="flatId"
              >
                <option value="">Shared slot</option>
                {flatOptions.map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.label}
                  </option>
                ))}
              </FormField>
              <FormField id="parking-slot-number" label="Slot number" name="slotNumber" required />
              <FormField id="parking-location" label="Location" name="location" />
              <Button disabled={!selectedBuildingId || Boolean(busy)} type="submit">
                Add slot
              </Button>
            </form>

            <form
              className="platform-form platform-form--grid"
              onSubmit={(event) => {
                submitForm(
                  event,
                  `/flats/${selectedVehicleFlatId}/vehicles`,
                  (form) => {
                    const row = formValues(form);
                    return { ...row, membershipId: row.membershipId || null, occupancyId: null };
                  },
                  'Vehicle registered.',
                );
              }}
            >
              <h3>Register vehicle</h3>
              <FormField
                as="select"
                id="vehicle-flat"
                label="Flat"
                value={selectedVehicleFlatId}
                onChange={(event) => setSelectedVehicleFlatId(event.target.value)}
                required
              >
                <option value="">Select a flat</option>
                {flatOptions.map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.label}
                  </option>
                ))}
              </FormField>
              <FormField
                id="vehicle-registration"
                label="Registration number"
                name="registrationNumber"
                required
              />
              <FormField as="select" id="vehicle-type" label="Vehicle type" name="vehicleType">
                {['car', 'motorcycle', 'bicycle', 'other'].map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </FormField>
              <FormField
                as="select"
                id="vehicle-membership"
                label="Owner"
                name="membershipId"
                required
              >
                <option value="">Select an owner</option>
                {selectedVehicleOwners.map((owner) => (
                  <option key={owner.membershipId} value={owner.membershipId}>
                    {owner.name}
                  </option>
                ))}
              </FormField>
              <FormField id="vehicle-make" label="Make" name="make" />
              <FormField id="vehicle-model" label="Model" name="model" />
              <Button disabled={Boolean(busy)} type="submit">
                Register vehicle
              </Button>
            </form>

            <form
              className="platform-form platform-form--grid"
              onSubmit={(event) =>
                submitForm(
                  event,
                  `/parking-slots/${formValues(event.currentTarget).parkingSlotId}/assign`,
                  (form) => {
                    const values = formValues(form);
                    return { flatId: values.flatId, vehicleId: values.vehicleId };
                  },
                  'Parking assigned.',
                )
              }
            >
              <h3>Assign parking</h3>
              <FormField
                as="select"
                id="assignment-slot"
                label="Parking slot"
                name="parkingSlotId"
                required
              >
                <option value="">Select a slot</option>
                {parkingSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.slotNumber} · {slot.building?.name}
                  </option>
                ))}
              </FormField>
              <FormField as="select" id="assignment-flat" label="Flat" name="flatId" required>
                <option value="">Select a flat</option>
                {flatOptions.map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.label}
                  </option>
                ))}
              </FormField>
              <FormField
                as="select"
                id="assignment-vehicle"
                label="Vehicle"
                name="vehicleId"
                required
              >
                <option value="">Select a vehicle</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber} · {vehicle.flat?.flatNumber}
                  </option>
                ))}
              </FormField>
              <Button disabled={Boolean(busy)} type="submit">
                Assign slot
              </Button>
            </form>
          </div>
        </Card>

        <Card title="Owners and occupancy">
          <form
            className="platform-form platform-form--grid"
            onSubmit={(event) =>
              submitForm(
                event,
                `/flats/${formValues(event.currentTarget).flatId}/owners/invite`,
                (form) => {
                  const values = formValues(form);
                  return { email: values.email, ownershipType: values.ownershipType };
                },
                'Owner invited or linked.',
              )
            }
          >
            <FormField as="select" id="owner-flat" label="Flat" name="flatId" required>
              <option value="">Select a flat</option>
              {flatOptions.map((flat) => (
                <option key={flat.id} value={flat.id}>
                  {flat.label}
                </option>
              ))}
            </FormField>
            <FormField id="owner-email" label="Owner email" name="email" type="email" required />
            <FormField as="select" id="ownership-type" label="Ownership type" name="ownershipType">
              <option value="owner">Owner</option>
              <option value="co_owner">Co-owner</option>
            </FormField>
            <Button disabled={Boolean(busy)} type="submit">
              Invite or link owner
            </Button>
          </form>
          <form
            className="platform-form platform-form--grid"
            onSubmit={(event) =>
              submitForm(
                event,
                `/flats/${formValues(event.currentTarget).flatId}/occupancies`,
                (form) => {
                  const occupancy = formValues(form);
                  delete occupancy.flatId;
                  return {
                    ...occupancy,
                    startsAt: new Date(occupancy.startsAt).toISOString(),
                    endsAt: occupancy.endsAt ? new Date(occupancy.endsAt).toISOString() : null,
                    email: occupancy.email || null,
                    phone: occupancy.phone || null,
                    leaseReference: occupancy.leaseReference || null,
                  };
                },
                'Occupancy recorded.',
              )
            }
          >
            <FormField as="select" id="occupancy-flat" label="Flat" name="flatId" required>
              <option value="">Select a flat</option>
              {flatOptions.map((flat) => (
                <option key={flat.id} value={flat.id}>
                  {flat.label}
                </option>
              ))}
            </FormField>
            <FormField as="select" id="occupant-type" label="Resident type" name="residentType">
              <option value="tenant">Tenant</option>
              <option value="authorized_occupant">Authorized occupant</option>
            </FormField>
            <FormField id="occupant-name" label="Name" name="name" required />
            <FormField id="occupant-email" label="Email" name="email" type="email" />
            <FormField id="occupant-phone" label="Phone" name="phone" />
            <FormField
              id="occupancy-start"
              label="Move-in date"
              name="startsAt"
              type="date"
              required
            />
            <FormField
              id="occupancy-end"
              label="Move-out date (optional)"
              name="endsAt"
              type="date"
            />
            <FormField
              id="lease-reference"
              label="Lease reference (optional)"
              name="leaseReference"
            />
            <Button disabled={Boolean(busy)} type="submit">
              Record occupancy
            </Button>
          </form>
        </Card>

        <Card title="Resident directory">
          <div className="platform-form platform-form--grid">
            <FormField
              id="resident-search"
              label="Search residents"
              value={residentSearch}
              onChange={(event) => {
                setResidentSearch(event.target.value);
                setResidentPage(1);
              }}
            />
            <FormField
              as="select"
              id="resident-status-filter"
              label="Resident status"
              value={residentStatus}
              onChange={(event) => {
                setResidentStatus(event.target.value);
                setResidentPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="invited">Invited</option>
              <option value="active">Active</option>
              <option value="ended">Ended</option>
            </FormField>
            <FormField
              as="select"
              id="resident-type-filter"
              label="Resident type"
              value={residentType}
              onChange={(event) => {
                setResidentType(event.target.value);
                setResidentPage(1);
              }}
            >
              <option value="">All resident types</option>
              <option value="owner">Owner</option>
              <option value="co_owner">Co-owner</option>
              <option value="tenant">Tenant</option>
              <option value="authorized_occupant">Authorized occupant</option>
            </FormField>
            <FormField
              as="select"
              id="resident-sort-filter"
              label="Sort by"
              value={residentSort}
              onChange={(event) => {
                setResidentSort(event.target.value);
                setResidentPage(1);
              }}
            >
              <option value="newest">Most recent</option>
              <option value="oldest">Oldest</option>
            </FormField>
            <Button
              onClick={() =>
                download(
                  `/residents/export${queryString({
                    q: residentSearch.trim(),
                    residentType,
                    status: residentStatus,
                    sort: residentSort,
                  })}`,
                  'residents.csv',
                )
              }
              variant="secondary"
            >
              Export residents
            </Button>
          </div>
          {residentsLoading && <LoadingState label="Loading residents" />}
          <DataTable
            caption="Society resident directory"
            columns={[
              { key: 'name', label: 'Resident' },
              { key: 'residentType', label: 'Type' },
              { key: 'email', label: 'Email' },
              { key: 'phone', label: 'Phone' },
              { key: 'flatNumber', label: 'Flat' },
              {
                key: 'status',
                label: 'Status',
                render: (status) => (
                  <StatusBadge
                    tone={
                      status === 'active' ? 'success' : status === 'invited' ? 'info' : 'neutral'
                    }
                  >
                    {status}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (_, resident) =>
                  resident.status === 'ended' ? (
                    '—'
                  ) : (
                    <Button
                      onClick={() => endResident(resident)}
                      variant="secondary"
                      disabled={Boolean(busy)}
                    >
                      End record
                    </Button>
                  ),
              },
            ]}
            rows={residents}
            emptyMessage="No residents found."
          />
          <div className="platform-form__actions">
            <Button
              disabled={!residentPagination || residentPage <= 1}
              onClick={() => setResidentPage((value) => value - 1)}
              variant="secondary"
            >
              Previous
            </Button>
            <span aria-live="polite">
              Page {residentPagination?.page ?? residentPage} of{' '}
              {residentPagination?.pageCount ?? 0}
            </span>
            <Button
              disabled={!residentPagination || residentPage >= residentPagination.pageCount}
              onClick={() => setResidentPage((value) => value + 1)}
              variant="secondary"
            >
              Next
            </Button>
          </div>
        </Card>

        <Card title="Bulk import">
          <form className="platform-form" onSubmit={submitImport}>
            <FormField
              as="select"
              id="import-type"
              label="Import type"
              value={importType}
              onChange={(event) => setImportType(event.target.value)}
            >
              <option value="properties">Properties</option>
              <option value="residents">Residents</option>
            </FormField>
            <FormField
              as="textarea"
              id="import-json"
              label="JSON records"
              hint={
                importType === 'properties'
                  ? 'Each row needs buildingCode, floorNumber, flatNumber, area, areaUnit (square_foot or square_metre) and propertyType; optional buildingName, wingCode, wingName and floorLabel.'
                  : 'Each row needs flatId and email; optional ownershipType (owner or co_owner). Maximum 500 rows.'
              }
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={7}
              required
            />
            <Button disabled={Boolean(busy)} type="submit">
              {busy === 'import' ? 'Importing…' : 'Import records'}
            </Button>
          </form>
          {importErrorPath ? (
            <Button
              onClick={() =>
                download(
                  importErrorPath.replace(`/api/v1/societies/${activeSociety.id}`, ''),
                  'import-errors.csv',
                )
              }
              variant="secondary"
            >
              Download latest import errors
            </Button>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
