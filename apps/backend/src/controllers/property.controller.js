const { sendSuccess } = require('../utils/apiResponse');

function createPropertyController({ propertyService }) {
  function csvResponse(request, response, result, filename) {
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="${filename}"`);
    response.setHeader('x-export-truncated', String(result.truncated));
    response.status(200).send(result.csv);
  }

  return {
    async getStructure(request, response) {
      return sendSuccess(
        request,
        response,
        await propertyService.getStructure({
          society: request.society,
          membership: request.membership,
        }),
      );
    },
    async listProperties(request, response) {
      const result = await propertyService.listProperties({
        society: request.society,
        membership: request.membership,
        query: request.validated.query,
      });
      return sendSuccess(request, response, result);
    },
    async exportProperties(request, response) {
      const result = await propertyService.exportProperties({
        society: request.society,
        membership: request.membership,
        query: request.validated.query,
        actor: request.auth.user,
        request,
      });
      return csvResponse(request, response, result, 'properties.csv');
    },
    async createBuilding(request, response) {
      const building = await propertyService.createBuilding({
        society: request.society,
        actor: request.auth.user,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { building }, 201);
    },
    async createWing(request, response) {
      const wing = await propertyService.createWing({
        society: request.society,
        actor: request.auth.user,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { wing }, 201);
    },
    async createFloor(request, response) {
      const floor = await propertyService.createFloor({
        society: request.society,
        actor: request.auth.user,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { floor }, 201);
    },
    async createFlat(request, response) {
      const flat = await propertyService.createFlat({
        society: request.society,
        actor: request.auth.user,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { flat }, 201);
    },
    async inviteOwner(request, response) {
      const result = await propertyService.inviteOwner({
        society: request.society,
        actor: request.auth.user,
        flatId: request.params.flatId,
        ...request.validated.body,
        request,
      });
      return sendSuccess(request, response, result, 201);
    },
    async linkOwner(request, response) {
      const ownership = await propertyService.linkOwner({
        society: request.society,
        actor: request.auth.user,
        flatId: request.params.flatId,
        ...request.validated.body,
        request,
      });
      return sendSuccess(request, response, { ownership }, 201);
    },
    async listResidents(request, response) {
      const result = await propertyService.listResidents({
        society: request.society,
        query: request.validated.query,
      });
      return sendSuccess(request, response, result);
    },
    async exportResidents(request, response) {
      const result = await propertyService.exportResidents({
        society: request.society,
        query: request.validated.query,
        actor: request.auth.user,
        request,
      });
      return csvResponse(request, response, result, 'residents.csv');
    },
    async createOccupancy(request, response) {
      const occupancy = await propertyService.createOccupancy({
        society: request.society,
        actor: request.auth.user,
        flatId: request.params.flatId,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { occupancy }, 201);
    },
    async endOccupancy(request, response) {
      const occupancy = await propertyService.endOccupancy({
        society: request.society,
        actor: request.auth.user,
        occupancyId: request.params.entityId,
        request,
      });
      return sendSuccess(request, response, { occupancy });
    },
    async endOwnership(request, response) {
      const ownership = await propertyService.endOwnership({
        society: request.society,
        actor: request.auth.user,
        entityId: request.params.entityId,
        request,
      });
      return sendSuccess(request, response, { ownership });
    },
    async createVehicle(request, response) {
      const vehicle = await propertyService.createVehicle({
        society: request.society,
        actor: request.auth.user,
        flatId: request.params.flatId,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { vehicle }, 201);
    },
    async listVehicles(request, response) {
      return sendSuccess(
        request,
        response,
        await propertyService.listVehicles({
          society: request.society,
          membership: request.membership,
          query: request.validated.query,
        }),
      );
    },
    async createParkingSlot(request, response) {
      const parkingSlot = await propertyService.createParkingSlot({
        society: request.society,
        actor: request.auth.user,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { parkingSlot }, 201);
    },
    async listParkingSlots(request, response) {
      return sendSuccess(request, response, {
        parkingSlots: await propertyService.listParkingSlots({
          society: request.society,
          membership: request.membership,
        }),
      });
    },
    async assignParking(request, response) {
      const assignment = await propertyService.assignParking({
        society: request.society,
        actor: request.auth.user,
        parkingSlotId: request.params.parkingSlotId,
        data: request.validated.body,
        request,
      });
      return sendSuccess(request, response, { assignment }, 201);
    },
    async endParkingAssignment(request, response) {
      const assignment = await propertyService.endParkingAssignment({
        society: request.society,
        actor: request.auth.user,
        entityId: request.params.entityId,
        request,
      });
      return sendSuccess(request, response, { assignment });
    },
    async importRecords(request, response) {
      const result = await propertyService.importRecords({
        society: request.society,
        actor: request.auth.user,
        type: request.validated.body.type,
        records: request.validated.body.records,
        request,
      });
      return sendSuccess(request, response, result, 201);
    },
    async importErrors(request, response) {
      const report = await propertyService.getImportErrors({
        society: request.society,
        importId: request.params.importId,
        actor: request.auth.user,
        request,
      });
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.setHeader('content-disposition', 'attachment; filename="import-errors.csv"');
      return response.status(200).send(report);
    },
    async myProperty(request, response) {
      return sendSuccess(
        request,
        response,
        await propertyService.myProperty({
          society: request.society,
          membership: request.membership,
        }),
      );
    },
  };
}

module.exports = { createPropertyController };
