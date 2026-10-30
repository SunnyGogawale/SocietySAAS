const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const text = z.string().trim().min(1).max(120);
const buildingSchema = z.strictObject({ name: text, code: z.string().trim().min(1).max(32) });
const wingSchema = z.strictObject({
  buildingId: objectId,
  name: text,
  code: z.string().trim().min(1).max(32),
});
const floorSchema = z.strictObject({
  buildingId: objectId,
  wingId: objectId.nullable().optional(),
  floorNumber: z.number().int().min(-10).max(250),
  label: z.string().trim().max(80).default(''),
});
const flatSchema = z.strictObject({
  buildingId: objectId,
  wingId: objectId.nullable().optional(),
  floorId: objectId,
  flatNumber: z.string().trim().min(1).max(32),
  area: z.number().min(1).max(1000000),
  areaUnit: z.enum(['square_foot', 'square_metre']),
  propertyType: z.enum(['apartment', 'penthouse', 'studio', 'commercial', 'other']),
});
const propertiesQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(120).optional(),
  buildingId: objectId.optional(),
  occupancyStatus: z.enum(['vacant', 'occupied', 'partially_occupied']).optional(),
  sort: z.enum(['flatNumber', 'area', 'createdAt']).default('flatNumber'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  ...pagination,
});
const residentsQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(120).optional(),
  residentType: z.enum(['owner', 'co_owner', 'tenant', 'authorized_occupant']).optional(),
  status: z.enum(['invited', 'active', 'ended']).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  ...pagination,
});
const vehiclesQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(120).optional(),
  flatId: objectId.optional(),
  ...pagination,
});
const inviteOwnerSchema = z.strictObject({
  email,
  ownershipType: z.enum(['owner', 'co_owner']).default('owner'),
});
const linkOwnerSchema = z.strictObject({
  membershipId: objectId,
  ownershipType: z.enum(['owner', 'co_owner']).default('co_owner'),
});
const occupancySchema = z.strictObject({
  residentType: z.enum(['tenant', 'authorized_occupant']),
  name: z.string().trim().min(2).max(120),
  email: email.nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  leaseReference: z.string().trim().max(120).nullable().optional(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable().optional(),
});
const vehicleSchema = z.strictObject({
  membershipId: objectId.nullable().optional(),
  occupancyId: objectId.nullable().optional(),
  registrationNumber: z.string().trim().min(2).max(32),
  vehicleType: z.enum(['car', 'motorcycle', 'bicycle', 'other']),
  make: z.string().trim().max(80).default(''),
  model: z.string().trim().max(80).default(''),
  color: z.string().trim().max(40).default(''),
});
const parkingSlotSchema = z.strictObject({
  buildingId: objectId,
  flatId: objectId.nullable().optional(),
  slotNumber: z.string().trim().min(1).max(32),
  location: z.string().trim().max(120).default(''),
});
const parkingAssignmentSchema = z.strictObject({
  flatId: objectId,
  vehicleId: objectId,
  startsAt: z.iso.datetime().optional(),
});
const propertyImportRowSchema = z.strictObject({
  buildingCode: z.string().trim().min(1).max(32),
  buildingName: z.string().trim().min(1).max(120).optional(),
  wingCode: z.string().trim().min(1).max(32).optional(),
  wingName: z.string().trim().min(1).max(120).optional(),
  floorNumber: z.coerce.number().int().min(-10).max(250),
  floorLabel: z.string().trim().max(80).optional(),
  flatNumber: z.string().trim().min(1).max(32),
  area: z.coerce.number().min(1).max(1000000),
  areaUnit: z.enum(['square_foot', 'square_metre']),
  propertyType: z.enum(['apartment', 'penthouse', 'studio', 'commercial', 'other']),
});
const residentImportRowSchema = z.strictObject({
  flatId: objectId,
  email,
  ownershipType: z.enum(['owner', 'co_owner']).default('owner'),
});
const importSchema = z.strictObject({
  type: z.enum(['properties', 'residents']),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
});
const emptyBodySchema = z.strictObject({}).default({});
const importIdParamsSchema = z.strictObject({ importId: objectId });
const importErrorParamsSchema = z.strictObject({ societyId: objectId, importId: objectId });
const flatParamsSchema = z.strictObject({ societyId: objectId, flatId: objectId });
const entityParamsSchema = z.strictObject({ societyId: objectId, entityId: objectId });
const assignmentParamsSchema = z.strictObject({ societyId: objectId, parkingSlotId: objectId });

module.exports = {
  assignmentParamsSchema,
  buildingSchema,
  entityParamsSchema,
  emptyBodySchema,
  flatParamsSchema,
  flatSchema,
  floorSchema,
  importIdParamsSchema,
  importErrorParamsSchema,
  importSchema,
  inviteOwnerSchema,
  linkOwnerSchema,
  occupancySchema,
  parkingAssignmentSchema,
  parkingSlotSchema,
  propertiesQuerySchema,
  propertyImportRowSchema,
  residentsQuerySchema,
  residentImportRowSchema,
  vehicleSchema,
  vehiclesQuerySchema,
  wingSchema,
};
