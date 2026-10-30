const express = require('express');
const { createPropertyController } = require('../controllers/property.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { csrfProtection } = require('../middleware/csrfProtection');
const { requirePermissions } = require('../middleware/authorize');
const { requireSocietyContext } = require('../middleware/requireSocietyContext');
const { validateRequest } = require('../middleware/validateRequest');
const { societyIdParamsSchema } = require('../validators/auth.validators');
const schemas = require('../validators/property.validators');

function createPropertyRouter({ models, audit, propertyService }) {
  const router = express.Router();
  const controller = createPropertyController({ propertyService });
  const authenticate = createAuthenticate({ models, audit });
  const societyContext = requireSocietyContext({ models, audit });

  function scoped(path, method, permission, schema, handler) {
    router[method](
      path,
      authenticate,
      ...(method === 'get' ? [] : [csrfProtection]),
      validateRequest({
        params: schema.params ?? societyIdParamsSchema,
        ...(schema.query ? { query: schema.query } : {}),
        ...(schema.body ? { body: schema.body } : {}),
      }),
      societyContext,
      requirePermissions(audit, permission),
      handler,
    );
  }

  scoped(
    '/societies/:societyId/properties/structure',
    'get',
    'property:read',
    {},
    controller.getStructure,
  );
  scoped(
    '/societies/:societyId/properties/export',
    'get',
    'property:manage',
    { query: schemas.propertiesQuerySchema },
    controller.exportProperties,
  );
  scoped(
    '/societies/:societyId/properties',
    'get',
    'property:read',
    { query: schemas.propertiesQuerySchema },
    controller.listProperties,
  );
  scoped(
    '/societies/:societyId/buildings',
    'post',
    'property:manage',
    { body: schemas.buildingSchema },
    controller.createBuilding,
  );
  scoped(
    '/societies/:societyId/wings',
    'post',
    'property:manage',
    { body: schemas.wingSchema },
    controller.createWing,
  );
  scoped(
    '/societies/:societyId/floors',
    'post',
    'property:manage',
    { body: schemas.floorSchema },
    controller.createFloor,
  );
  scoped(
    '/societies/:societyId/flats',
    'post',
    'property:manage',
    { body: schemas.flatSchema },
    controller.createFlat,
  );
  scoped(
    '/societies/:societyId/flats/:flatId/owners/invite',
    'post',
    'residents:manage',
    { params: schemas.flatParamsSchema, body: schemas.inviteOwnerSchema },
    controller.inviteOwner,
  );
  scoped(
    '/societies/:societyId/flats/:flatId/owners/link',
    'post',
    'residents:manage',
    { params: schemas.flatParamsSchema, body: schemas.linkOwnerSchema },
    controller.linkOwner,
  );
  scoped(
    '/societies/:societyId/residents/export',
    'get',
    'residents:manage',
    { query: schemas.residentsQuerySchema },
    controller.exportResidents,
  );
  scoped(
    '/societies/:societyId/residents',
    'get',
    'residents:manage',
    { query: schemas.residentsQuerySchema },
    controller.listResidents,
  );
  scoped(
    '/societies/:societyId/flats/:flatId/occupancies',
    'post',
    'residents:manage',
    { params: schemas.flatParamsSchema, body: schemas.occupancySchema },
    controller.createOccupancy,
  );
  scoped(
    '/societies/:societyId/occupancies/:entityId/end',
    'patch',
    'residents:manage',
    { params: schemas.entityParamsSchema, body: schemas.emptyBodySchema },
    controller.endOccupancy,
  );
  scoped(
    '/societies/:societyId/ownerships/:entityId/end',
    'patch',
    'residents:manage',
    { params: schemas.entityParamsSchema, body: schemas.emptyBodySchema },
    controller.endOwnership,
  );
  scoped(
    '/societies/:societyId/flats/:flatId/vehicles',
    'post',
    'property:manage',
    { params: schemas.flatParamsSchema, body: schemas.vehicleSchema },
    controller.createVehicle,
  );
  scoped(
    '/societies/:societyId/vehicles',
    'get',
    'property:read',
    { query: schemas.vehiclesQuerySchema },
    controller.listVehicles,
  );
  scoped(
    '/societies/:societyId/parking-slots',
    'get',
    'property:read',
    {},
    controller.listParkingSlots,
  );
  scoped(
    '/societies/:societyId/parking-slots',
    'post',
    'parking:manage',
    { body: schemas.parkingSlotSchema },
    controller.createParkingSlot,
  );
  scoped(
    '/societies/:societyId/parking-slots/:parkingSlotId/assign',
    'post',
    'parking:manage',
    { params: schemas.assignmentParamsSchema, body: schemas.parkingAssignmentSchema },
    controller.assignParking,
  );
  scoped(
    '/societies/:societyId/parking-assignments/:entityId/end',
    'patch',
    'parking:manage',
    { params: schemas.entityParamsSchema, body: schemas.emptyBodySchema },
    controller.endParkingAssignment,
  );
  scoped(
    '/societies/:societyId/property-imports',
    'post',
    'property:manage',
    { body: schemas.importSchema },
    controller.importRecords,
  );
  scoped(
    '/societies/:societyId/property-imports/:importId/errors',
    'get',
    'property:manage',
    { params: schemas.importErrorParamsSchema },
    controller.importErrors,
  );
  scoped('/societies/:societyId/my-property', 'get', 'property:read', {}, controller.myProperty);

  return router;
}

module.exports = { createPropertyRouter };
