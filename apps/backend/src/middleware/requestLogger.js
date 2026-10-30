const pinoHttp = require('pino-http');
const { randomUUID } = require('node:crypto');

function createRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId: (request, response) => {
      const suppliedId = request.headers['x-request-id'];
      const id =
        typeof suppliedId === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(suppliedId)
          ? suppliedId
          : randomUUID();
      response.setHeader('x-request-id', id);
      return id;
    },
    serializers: {
      req: (request) => ({
        id: request.id,
        method: request.method,
        url: request.url.split('?')[0],
      }),
    },
  });
}

module.exports = { createRequestLogger };
