const { randomUUID } = require('node:crypto');

function requestId(request, response, next) {
  const suppliedId = request.get('x-request-id');
  request.id = suppliedId && /^[a-zA-Z0-9._-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
  response.setHeader('x-request-id', request.id);
  next();
}

module.exports = { requestId };
