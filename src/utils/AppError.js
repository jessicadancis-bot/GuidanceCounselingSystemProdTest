class AppError extends Error {
  constructor(
    message,
    statusCode,
    errors = null,
    errorCodes = null,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;
    this.errorCodes = errorCodes;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
