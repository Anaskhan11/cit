/**
 * Analysis Routes
 * Handles AI-powered message analysis and communication insights
 */

const express = require('express');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');
const analysisService = require('../services/analysis.service');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   POST /api/analyze
 * @desc    Analyze a message without sending it
 * @access  Private
 */
router.post('/analyze', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    // Analyze message
    const analysis = await analysisService.analyzeMessage(content);

    res.json({
      success: true,
      data: { analysis }
    });
  } catch (error) {
    console.error('Analyze message error:', error);
    res.status(500).json({
      success: false,
      message: 'Error analyzing message'
    });
  }
});

/**
 * @route   GET /api/analysis/message/:messageId
 * @desc    Get analysis for a specific message
 * @access  Private
 */
router.get('/message/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;

    const analysis = await db.getOne(
      'SELECT ma.*, m.content, m.sender_id, m.group_id FROM `message_analysis` ma JOIN `messages` m ON ma.message_id = m.id WHERE ma.message_id = ?',
      [messageId]
    );

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'Analysis not found'
      });
    }

    // Check if user has access to this message
    const membership = await db.getOne(
      'SELECT id FROM `group_members` WHERE group_id = ? AND user_id = ?',
      [analysis.group_id, req.userId]
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this message'
      });
    }

    res.json({
      success: true,
      data: { analysis }
    });
  } catch (error) {
    console.error('Get message analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching message analysis'
    });
  }
});

/**
 * @route   GET /api/analysis/my-stats
 * @desc    Get user's communication statistics
 * @access  Private
 */
router.get('/my-stats', async (req, res) => {
  try {
    // Get overall stats
    const stats = await db.getOne(
      'SELECT COUNT(m.id) as total_messages, AVG(ma.clarity_score) as avg_clarity, AVG(ma.readability_score) as avg_readability, COUNT(CASE WHEN ma.tone IN ("positive", "very_positive") THEN 1 END) as positive_messages, COUNT(CASE WHEN ma.tone IN ("negative", "very_negative") THEN 1 END) as negative_messages, COUNT(CASE WHEN ma.potential_misunderstanding = TRUE THEN 1 END) as misunderstandings, AVG(LENGTH(m.content)) as avg_message_length FROM `messages` m LEFT JOIN `message_analysis` ma ON m.id = ma.message_id WHERE m.sender_id = ? AND m.is_deleted = FALSE AND m.message_type = "text"',
      [req.userId]
    );

    // Get tone distribution
    const toneDistribution = await db.getMany(
      'SELECT ma.tone, COUNT(*) as count FROM `message_analysis` ma JOIN `messages` m ON ma.message_id = m.id WHERE m.sender_id = ? AND m.is_deleted = FALSE GROUP BY ma.tone',
      [req.userId]
    );

    // Get recent scores
    const recentScores = await db.getMany(
      'SELECT date, overall_score, clarity_score, tone_score, response_time_score FROM communication_scores WHERE user_id = ? ORDER BY date DESC LIMIT 30',
      [req.userId]
    );

    // Get improvement suggestions
    const suggestions = await analysisService.generateSuggestions(req.userId);

    res.json({
      success: true,
      data: {
        stats,
        toneDistribution,
        recentScores,
        suggestions
      }
    });
  } catch (error) {
    console.error('Get my stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics'
    });
  }
});

/**
 * @route   GET /api/analysis/tips
 * @desc    Get communication tips for user
 * @access  Private
 */
router.get('/tips', async (req, res) => {
  try {
    // Get tips that haven't been shown to user
    const tips = await db.getMany(
      'SELECT ct.* FROM communication_tips ct WHERE ct.is_active = TRUE AND ct.id NOT IN (SELECT tip_id FROM user_tips WHERE user_id = ?) ORDER BY ct.priority ASC, RAND() LIMIT 5',
      [req.userId]
    );

    // If no new tips, get random tips
    if (tips.length === 0) {
      const randomTips = await db.getMany(
        'SELECT ct.* FROM communication_tips ct WHERE ct.is_active = TRUE ORDER BY RAND() LIMIT 5'
      );
      return res.json({
        success: true,
        data: { tips: randomTips }
      });
    }

    // Record that tips were shown
    for (const tip of tips) {
      await db.insert(
        'INSERT INTO user_tips (user_id, tip_id) VALUES (?, ?)',
        [req.userId, tip.id]
      );
    }

    res.json({
      success: true,
      data: { tips }
    });
  } catch (error) {
    console.error('Get tips error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tips'
    });
  }
});

