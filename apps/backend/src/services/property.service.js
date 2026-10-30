const { AppError } = require('../utils/AppError');
const propertySchemas = require('../validators/property.validators');

const EXPORT_LIMIT = 5000;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join(
    '\r\n',
  );
}

function createPropertyService({ models, audit, membershipService, clock = () => new Date() }) {
  const {
    Building,
    Flat,
    Floor,
    Occupancy,
    Ownership,
    ParkingAssignment,
    ParkingSlot,
    PropertyImportReport,
    SocietyMembership,
    SocietySettings,
    User,
    Vehicle,
    Wing,
  } = models;

  function conflict(error) {
    if (error?.code === 11000) {
      throw new AppError(
        409,
        'property_conflict',
        'A conflicting property or assignment already exists',
      );
    }
    throw error;
  }

  async function requireBuilding(societyId, buildingId) {
    const building = await Building.findOne({ _id: buildingId, societyId, status: 'active' });
    if (!building) throw new AppError(404, 'building_not_found', 'The building was not found');
    return building;
  }

  async function requireFlat(societyId, flatId) {
    const flat = await Flat.findOne({ _id: flatId, societyId, status: 'active' });
    if (!flat) throw new AppError(404, 'flat_not_found', 'The flat was not found');
    return flat;
  }

  async function assertHierarchy({ societyId, buildingId, wingId = null, floorId = null }) {
    await requireBuilding(societyId, buildingId);
    if (wingId) {
      const wing = await Wing.findOne({ _id: wingId, societyId, buildingId, status: 'active' });
      if (!wing)
        throw new AppError(422, 'invalid_property_hierarchy', 'Wing must belong to this building');
    }
    if (floorId) {
      const floor = await Floor.findOne({
        _id: floorId,
        societyId,
        buildingId,
        wingId: wingId ?? null,
        status: 'active',
      });
      if (!floor) {
        throw new AppError(
          422,
          'invalid_property_hierarchy',
          'Floor must belong to the selected building and wing',
        );
      }
    }
  }

  async function recalculateFlatStatus(societyId, flatId) {
    const flat = await Flat.findOne({ _id: flatId, societyId });
    if (!flat) return;
    const [owners, occupants] = await Promise.all([
      Ownership.countDocuments({ societyId, flatId, status: 'active' }),
      Occupancy.countDocuments({ societyId, flatId, status: 'active' }),
    ]);
    flat.occupancyStatus =
      occupants && owners ? 'partially_occupied' : owners || occupants ? 'occupied' : 'vacant';
    await flat.save();
  }

  async function createBuilding({ society, actor, data, request }) {
    try {
      const building = await Building.create({ ...data, societyId: society._id });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.building.create',
        targetType: 'building',
        targetId: building._id,
        outcome: 'success',
        requestId: request.id,
      });
      return building;
    } catch (error) {
      conflict(error);
    }
  }

  async function createWing({ society, actor, data, request }) {
    await requireBuilding(society._id, data.buildingId);
    try {
      const wing = await Wing.create({ ...data, societyId: society._id });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.wing.create',
        targetType: 'wing',
        targetId: wing._id,
        outcome: 'success',
        requestId: request.id,
      });
      return wing;
    } catch (error) {
      conflict(error);
    }
  }

  async function createFloor({ society, actor, data, request }) {
    await assertHierarchy({
      societyId: society._id,
      buildingId: data.buildingId,
      wingId: data.wingId,
    });
    try {
      const floor = await Floor.create({
        ...data,
        societyId: society._id,
        wingId: data.wingId ?? null,
      });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.floor.create',
        targetType: 'floor',
        targetId: floor._id,
        outcome: 'success',
        requestId: request.id,
      });
      return floor;
    } catch (error) {
      conflict(error);
    }
  }

  async function createFlat({ society, actor, data, request }) {
    const societySettings = await SocietySettings.findOne({ societyId: society._id }).lean();
    if (societySettings?.areaUnit && data.areaUnit !== societySettings.areaUnit) {
      throw new AppError(
        422,
        'flat_area_unit_mismatch',
        'Flat area must use the configured society area unit',
      );
    }
    await assertHierarchy({
      societyId: society._id,
      buildingId: data.buildingId,
      wingId: data.wingId,
      floorId: data.floorId,
    });
    try {
      const flat = await Flat.create({
        ...data,
        societyId: society._id,
        wingId: data.wingId ?? null,
      });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.flat.create',
        targetType: 'flat',
        targetId: flat._id,
        outcome: 'success',
        requestId: request.id,
      });
      return flat;
    } catch (error) {
      conflict(error);
    }
  }

  async function listProperties({ society, membership, query }) {
    const filter = { societyId: society._id, status: 'active' };
    if (query.buildingId) filter.buildingId = query.buildingId;
    if (query.occupancyStatus) filter.occupancyStatus = query.occupancyStatus;
    if (query.q) {
      const search = new RegExp(escapeRegex(query.q), 'i');
      const [buildings, wings] = await Promise.all([
        Building.find({ societyId: society._id, name: search }).select('_id').lean(),
        Wing.find({ societyId: society._id, name: search }).select('_id').lean(),
      ]);
      filter.$or = [
        { flatNumber: search },
        { buildingId: { $in: buildings.map(({ _id }) => _id) } },
        { wingId: { $in: wings.map(({ _id }) => _id) } },
      ];
    }
    if (membership.role === 'house_owner') {
      const [owned, occupied] = await Promise.all([
        Ownership.find({ societyId: society._id, membershipId: membership._id, status: 'active' })
          .select('flatId')
          .lean(),
        Occupancy.find({ societyId: society._id, membershipId: membership._id, status: 'active' })
          .select('flatId')
          .lean(),
      ]);
      filter._id = {
        $in: [...new Set([...owned, ...occupied].map(({ flatId }) => String(flatId)))],
      };
    }
    const direction = query.direction === 'asc' ? 1 : -1;
    const sort = { [query.sort]: direction, _id: 1 };
    const [flats, total] = await Promise.all([
      Flat.find(filter)
        .sort(sort)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate('buildingId', 'name code')
        .populate('wingId', 'name code')
        .populate('floorId', 'floorNumber label')
        .lean(),
      Flat.countDocuments(filter),
    ]);
    const flatIds = flats.map(({ _id }) => _id);
    const ownerVehicleIds =
      membership.role === 'house_owner'
        ? (
            await Vehicle.find({
              societyId: society._id,
              membershipId: membership._id,
              status: 'active',
            })
              .select('_id')
              .lean()
          ).map(({ _id }) => _id)
        : null;
    const [ownerships, occupancies, slots, assignments] = await Promise.all([
      Ownership.find({ societyId: society._id, flatId: { $in: flatIds }, status: 'active' })
        .populate({ path: 'membershipId', populate: { path: 'userId', select: 'displayName' } })
        .lean(),
      Occupancy.find({ societyId: society._id, flatId: { $in: flatIds }, status: 'active' }).lean(),
      ParkingSlot.find({
        societyId: society._id,
        flatId: { $in: flatIds },
        status: 'active',
      }).lean(),
      ParkingAssignment.find({
        societyId: society._id,
        flatId: { $in: flatIds },
        status: 'active',
        ...(ownerVehicleIds ? { vehicleId: { $in: ownerVehicleIds } } : {}),
      })
        .populate('vehicleId', 'registrationNumber vehicleType')
        .populate('parkingSlotId', 'slotNumber location')
        .lean(),
    ]);
    return {
      properties: flats.map((flat) => {
        const id = String(flat._id);
        return {
          id,
          flatNumber: flat.flatNumber,
          area: flat.area,
          areaUnit: flat.areaUnit,
          propertyType: flat.propertyType,
          occupancyStatus: flat.occupancyStatus,
          building: flat.buildingId,
          wing: flat.wingId,
          floor: flat.floorId,
          owners: ownerships
            .filter((record) => String(record.flatId) === id)
            .filter(
              (record) =>
                membership.role !== 'house_owner' ||
                String(record.membershipId?._id) === String(membership._id),
            )
            .map((record) => ({
              membershipId: String(record.membershipId?._id),
              name: record.membershipId?.userId?.displayName ?? 'Resident',
              ownershipType: record.ownershipType,
            })),
          occupancies:
            membership.role === 'house_owner'
              ? []
              : occupancies
                  .filter((record) => String(record.flatId) === id)
                  .map(({ _id, residentType, name, startsAt, endsAt }) => ({
                    id: String(_id),
                    residentType,
                    name,
                    startsAt,
                    endsAt,
                  })),
          parkingSlots: slots
            .filter((slot) => String(slot.flatId) === id)
            .map(({ _id, slotNumber, location }) => ({ id: String(_id), slotNumber, location })),
          parkingAssignments: assignments
            .filter((assignment) => String(assignment.flatId) === id)
            .map((assignment) => ({
              slot: assignment.parkingSlotId,
              vehicle: assignment.vehicleId,
            })),
        };
      }),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.ceil(total / query.limit),
      },
    };
  }

  async function getStructure({ society, membership }) {
    let flatFilter = { societyId: society._id, status: 'active' };
    if (membership.role === 'house_owner') {
      const [ownerships, occupancies] = await Promise.all([
        Ownership.find({
          societyId: society._id,
          membershipId: membership._id,
          status: 'active',
        })
          .select('flatId')
          .lean(),
        Occupancy.find({
          societyId: society._id,
          membershipId: membership._id,
          status: 'active',
        })
          .select('flatId')
          .lean(),
      ]);
      flatFilter._id = {
        $in: [...new Set([...ownerships, ...occupancies].map(({ flatId }) => String(flatId)))],
      };
    }
    const linkedFlats =
      membership.role === 'house_owner'
        ? await Flat.find(flatFilter).select('buildingId wingId floorId').lean()
        : null;
    const buildingIds = linkedFlats
      ? [...new Set(linkedFlats.map(({ buildingId }) => String(buildingId)))]
      : null;
    const wingIds = linkedFlats
      ? [...new Set(linkedFlats.map(({ wingId }) => wingId && String(wingId)).filter(Boolean))]
      : null;
    const floorIds = linkedFlats
      ? [...new Set(linkedFlats.map(({ floorId }) => String(floorId)))]
      : null;
    const [buildings, wings, floors] = await Promise.all([
      Building.find({
        societyId: society._id,
        status: 'active',
        ...(buildingIds ? { _id: { $in: buildingIds } } : {}),
      })
        .sort({ code: 1 })
        .lean(),
      Wing.find({
        societyId: society._id,
        status: 'active',
        ...(wingIds ? { _id: { $in: wingIds } } : {}),
      })
        .sort({ code: 1 })
        .lean(),
      Floor.find({
        societyId: society._id,
        status: 'active',
        ...(floorIds ? { _id: { $in: floorIds } } : {}),
      })
        .sort({ floorNumber: 1 })
        .lean(),
    ]);
    return { buildings, wings, floors };
  }

  async function endOwnership({ society, actor, entityId, request }) {
    const ownership = await Ownership.findOne({
      _id: entityId,
      societyId: society._id,
      status: { $in: ['invited', 'active'] },
    });
    if (!ownership)
      throw new AppError(404, 'ownership_not_found', 'The current ownership was not found');
    const now = clock();
    ownership.status = 'ended';
    ownership.endsAt = now;
    await ownership.save();
    const vehicles = await Vehicle.find({
      societyId: society._id,
      flatId: ownership.flatId,
      membershipId: ownership.membershipId,
      status: 'active',
    })
      .select('_id')
      .lean();
    const vehicleIds = vehicles.map(({ _id }) => _id);
    await Promise.all([
      Vehicle.updateMany({ _id: { $in: vehicleIds } }, { $set: { status: 'inactive' } }),
      ParkingAssignment.updateMany(
        { societyId: society._id, vehicleId: { $in: vehicleIds }, status: 'active' },
        { $set: { status: 'ended', endsAt: now } },
      ),
    ]);
    const [activeOwnership, activeOccupancy] = await Promise.all([
      Ownership.exists({
        societyId: society._id,
        membershipId: ownership.membershipId,
        status: 'active',
      }),
      Occupancy.exists({
        societyId: society._id,
        membershipId: ownership.membershipId,
        status: 'active',
      }),
    ]);
    if (!activeOwnership && !activeOccupancy) {
      const membership = await SocietyMembership.findOne({
        _id: ownership.membershipId,
        societyId: society._id,
        status: { $in: ['active', 'pending_verification', 'invited'] },
      });
      if (membership) {
        membership.status = 'revoked';
        membership.revokedAt = now;
        await membership.save();
        await Ownership.updateMany(
          { societyId: society._id, membershipId: membership._id, status: 'invited' },
          { $set: { status: 'ended', endsAt: now } },
        );
        await audit.record({
          actorId: actor._id,
          societyId: society._id,
          action: 'membership.status.change',
          targetType: 'membership',
          targetId: membership._id,
          outcome: 'success',
          requestId: request.id,
          metadata: { status: 'revoked', reason: 'ownership_ended' },
        });
      }
    }
    await recalculateFlatStatus(society._id, ownership.flatId);
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.ownership.end',
      targetType: 'ownership',
      targetId: ownership._id,
      outcome: 'success',
      requestId: request.id,
    });
    return ownership;
  }

  async function listParkingSlots({ society, membership }) {
    const filter = { societyId: society._id, status: 'active' };
    let ownerVehicleIds = null;
    if (membership.role === 'house_owner') {
      const links = await Ownership.find({
        societyId: society._id,
        membershipId: membership._id,
        status: 'active',
      })
        .select('flatId')
        .lean();
      const occupancies = await Occupancy.find({
        societyId: society._id,
        membershipId: membership._id,
        status: 'active',
      })
        .select('flatId')
        .lean();
      filter.flatId = {
        $in: [...new Set([...links, ...occupancies].map(({ flatId }) => String(flatId)))],
      };
      ownerVehicleIds = (
        await Vehicle.find({
          societyId: society._id,
          membershipId: membership._id,
          status: 'active',
        })
          .select('_id')
          .lean()
      ).map(({ _id }) => _id);
    }
    const slots = await ParkingSlot.find(filter)
      .sort({ slotNumber: 1 })
      .populate('buildingId', 'name code')
      .populate('flatId', 'flatNumber')
      .lean();
    const assignments = await ParkingAssignment.find({
      societyId: society._id,
      parkingSlotId: { $in: slots.map(({ _id }) => _id) },
      status: 'active',
      ...(ownerVehicleIds ? { vehicleId: { $in: ownerVehicleIds } } : {}),
    })
      .populate('vehicleId', 'registrationNumber vehicleType')
      .lean();
    return slots.map((slot) => ({
      id: String(slot._id),
      slotNumber: slot.slotNumber,
      location: slot.location,
      building: slot.buildingId,
      flat: slot.flatId,
      assignment:
        assignments.find((assignment) => String(assignment.parkingSlotId) === String(slot._id)) ??
        null,
    }));
  }

  async function inviteOwner({ society, actor, flatId, email, ownershipType, request }) {
    const flat = await requireFlat(society._id, flatId);
    const user = await User.findOne({ email });
    const membership = user
      ? await SocietyMembership.findOne({ societyId: society._id, userId: user._id })
      : null;
    if (
      membership &&
      (await Ownership.exists({
        societyId: society._id,
        flatId,
        membershipId: membership._id,
        status: { $in: ['invited', 'active'] },
      }))
    ) {
      throw new AppError(409, 'owner_already_linked', 'This owner is already linked to the flat');
    }
    if (membership?.status === 'active' && membership.role === 'house_owner') {
      try {
        const ownership = await Ownership.create({
          societyId: society._id,
          flatId: flat._id,
          membershipId: membership._id,
          ownershipType,
          status: 'active',
          startsAt: clock(),
          createdBy: actor._id,
        });
        await recalculateFlatStatus(society._id, flat._id);
        await audit.record({
          actorId: actor._id,
          societyId: society._id,
          action: 'property.owner.link',
          targetType: 'ownership',
          targetId: ownership._id,
          outcome: 'success',
          requestId: request.id,
          metadata: { ownershipType, source: 'resident_invite' },
        });
        return {
          invitation: null,
          ownership: { id: String(ownership._id), status: ownership.status },
        };
      } catch (error) {
        conflict(error);
      }
    }
    const invitation = await membershipService.inviteMember({
      society,
      role: 'house_owner',
      email,
      actor,
      request,
    });
    try {
      const ownership = await Ownership.create({
        societyId: society._id,
        flatId: flat._id,
        membershipId: invitation.id,
        ownershipType,
        status: 'invited',
        startsAt: clock(),
        createdBy: actor._id,
      });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.owner.invite',
        targetType: 'ownership',
        targetId: ownership._id,
        outcome: 'success',
        requestId: request.id,
        metadata: { ownershipType },
      });
      return { invitation, ownership: { id: String(ownership._id), status: ownership.status } };
    } catch (error) {
      conflict(error);
    }
  }

  async function linkOwner({ society, actor, flatId, membershipId, ownershipType, request }) {
    const flat = await requireFlat(society._id, flatId);
    const membership = await SocietyMembership.findOne({
      _id: membershipId,
      societyId: society._id,
      role: 'house_owner',
      status: 'active',
    });
    if (!membership)
      throw new AppError(404, 'member_not_found', 'The active owner membership was not found');
    try {
      const ownership = await Ownership.create({
        societyId: society._id,
        flatId: flat._id,
        membershipId,
        ownershipType,
        status: 'active',
        startsAt: clock(),
        createdBy: actor._id,
      });
      await recalculateFlatStatus(society._id, flat._id);
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.owner.link',
        targetType: 'ownership',
        targetId: ownership._id,
        outcome: 'success',
        requestId: request.id,
        metadata: { ownershipType },
      });
      return ownership;
    } catch (error) {
      conflict(error);
    }
  }

  async function createOccupancy({ society, actor, flatId, data, request }) {
    const flat = await requireFlat(society._id, flatId);
    const startsAt = new Date(data.startsAt);
    const endsAt = data.endsAt ? new Date(data.endsAt) : null;
    const now = clock();
    if (startsAt > now) {
      throw new AppError(
        422,
        'future_occupancy_unavailable',
        'Future-dated occupancy is not supported; record the move-in when it begins',
      );
    }
    if (endsAt && endsAt <= startsAt) {
      throw new AppError(422, 'invalid_occupancy_period', 'Occupancy end must be after its start');
    }
    const occupancy = await Occupancy.create({
      ...data,
      societyId: society._id,
      flatId: flat._id,
      startsAt,
      endsAt,
      status: endsAt && endsAt <= now ? 'ended' : 'active',
      createdBy: actor._id,
    });
    await recalculateFlatStatus(society._id, flat._id);
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.occupancy.create',
      targetType: 'occupancy',
      targetId: occupancy._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { residentType: occupancy.residentType },
    });
    return occupancy;
  }

  async function endOccupancy({ society, actor, occupancyId, request }) {
    const occupancy = await Occupancy.findOne({
      _id: occupancyId,
      societyId: society._id,
      status: 'active',
    });
    if (!occupancy)
      throw new AppError(404, 'occupancy_not_found', 'The active occupancy was not found');
    const now = clock();
    occupancy.status = 'ended';
    occupancy.endsAt = now;
    await occupancy.save();
    const vehicles = await Vehicle.find({
      societyId: society._id,
      occupancyId: occupancy._id,
      status: 'active',
    }).select('_id');
    const vehicleIds = vehicles.map(({ _id }) => _id);
    await Promise.all([
      Vehicle.updateMany({ _id: { $in: vehicleIds } }, { $set: { status: 'inactive' } }),
      ParkingAssignment.updateMany(
        { societyId: society._id, vehicleId: { $in: vehicleIds }, status: 'active' },
        { $set: { status: 'ended', endsAt: now } },
      ),
    ]);
    if (occupancy.membershipId) {
      const [activeOwnership, activeOccupancy] = await Promise.all([
        Ownership.exists({
          societyId: society._id,
          membershipId: occupancy.membershipId,
          status: 'active',
        }),
        Occupancy.exists({
          societyId: society._id,
          membershipId: occupancy.membershipId,
          status: 'active',
          _id: { $ne: occupancy._id },
        }),
      ]);
      if (!activeOwnership && !activeOccupancy) {
        const membership = await SocietyMembership.findOne({
          _id: occupancy.membershipId,
          societyId: society._id,
          status: 'active',
        });
        if (membership) {
          membership.status = 'revoked';
          membership.revokedAt = now;
          await membership.save();
          await Ownership.updateMany(
            {
              societyId: society._id,
              membershipId: membership._id,
              status: { $in: ['invited', 'active'] },
            },
            { $set: { status: 'ended', endsAt: now } },
          );
          await audit.record({
            actorId: actor._id,
            societyId: society._id,
            action: 'membership.status.change',
            targetType: 'membership',
            targetId: membership._id,
            outcome: 'success',
            requestId: request.id,
            metadata: { status: 'revoked', reason: 'occupancy_ended' },
          });
        }
      }
    }
    await recalculateFlatStatus(society._id, occupancy.flatId);
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.occupancy.end',
      targetType: 'occupancy',
      targetId: occupancy._id,
      outcome: 'success',
      requestId: request.id,
    });
    return occupancy;
  }

  async function createVehicle({ society, actor, flatId, data, request }) {
    await requireFlat(society._id, flatId);
    if (!data.membershipId && !data.occupancyId) {
      throw new AppError(
        422,
        'vehicle_resident_required',
        'Link the vehicle to an owner membership or active occupancy',
      );
    }

    if (data.membershipId) {
      const ownership = await Ownership.exists({
        societyId: society._id,
        flatId,
        membershipId: data.membershipId,
        status: 'active',
      });
      if (!ownership)
        throw new AppError(404, 'owner_not_linked', 'The owner is not linked to this flat');
    }
    if (data.occupancyId) {
      const occupancy = await Occupancy.exists({
        _id: data.occupancyId,
        societyId: society._id,
        flatId,
        status: 'active',
      });
      if (!occupancy)
        throw new AppError(404, 'occupancy_not_found', 'The active occupancy was not found');
    }
    try {
      const vehicle = await Vehicle.create({
        ...data,
        societyId: society._id,
        flatId,
        registrationNumber: data.registrationNumber.toUpperCase(),
      });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.vehicle.create',
        targetType: 'vehicle',
        targetId: vehicle._id,
        outcome: 'success',
        requestId: request.id,
        metadata: { vehicleType: vehicle.vehicleType },
      });
      return vehicle;
    } catch (error) {
      conflict(error);
    }
  }

  async function createParkingSlot({ society, actor, data, request }) {
    await assertHierarchy({ societyId: society._id, buildingId: data.buildingId });
    if (data.flatId) {
      const flat = await requireFlat(society._id, data.flatId);
      if (String(flat.buildingId) !== String(data.buildingId)) {
        throw new AppError(
          422,
          'invalid_property_hierarchy',
          'Reserved flat must belong to this building',
        );
      }
    }
    try {
      const slot = await ParkingSlot.create({ ...data, societyId: society._id });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.parking_slot.create',
        targetType: 'parking_slot',
        targetId: slot._id,
        outcome: 'success',
        requestId: request.id,
      });
      return slot;
    } catch (error) {
      conflict(error);
    }
  }

  async function assignParking({ society, actor, parkingSlotId, data, request }) {
    const [slot, flat, vehicle] = await Promise.all([
      ParkingSlot.findOne({ _id: parkingSlotId, societyId: society._id, status: 'active' }),
      requireFlat(society._id, data.flatId),
      Vehicle.findOne({
        _id: data.vehicleId,
        societyId: society._id,
        flatId: data.flatId,
        status: 'active',
      }),
    ]);
    if (!slot) throw new AppError(404, 'parking_slot_not_found', 'The parking slot was not found');
    if (!vehicle)
      throw new AppError(404, 'vehicle_not_found', 'The vehicle was not found for this flat');
    if (slot.flatId && String(slot.flatId) !== String(flat._id)) {
      throw new AppError(
        409,
        'parking_flat_conflict',
        'The parking slot is reserved for another flat',
      );
    }
    try {
      const assignment = await ParkingAssignment.create({
        societyId: society._id,
        parkingSlotId: slot._id,
        flatId: flat._id,
        vehicleId: vehicle._id,
        startsAt: data.startsAt ? new Date(data.startsAt) : clock(),
        assignedBy: actor._id,
      });
      await audit.record({
        actorId: actor._id,
        societyId: society._id,
        action: 'property.parking.assign',
        targetType: 'parking_assignment',
        targetId: assignment._id,
        outcome: 'success',
        requestId: request.id,
      });
      return assignment;
    } catch (error) {
      conflict(error);
    }
  }

  async function myProperty({ society, membership }) {
    const residentProfile = await User.findById(membership.userId)
      .select('displayName email phone')
      .lean();
    const ownerships = await Ownership.find({
      societyId: society._id,
      membershipId: membership._id,
      status: 'active',
    })
      .populate({
        path: 'flatId',
        populate: [
          { path: 'buildingId', select: 'name code' },
          { path: 'wingId', select: 'name code' },
          { path: 'floorId', select: 'floorNumber label' },
        ],
      })
      .lean();
    const occupancies = await Occupancy.find({
      societyId: society._id,
      membershipId: membership._id,
      status: 'active',
    })
      .populate({
        path: 'flatId',
        populate: [
          { path: 'buildingId', select: 'name code' },
          { path: 'wingId', select: 'name code' },
          { path: 'floorId', select: 'floorNumber label' },
        ],
      })
      .lean();
    const flats = new Map();
    for (const ownership of ownerships) {
      if (!ownership.flatId) continue;
      const id = String(ownership.flatId._id);
      const record = flats.get(id) ?? { flat: ownership.flatId, ownerships: [], occupancies: [] };
      record.ownerships.push({ type: ownership.ownershipType, startsAt: ownership.startsAt });
      flats.set(id, record);
    }
    for (const occupancy of occupancies) {
      if (!occupancy.flatId) continue;
      const id = String(occupancy.flatId._id);
      const record = flats.get(id) ?? { flat: occupancy.flatId, ownerships: [], occupancies: [] };
      record.occupancies.push({
        residentType: occupancy.residentType,
        startsAt: occupancy.startsAt,
        endsAt: occupancy.endsAt,
      });
      flats.set(id, record);
    }
    const flatIds = [...flats.keys()];
    const vehicles = await Vehicle.find({
      societyId: society._id,
      flatId: { $in: flatIds },
      membershipId: membership._id,
      status: 'active',
    }).lean();
    const [assignments] = await Promise.all([
      ParkingAssignment.find({
        societyId: society._id,
        flatId: { $in: flatIds },
        vehicleId: { $in: vehicles.map(({ _id }) => _id) },
        status: 'active',
      })
        .populate('parkingSlotId', 'slotNumber location')
        .populate('vehicleId', 'registrationNumber vehicleType make model color')
        .lean(),
    ]);
    return {
      resident: {
        membershipId: String(membership._id),
        role: membership.role,
        status: membership.status,
        verifiedAt: membership.verifiedAt,
        profile: residentProfile
          ? {
              name: residentProfile.displayName,
              email: residentProfile.email,
              phone: residentProfile.phone ?? '',
            }
          : null,
      },
      properties: [...flats.entries()].map(([id, value]) => ({
        ...value,
        vehicles: vehicles.filter((vehicle) => String(vehicle.flatId) === id),
        parkingAssignments: assignments.filter((assignment) => String(assignment.flatId) === id),
      })),
    };
  }

  async function listResidents({ society, query }) {
    const activeStatus = query.status ? query.status : { $in: ['active', 'invited'] };
    const ownerAllowed = !query.residentType || ['owner', 'co_owner'].includes(query.residentType);
    const occupancyAllowed =
      query.status !== 'invited' &&
      (!query.residentType || ['tenant', 'authorized_occupant'].includes(query.residentType));
    const ownerPipeline = [
      {
        $match: {
          societyId: society._id,
          status: activeStatus,
          ...(ownerAllowed && query.residentType ? { ownershipType: query.residentType } : {}),
          ...(!ownerAllowed ? { _id: { $exists: false } } : {}),
        },
      },
      {
        $lookup: {
          from: SocietyMembership.collection.name,
          let: { membershipId: '$membershipId', societyId: '$societyId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$_id', '$$membershipId'] },
                    { $eq: ['$societyId', '$$societyId'] },
                  ],
                },
              },
            },
          ],
          as: 'membership',
        },
      },
      { $unwind: { path: '$membership', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'membership.userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: Flat.collection.name,
          let: { flatId: '$flatId', societyId: '$societyId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$_id', '$$flatId'] }, { $eq: ['$societyId', '$$societyId'] }],
                },
              },
            },
          ],
          as: 'flat',
        },
      },
      { $unwind: { path: '$flat', preserveNullAndEmptyArrays: true } },
      ...(query.q
        ? [
            {
              $match: {
                $or: [
                  { 'user.displayName': { $regex: escapeRegex(query.q), $options: 'i' } },
                  { 'user.email': { $regex: escapeRegex(query.q), $options: 'i' } },
                  { 'flat.flatNumber': { $regex: escapeRegex(query.q), $options: 'i' } },
                ],
              },
            },
          ]
        : []),
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          residentType: '$ownershipType',
          status: 1,
          name: { $ifNull: ['$user.displayName', ''] },
          email: { $ifNull: ['$user.email', ''] },
          phone: { $ifNull: ['$user.phone', ''] },
          flatNumber: { $ifNull: ['$flat.flatNumber', ''] },
          membershipId: { $toString: '$membershipId' },
          startsAt: 1,
          endsAt: 1,
        },
      },
    ];
    const occupancyPipeline = [
      {
        $match: {
          societyId: society._id,
          ...(occupancyAllowed
            ? { status: query.status ?? 'active' }
            : { _id: { $exists: false } }),
          ...(occupancyAllowed && query.residentType ? { residentType: query.residentType } : {}),
        },
      },
      {
        $lookup: {
          from: Flat.collection.name,
          let: { flatId: '$flatId', societyId: '$societyId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$_id', '$$flatId'] }, { $eq: ['$societyId', '$$societyId'] }],
                },
              },
            },
          ],
          as: 'flat',
        },
      },
      { $unwind: { path: '$flat', preserveNullAndEmptyArrays: true } },
      ...(query.q
        ? [
            {
              $match: {
                $or: [
                  { name: { $regex: escapeRegex(query.q), $options: 'i' } },
                  { email: { $regex: escapeRegex(query.q), $options: 'i' } },
                  { 'flat.flatNumber': { $regex: escapeRegex(query.q), $options: 'i' } },
                ],
              },
            },
          ]
        : []),
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          residentType: 1,
          status: 1,
          name: 1,
          email: { $ifNull: ['$email', ''] },
          phone: { $ifNull: ['$phone', ''] },
          flatNumber: { $ifNull: ['$flat.flatNumber', ''] },
          membershipId: { $ifNull: [{ $toString: '$membershipId' }, ''] },
          startsAt: 1,
          endsAt: 1,
        },
      },
    ];
    const direction = query.sort === 'oldest' ? 1 : -1;
    const [result] = await Ownership.aggregate([
      ...ownerPipeline,
      {
        $unionWith: {
          coll: Occupancy.collection.name,
          pipeline: occupancyPipeline,
        },
      },
      { $sort: { startsAt: direction, id: 1 } },
      {
        $facet: {
          residents: [{ $skip: (query.page - 1) * query.limit }, { $limit: query.limit }],
          total: [{ $count: 'value' }],
        },
      },
    ]);
    const residents = result?.residents ?? [];
    const total = result?.total?.[0]?.value ?? 0;
    return {
      residents,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.ceil(total / query.limit),
      },
    };
  }

  async function exportProperties({ society, membership, query, request, actor }) {
    const properties = await listProperties({
      society,
      membership,
      query: { ...query, page: 1, limit: EXPORT_LIMIT },
    });
    const result = csv(
      [
        'Building',
        'Wing',
        'Floor',
        'Flat',
        'Area',
        'Area unit',
        'Property type',
        'Occupancy status',
        'Owners',
      ],
      properties.properties.map((flat) => [
        flat.building?.name,
        flat.wing?.name,
        flat.floor?.label || flat.floor?.floorNumber,
        flat.flatNumber,
        flat.area,
        flat.areaUnit,
        flat.propertyType,
        flat.occupancyStatus,
        flat.owners.map((owner) => owner.name).join('; '),
      ]),
    );
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.export',
      targetType: 'flat',
      outcome: 'success',
      requestId: request.id,
      metadata: { records: properties.properties.length },
    });
    return { csv: result, truncated: properties.pagination.total > EXPORT_LIMIT };
  }

  async function exportResidents({ society, query, request, actor }) {
    const result = await listResidents({
      society,
      query: { ...query, page: 1, limit: EXPORT_LIMIT },
    });
    const report = csv(
      [
        'Resident type',
        'Status',
        'Name',
        'Email',
        'Phone',
        'Flat',
        'Membership ID',
        'Move in',
        'Move out',
      ],
      result.residents.map((resident) => [
        resident.residentType,
        resident.status,
        resident.name,
        resident.email,
        resident.phone,
        resident.flatNumber,
        resident.membershipId,
        resident.startsAt,
        resident.endsAt,
      ]),
    );
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'resident.export',
      targetType: 'resident',
      outcome: 'success',
      requestId: request.id,
      metadata: { records: result.residents.length },
    });
    return { csv: report, truncated: result.pagination.total > EXPORT_LIMIT };
  }

  async function importRecords({ society, actor, type, records, request }) {
    const errors = [];
    let createdCount = 0;
    for (const [index, raw] of records.entries()) {
      try {
        if (type === 'properties') {
          const record = propertySchemas.propertyImportRowSchema.parse(raw);
          const settings = await SocietySettings.findOne({ societyId: society._id }).lean();
          if (settings?.areaUnit && record.areaUnit !== settings.areaUnit) {
            throw new AppError(
              422,
              'flat_area_unit_mismatch',
              'Flat area must use the configured society area unit',
            );
          }
          const buildingCode = record.buildingCode.toUpperCase();
          let building = await Building.findOne({ societyId: society._id, code: buildingCode });
          if (!building) {
            building = await Building.create({
              societyId: society._id,
              code: buildingCode,
              name: record.buildingName ?? buildingCode,
            });
          }
          if (building.status !== 'active') {
            throw new AppError(409, 'property_archived', 'The imported building is archived');
          }
          const wingCode = record.wingCode ? String(record.wingCode).trim().toUpperCase() : null;
          let wing = wingCode
            ? await Wing.findOne({
                societyId: society._id,
                buildingId: building._id,
                code: wingCode,
              })
            : null;
          if (wingCode && !wing) {
            wing = await Wing.create({
              societyId: society._id,
              buildingId: building._id,
              code: wingCode,
              name: record.wingName ?? wingCode,
            });
          }
          if (wing && wing.status !== 'active') {
            throw new AppError(409, 'property_archived', 'The imported wing is archived');
          }
          const floorNumber = record.floorNumber;
          let floor = await Floor.findOne({
            societyId: society._id,
            buildingId: building._id,
            wingId: wing?._id ?? null,
            floorNumber,
          });
          if (!floor) {
            floor = await Floor.create({
              societyId: society._id,
              buildingId: building._id,
              wingId: wing?._id ?? null,
              floorNumber,
              label: record.floorLabel ?? '',
            });
          }
          if (floor.status !== 'active') {
            throw new AppError(409, 'property_archived', 'The imported floor is archived');
          }
          await Flat.create({
            societyId: society._id,
            buildingId: building._id,
            wingId: wing?._id ?? null,
            floorId: floor._id,
            flatNumber: record.flatNumber,
            area: record.area,
            areaUnit: record.areaUnit,
            propertyType: record.propertyType,
          });
          createdCount += 1;
        } else {
          const record = propertySchemas.residentImportRowSchema.parse(raw);
          const flat = await requireFlat(society._id, record.flatId);
          const email = String(record.email ?? '')
            .trim()
            .toLowerCase();
          if (!email) throw new Error('email is required');
          await inviteOwner({
            society,
            actor,
            flatId: flat._id,
            email,
            ownershipType: record.ownershipType === 'co_owner' ? 'co_owner' : 'owner',
            request,
          });
          createdCount += 1;
        }
      } catch (error) {
        errors.push({
          row: index + 1,
          identifier: String(raw.flatNumber ?? '').slice(0, 120),
          message:
            error.code === 11000
              ? 'Duplicate property identifier or assignment'
              : error.name === 'ZodError'
                ? error.issues
                    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                    .join('; ')
                : error instanceof AppError
                  ? error.message
                  : 'Record could not be imported',
        });
      }
    }
    const report = await PropertyImportReport.create({
      societyId: society._id,
      createdBy: actor._id,
      importType: type,
      createdCount,
      rowErrors: errors,
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.import',
      targetType: 'property_import',
      targetId: report._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { type, createdCount, errorCount: errors.length },
    });
    return {
      id: String(report._id),
      type,
      createdCount,
      errorCount: errors.length,
      errorReportUrl: `/api/v1/societies/${society._id}/property-imports/${report._id}/errors`,
    };
  }

  async function getImportErrors({ society, importId, actor, request }) {
    const report = await PropertyImportReport.findOne({
      _id: importId,
      societyId: society._id,
    }).lean();
    if (!report)
      throw new AppError(404, 'import_report_not_found', 'The import report was not found');
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.import.errors.export',
      targetType: 'property_import_report',
      targetId: report._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { rows: report.rowErrors.length },
    });
    return csv(
      ['Row', 'Identifier', 'Error'],
      report.rowErrors.map(({ row, identifier, message }) => [row, identifier, message]),
    );
  }

  async function endParkingAssignment({ society, actor, entityId, request }) {
    const assignment = await ParkingAssignment.findOne({
      _id: entityId,
      societyId: society._id,
      status: 'active',
    });
    if (!assignment)
      throw new AppError(
        404,
        'parking_assignment_not_found',
        'The active parking assignment was not found',
      );
    assignment.status = 'ended';
    assignment.endsAt = clock();
    await assignment.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'property.parking.unassign',
      targetType: 'parking_assignment',
      targetId: assignment._id,
      outcome: 'success',
      requestId: request.id,
    });
    return assignment;
  }

  async function listVehicles({ society, membership, query }) {
    const filter = { societyId: society._id, status: 'active' };
    if (query.flatId) filter.flatId = query.flatId;
    if (membership.role === 'house_owner') filter.membershipId = membership._id;
    if (query.q) filter.registrationNumber = new RegExp(escapeRegex(query.q), 'i');
    const [vehicles, total] = await Promise.all([
      Vehicle.find(filter)
        .sort({ registrationNumber: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate('flatId', 'flatNumber')
        .lean(),
      Vehicle.countDocuments(filter),
    ]);
    return {
      vehicles: vehicles.map((vehicle) => ({
        id: String(vehicle._id),
        registrationNumber: vehicle.registrationNumber,
        vehicleType: vehicle.vehicleType,
        flat: vehicle.flatId,
        membershipId: String(vehicle.membershipId ?? ''),
        occupancyId: String(vehicle.occupancyId ?? ''),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.ceil(total / query.limit),
      },
    };
  }

  return {
    assignParking,
    createBuilding,
    createFlat,
    createFloor,
    createOccupancy,
    createParkingSlot,
    createVehicle,
    createWing,
    endOwnership,
    endOccupancy,
    endParkingAssignment,
    exportProperties,
    exportResidents,
    getImportErrors,
    getStructure,
    importRecords,
    inviteOwner,
    linkOwner,
    listProperties,
    listParkingSlots,
    listResidents,
    listVehicles,
    myProperty,
  };
}

module.exports = { createPropertyService };
