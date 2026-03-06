/**
 * Validation Middleware
 * Request validation using express-validator
 */

const { body, param, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// Auth validations
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  handleValidationErrors
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// Group validations
const createGroupValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Group name must be between 2 and 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('type')
    .optional()
    .isIn(['public', 'private'])
    .withMessage('Type must be either public or private'),
  handleValidationErrors
];

const joinGroupValidation = [
  param('groupId')
    .isInt({ min: 1 })
    .withMessage('Invalid group ID'),
  handleValidationErrors
];

// Message validations
const sendMessageValidation = [
  param('groupId')
    .isInt({ min: 1 })
    .withMessage('Invalid group ID'),
  body('content')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Message content must be between 1 and 5000 characters'),
  body('messageType')
    .optional()
    .isIn(['text', 'image', 'file', 'audio'])
    .withMessage('Invalid message type'),
  handleValidationErrors
];

// Call validations
const initiateCallValidation = [
  body('groupId')
    .isInt({ min: 1 })
    .withMessage('Invalid group ID'),
  body('callType')
    .isIn(['audio', 'video'])
    .withMessage('Call type must be either audio or video'),
  handleValidationErrors
];

// User profile validations
const updateProfileValidation = [
  body('fullName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),
  handleValidationErrors
];

// Learning module validations
const progressUpdateValidation = [
  param('moduleId')
    .isInt({ min: 1 })
    .withMessage('Invalid module ID'),
  body('progress')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Progress must be between 0 and 100'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  registerValidation,
  loginValidation,
  createGroupValidation,
  joinGroupValidation,
  sendMessageValidation,
  initiateCallValidation,
  updateProfileValidation,
  progressUpdateValidation
};