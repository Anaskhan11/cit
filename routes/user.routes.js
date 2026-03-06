/**
 * User Routes
 * Handles user profile, settings, and related operations
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');
const { updateProfileValidation } = require('../middleware/validation.middleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/users/profile
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile', async (req, res) => {
  try {
    const user = await db.getOne(
      `SELECT u.id, u.username, u.email, u.full_name, u.avatar_url, u.bio,
              u.communication_score, u.total_messages_sent, u.total_messages_received,
              u.clarity_score, u.tone_score, u.response_time_score,
              u.created_at, u.last_seen,
              us.theme, us.language, us.email_notifications, us.push_notifications,
              us.auto_analyze_messages, us.show_communication_score
       FROM users u
       LEFT JOIN user_settings us ON u.id = us.user_id
       WHERE u.id = ?`,
      [req.userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile'
    });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', updateProfileValidation, async (req, res) => {
  try {
    const { fullName, bio, avatarUrl } = req.body;

    const updateFields = [];
    const values = [];

    if (fullName) {
      updateFields.push('full_name = ?');
      values.push(fullName);
    }

    if (bio !== undefined) {
      updateFields.push('bio = ?');
      values.push(bio);
    }

    if (avatarUrl) {
      updateFields.push('avatar_url = ?');
      values.push(avatarUrl);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(req.userId);

    await db.update(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
});

/**
 * @route   PUT /api/users/password
 * @desc    Change password
 * @access  Private
 */
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    // Get current password
    const user = await db.getOne(
      'SELECT password FROM users WHERE id = ?',
      [req.userId]
    );

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await db.update(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password'
    });
  }
});

/**
 * @route   GET /api/users/settings
 * @desc    Get user settings
 * @access  Private
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await db.getOne(
      `SELECT theme, language, email_notifications, push_notifications,
              message_preview, auto_analyze_messages, show_communication_score,
              audio_quality, video_quality
       FROM user_settings WHERE user_id = ?`,
      [req.userId]
    );

    res.json({
      success: true,
      data: { settings }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settings'
    });
  }
});

/**
 * @route   PUT /api/users/settings
 * @desc    Update user settings
 * @access  Private
 */
router.put('/settings', async (req, res) => {
  try {
    const {
      theme,
      language,
      emailNotifications,
      pushNotifications,
      messagePreview,
      autoAnalyzeMessages,
      showCommunicationScore,
      audioQuality,
      videoQuality
    } = req.body;

    const updateFields = [];
    const values = [];

    if (theme) {
      updateFields.push('theme = ?');
      values.push(theme);
    }

    if (language) {
      updateFields.push('language = ?');
      values.push(language);
    }

    if (emailNotifications !== undefined) {
      updateFields.push('email_notifications = ?');
      values.push(emailNotifications);
    }

    if (pushNotifications !== undefined) {
      updateFields.push('push_notifications = ?');
      values.push(pushNotifications);
    }

    if (messagePreview !== undefined) {
      updateFields.push('message_preview = ?');
      values.push(messagePreview);
    }

    if (autoAnalyzeMessages !== undefined) {
      updateFields.push('auto_analyze_messages = ?');
      values.push(autoAnalyzeMessages);
    }

    if (showCommunicationScore !== undefined) {
      updateFields.push('show_communication_score = ?');
      values.push(showCommunicationScore);
    }

    if (audioQuality) {
      updateFields.push('audio_quality = ?');
      values.push(audioQuality);
    }

    if (videoQuality) {
      updateFields.push('video_quality = ?');
      values.push(videoQuality);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No settings to update'
      });
    }

    values.push(req.userId);

    await db.update(
      `UPDATE user_settings SET ${updateFields.join(', ')} WHERE user_id = ?`,
      values
    );

    res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating settings'
    });
  }
});

/**
 * @route   GET /api/users/search
 * @desc    Search users
 * @access  Private
 */
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const searchTerm = `%${query}%`;

    const users = await db.getMany(
      `SELECT id, username, full_name, avatar_url, bio
       FROM users
       WHERE (username LIKE ? OR full_name LIKE ? OR email LIKE ?)
       AND id != ?
       AND is_active = TRUE
       LIMIT 20`,
      [searchTerm, searchTerm, searchTerm, req.userId]
    );

    res.json({
      success: true,
      data: { users }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching users'
    });
  }
});

/**
 * @route   GET /api/users/:userId
 * @desc    Get public user profile
 * @access  Private
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await db.getOne(
      `SELECT id, username, full_name, avatar_url, bio,
              communication_score, created_at
       FROM users
       WHERE id = ? AND is_active = TRUE`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
});

module.exports = router;