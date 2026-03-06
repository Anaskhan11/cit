/**
 * Dashboard Routes
 * Handles dashboard data and analytics
 */

const express = require('express');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/dashboard
 * @desc    Get main dashboard data
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    // Get user stats
    const userStats = await db.getOne(
      `SELECT 
        u.communication_score,
        u.clarity_score,
        u.tone_score,
        u.response_time_score,
        u.total_messages_sent,
        COUNT(DISTINCT gm.group_id) as group_count
       FROM users u
       LEFT JOIN group_members gm ON u.id = gm.user_id
       WHERE u.id = ?`,
      [req.userId]
    );

    // Get recent messages
    const recentMessages = await db.getMany(
      `SELECT m.id, m.content, m.message_type, m.created_at,
              g.id as group_id, g.name as group_name
       FROM messages m
       JOIN groups g ON m.group_id = g.id
       WHERE m.sender_id = ? AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC
       LIMIT 5`,
      [req.userId]
    );

    // Get recent groups activity
    const recentGroups = await db.getMany(
      `SELECT g.id, g.name, g.avatar_url,
              (SELECT COUNT(*) FROM messages WHERE group_id = g.id AND is_deleted = FALSE) as message_count,
              (SELECT MAX(created_at) FROM messages WHERE group_id = g.id AND is_deleted = FALSE) as last_activity
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ? AND g.is_active = TRUE
       ORDER BY last_activity DESC
       LIMIT 5`,
      [req.userId]
    );

    // Get today's communication score
    const todayScore = await db.getOne(
      `SELECT overall_score, clarity_score, tone_score, messages_sent
       FROM communication_scores
       WHERE user_id = ? AND date = CURDATE()`,
      [req.userId]
    );

    // Get weekly progress
    const weeklyProgress = await db.getMany(
      `SELECT date, overall_score, messages_sent
       FROM communication_scores
       WHERE user_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       ORDER BY date`,
      [req.userId]
    );

    // Get notifications
    const notifications = await db.getMany(
      `SELECT id, type, title, content, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.userId]
    );

    // Get unread count
    const unreadCount = await db.getOne(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE`,
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        userStats,
        recentMessages,
        recentGroups,
        todayScore,
        weeklyProgress,
        notifications,
        unreadNotifications: unreadCount.count
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data'
    });
  }
});

/**
 * @route   GET /api/dashboard/analytics
 * @desc    Get detailed analytics
 * @access  Private
 */
router.get('/analytics', async (req, res) => {
  try {
    const { period = '30' } = req.query; // days

    // Message activity over time
    const messageActivity = await db.getMany(
      `SELECT 
        DATE(m.created_at) as date,
        COUNT(*) as message_count,
        AVG(ma.clarity_score) as avg_clarity
       FROM messages m
       LEFT JOIN message_analysis ma ON m.id = ma.message_id
       WHERE m.sender_id = ?
       AND m.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND m.is_deleted = FALSE
       GROUP BY DATE(m.created_at)
       ORDER BY date`,
      [req.userId, parseInt(period)]
    );

    // Tone analysis
    const toneAnalysis = await db.getMany(
      `SELECT 
        ma.tone,
        COUNT(*) as count,
        AVG(ma.clarity_score) as avg_clarity
       FROM message_analysis ma
       JOIN messages m ON ma.message_id = m.id
       WHERE m.sender_id = ?
       AND m.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY ma.tone`,
      [req.userId, parseInt(period)]
    );

    // Group participation
    const groupParticipation = await db.getMany(
      `SELECT 
        g.name,
        COUNT(m.id) as message_count,
        AVG(ma.clarity_score) as avg_clarity
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       LEFT JOIN messages m ON g.id = m.group_id AND m.sender_id = ? AND m.is_deleted = FALSE
       LEFT JOIN message_analysis ma ON m.id = ma.message_id
       WHERE gm.user_id = ?
       AND g.is_active = TRUE
       GROUP BY g.id
       ORDER BY message_count DESC
       LIMIT 10`,
      [req.userId, req.userId]
    );

    // Response time analysis (if we track it)
    const responseTimeData = await db.getMany(
      `SELECT 
        DATE(created_at) as date,
        AVG(response_time_seconds) as avg_response_time
       FROM communication_scores
       WHERE user_id = ?
       AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [req.userId, parseInt(period)]
    );

    // Improvement areas
    const improvementAreas = await db.getMany(
      `SELECT 
        'Clarity' as area,
        AVG(clarity_score) as score
       FROM communication_scores
       WHERE user_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       UNION ALL
       SELECT 
        'Tone' as area,
        AVG(tone_score) as score
       FROM communication_scores
       WHERE user_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       UNION ALL
       SELECT 
        'Response Time' as area,
        AVG(response_time_score) as score
       FROM communication_scores
       WHERE user_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [req.userId, parseInt(period), req.userId, parseInt(period), req.userId, parseInt(period)]
    );

    res.json({
      success: true,
      data: {
        messageActivity,
        toneAnalysis,
        groupParticipation,
        responseTimeData,
        improvementAreas
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics'
    });
  }
});

/**
 * @route   GET /api/dashboard/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/notifications', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const notifications = await db.getMany(
      `SELECT id, type, title, content, related_id, is_read, read_at, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, parseInt(limit), parseInt(offset)]
    );

    res.json({
      success: true,
      data: { notifications }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
});

/**
 * @route   PUT /api/dashboard/notifications/:notificationId/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/notifications/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;

    await db.update(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?',
      [notificationId, req.userId]
    );

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notification as read'
    });
  }
});

/**
 * @route   PUT /api/dashboard/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/notifications/read-all', async (req, res) => {
  try {
    await db.update(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE',
      [req.userId]
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notifications as read'
    });
  }
});

module.exports = router;