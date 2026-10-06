/**
 * Global error handling middleware.
 * Catches unhandled errors and returns a structured JSON response.
 */
export function errorHandler(err, req, res, next) {
  console.error('[ERROR] Unhandled error:', err.stack || err.message);

  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
  });
}

/**
 * 404 handler for undefined routes.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'error',
    statusCode: 404,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}
