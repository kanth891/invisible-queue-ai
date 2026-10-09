import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Middleware to verify JWT token from Authorization header.
 * Attaches decoded user payload to req.user.
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

/**
 * Factory: restrict access to certain roles.
 * Usage: authorize('ADMIN', 'RECEPTIONIST')
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ status: 'error', message: 'Access denied: insufficient permissions' });
    }
    next();
  };
}
