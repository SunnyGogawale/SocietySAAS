const pino = require('pino');

function createLogger(config) {
  return pino({
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  });
}

module.exports = { createLogger };
