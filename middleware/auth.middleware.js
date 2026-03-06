/**
 * Authentication Middleware
 * Verifies JWT tokens and protects routes
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7);

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    // Check if user still exists and is active
    const user = await db.getOne(
      'SELECT id, username, email, full_name, avatar_url, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Token invalid.'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Attach user to request object
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.'
    });
  }
};

// Optional auth - doesn't require token but attaches user if present
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    const user = await db.getOne(
      'SELECT id, username, email, full_name, avatar_url FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.userId]
    );

    if (user) {
      req.user = user;
      req.userId = user.id;
    }

    next();
  } catch (error) {
    next();
  }
};

// Socket.io auth middleware
const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    const user = await db.getOne(
      'SELECT id, username, email, full_name, avatar_url FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.userId]
    );

    if (!user) {
      return next(new Error('User not found'));
    }

    socket.user = user;
    socket.userId = user.id;
    
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
};

module.exports = {
  authMiddleware,
  optionalAuth,
  socketAuth
};