/**
 * @route   POST /api/analysis/tips/:tipId/feedback
 * @desc    Provide feedback on a tip
 * @access  Private
 */
router.post('/tips/:tipId/feedback', async (req, res) => {
  try {
    const { tipId } = req.params;
    const { helpful } = req.body;

    await db.update(
      'UPDATE user_tips SET helpful = ?, acknowledged = TRUE, acknowledged_at = NOW() WHERE user_id = ? AND tip_id = ?',
      [helpful, req.userId, tipId]
    );

    res.json({
      success: true,
      message: 'Feedback recorded'
    });
  } catch (error) {
    console.error('Tip feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error recording feedback'
    });
  }
});

/**
 * @route   GET /api/analysis/misunderstandings
 * @desc    Get detected misunderstandings for user
 * @access  Private
 */
router.get('/misunderstandings', async (req, res) => {
  try {
    const misunderstandings = await db.getMany(
      'SELECT m.*, msg.content as message_content, g.name as group_name FROM misunderstandings m JOIN `messages` msg ON m.message_id = msg.id JOIN `groups` g ON m.group_id = g.id WHERE m.detected_by_user_id = ? OR msg.sender_id = ? ORDER BY m.detected_at DESC LIMIT 50',
      [req.userId, req.userId]
    );

    res.json({
      success: true,
      data: { misunderstandings }
    });
  } catch (error) {
    console.error('Get misunderstandings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching misunderstandings'
    });
  }
});

/**
 * @route   POST /api/analysis/misunderstanding
 * @desc    Report a misunderstanding
 * @access  Private
 */
router.post('/misunderstanding', async (req, res) => {
  try {
    const { messageId, issueType, description } = req.body;

    // Get message details
    const message = await db.getOne(
      'SELECT group_id, sender_id FROM messages WHERE id = ?',
      [messageId]
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is member of group
    const membership = await db.getOne(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [message.group_id, req.userId]
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const misunderstandingId = await db.insert(
      'INSERT INTO misunderstandings (group_id, message_id, detected_by_user_id, issue_type, description) VALUES (?, ?, ?, ?, ?)',
      [message.group_id, messageId, req.userId, issueType, description]
    );

    res.status(201).json({
      success: true,
      message: 'Misunderstanding reported',
      data: { misunderstandingId }
    });
  } catch (error) {
    console.error('Report misunderstanding error:', error);
    res.status(500).json({
      success: false,
      message: 'Error reporting misunderstanding'
    });
  }
});

/**
 * @route   GET /api/analysis/leaderboard
 * @desc    Get communication score leaderboard
 * @access  Private
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const { period = 'all' } = req.query;

    let dateFilter = '';
    if (period === 'week') {
      dateFilter = 'AND cs.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (period === 'month') {
      dateFilter = 'AND cs.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }

    const leaderboard = await db.getMany(
      `SELECT u.id, u.username, u.full_name, u.avatar_url, u.communication_score as score, COUNT(DISTINCT m.id) as message_count FROM users u LEFT JOIN \`messages\` m ON u.id = m.sender_id AND m.is_deleted = FALSE LEFT JOIN communication_scores cs ON u.id = cs.user_id ${dateFilter} WHERE u.is_active = TRUE GROUP BY u.id ORDER BY u.communication_score DESC LIMIT 20`
    );

    // Get user's rank
    const userRank = await db.getOne(
      'SELECT COUNT(*) + 1 as `rank` FROM users WHERE communication_score > (SELECT communication_score FROM users WHERE id = ?) AND is_active = TRUE',
      [req.userId]
    );

    res.json({
      success: true,
      data: { 
        leaderboard,
        userRank: userRank?.rank
      }
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching leaderboard'
    });
  }
});

module.exports = router;