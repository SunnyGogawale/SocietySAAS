const { ZodError } = require('zod');
const { AppError } = require('../utils/AppError');
const { sendError } = require('../utils/apiResponse');

function errorHandler(logger) {
  return (error, request, response, next) => {
    if (response.headersSent) return next(error);

    let normalized = error;
    if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      normalized = new AppError(400, 'invalid_json', 'Request body contains invalid JSON');
    } else if (error instanceof ZodError) {
      normalized = new AppError(422, 'validation_failed', 'Request validation failed');
    } else if (error.type === 'entity.too.large') {
      normalized = new AppError(413, 'request_too_large', 'Request body exceeds the allowed size');
    } else if (error.code === 11000) {
      normalized = new AppError(
        409,
        'resource_conflict',
        'A record with these details already exists',
      );
    }

    const statusCode = normalized instanceof AppError ? normalized.statusCode : 500;
    const code = normalized instanceof AppError ? normalized.code : 'internal_error';
    const message =
      normalized instanceof AppError && statusCode < 500
        ? normalized.message
        : 'An unexpected error occurred';
    const details =
      normalized instanceof AppError && statusCode < 500 ? normalized.details : undefined;

    if (statusCode >= 500) {
      logger.error({ err: normalized, requestId: request.id }, 'Request failed');
    } else {
      logger.warn({ code, requestId: request.id }, 'Request rejected');
    }

    return sendError(request, response, { statusCode, code, message, details });
  };
}

module.exports = { errorHandler };
