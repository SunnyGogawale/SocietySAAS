const { AppError } = require('../utils/AppError');

function validateRequest(schemas) {
  return (request, response, next) => {
    const validated = {};
    for (const [location, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(request[location]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: [location, ...issue.path].join('.'),
          message: issue.message,
        }));
        return next(new AppError(422, 'validation_failed', 'Request validation failed', details));
      }
      validated[location] = result.data;
    }
    request.validated = validated;
    return next();
  };
}

module.exports = { validateRequest };
