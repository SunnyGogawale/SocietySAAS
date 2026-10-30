const { z } = require('zod');

const healthQuerySchema = z.strictObject({});

module.exports = { healthQuerySchema };
