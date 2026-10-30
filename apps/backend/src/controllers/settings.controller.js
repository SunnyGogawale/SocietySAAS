const { sendSuccess } = require('../utils/apiResponse');

function createSettingsController({ settingsService }) {
  return {
    async getSettings(request, response) {
      return sendSuccess(
        request,
        response,
        await settingsService.getSocietySettings({
          society: request.society,
          isAdmin: request.membership.role === 'society_admin',
        }),
      );
    },
    async updateSettings(request, response) {
      return sendSuccess(
        request,
        response,
        await settingsService.updateSocietySettings({
          society: request.society,
          actor: request.auth.user,
          changes: request.validated.body,
          request,
        }),
      );
    },
  };
}

module.exports = { createSettingsController };
