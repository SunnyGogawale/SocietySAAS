const { AppError } = require('../utils/AppError');

function notFound(request, response, next) {
  next(new AppError(404, 'not_found', 'The requested resource was not found'));
}

module.exports = { notFound };
