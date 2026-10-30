function sendSuccess(request, response, data, statusCode = 200, meta) {
  const payload = { success: true, data, requestId: request.id };
  if (meta !== undefined) payload.meta = meta;

  return response.status(statusCode).set('x-request-id', request.id).json(payload);
}

function sendError(request, response, { statusCode = 500, code, message, details }) {
  const payload = {
    success: false,
    error: { code, message },
    requestId: request.id,
  };
  if (details !== undefined) payload.error.details = details;

  return response.status(statusCode).set('x-request-id', request.id).json(payload);
}

module.exports = { sendError, sendSuccess };
