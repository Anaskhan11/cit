/**
 * Learning Routes
 * Handles learning modules and user progress
 */

const express = require('express');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');
const { progressUpdateValidation } = require('../middleware/validation.middleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/learning/modules
 * @desc    Get all learning modules
 * @access  Private
 */
router.get('/modules', async (req, res) => {
  try {
    const { category, difficulty } = req.query;

    let sql = `
      SELECT lm.*,
             ulp.progress_percentage,
             ulp.completed_at,
             ulp.points_earned
      FROM learning_modules lm
      LEFT JOIN user_learning_progress ulp 
        ON lm.id = ulp.module_id AND ulp.user_id = ?
      WHERE lm.is_active = TRUE
    `;
    
    const params = [req.userId];

    if (category) {
      sql += ' AND lm.category = ?';
      params.push(category);
    }

    if (difficulty) {
      sql += ' AND lm.difficulty_level = ?';
      params.push(difficulty);
    }

    sql += ' ORDER BY lm.difficulty_level, lm.created_at';

    const modules = await db.getMany(sql, params);

    res.json({
      success: true,
      data: { modules }
    });
  } catch (error) {
    console.error('Get modules error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching learning modules'
    });
  }
});

/**
 * @route   GET /api/learning/modules/:moduleId
 * @desc    Get a specific learning module
 * @access  Private
 */
router.get('/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;

    const module = await db.getOne(
      `SELECT lm.*,
              ulp.progress_percentage,
              ulp.started_at,
              ulp.completed_at,
              ulp.points_earned,
              ulp.notes
       FROM learning_modules lm
       LEFT JOIN user_learning_progress ulp 
         ON lm.id = ulp.module_id AND ulp.user_id = ?
       WHERE lm.id = ? AND lm.is_active = TRUE`,
      [req.userId, moduleId]
    );

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }

    // If not started, create progress record
    if (!module.progress_percentage && module.progress_percentage !== 0) {
      await db.insert(
        'INSERT INTO user_learning_progress (user_id, module_id, progress_percentage) VALUES (?, ?, ?)',
        [req.userId, moduleId, 0]
      );
      module.progress_percentage = 0;
      module.started_at = new Date();
    }

    res.json({
      success: true,
      data: { module }
    });
  } catch (error) {
    console.error('Get module error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching module'
    });
  }
});

/**
 * @route   PUT /api/learning/modules/:moduleId/progress
 * @desc    Update learning progress
 * @access  Private
 */
router.put('/modules/:moduleId/progress', progressUpdateValidation, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { progress, notes } = req.body;

    // Check if module exists
    const module = await db.getOne(
      'SELECT points_reward FROM learning_modules WHERE id = ? AND is_active = TRUE',
      [moduleId]
    );

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }

    // Check if progress record exists
    const existingProgress = await db.getOne(
      'SELECT id, completed_at FROM user_learning_progress WHERE user_id = ? AND module_id = ?',
      [req.userId, moduleId]
    );

    let pointsEarned = 0;
    let completedAt = null;

    if (progress >= 100) {
      completedAt = new Date();
      pointsEarned = module.points_reward;
    }

    if (existingProgress) {
      // Don't update if already completed
      if (existingProgress.completed_at) {
        return res.json({
          success: true,
          message: 'Module already completed',
          data: { completed: true }
        });
      }

      await db.update(
        `UPDATE user_learning_progress 
         SET progress_percentage = ?, 
             completed_at = ?,
             points_earned = ?,
             notes = ?
         WHERE user_id = ? AND module_id = ?`,
        [progress, completedAt, pointsEarned, notes || null, req.userId, moduleId]
      );
    } else {
      await db.insert(
        `INSERT INTO user_learning_progress 
         (user_id, module_id, progress_percentage, completed_at, points_earned, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.userId, moduleId, progress, completedAt, pointsEarned, notes || null]
      );
    }

    res.json({
      success: true,
      message: progress >= 100 ? 'Module completed!' : 'Progress updated',
      data: { 
        progress,
        completed: progress >= 100,
        pointsEarned
      }
    });
  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating progress'
    });
  }
});

/**
 * @route   GET /api/learning/my-progress
 * @desc    Get user's overall learning progress
 * @access  Private
 */
router.get('/my-progress', async (req, res) => {
  try {
    // Get overall stats
    const stats = await db.getOne(
      `SELECT 
        COUNT(DISTINCT lm.id) as total_modules,
        COUNT(DISTINCT CASE WHEN ulp.completed_at IS NOT NULL THEN lm.id END) as completed_modules,
        COUNT(DISTINCT CASE WHEN ulp.progress_percentage > 0 AND ulp.completed_at IS NULL THEN lm.id END) as in_progress_modules,
        SUM(ulp.points_earned) as total_points,
        AVG(ulp.progress_percentage) as avg_progress
       FROM learning_modules lm
       LEFT JOIN user_learning_progress ulp 
         ON lm.id = ulp.module_id AND ulp.user_id = ?
       WHERE lm.is_active = TRUE`,
      [req.userId]
    );

    // Get progress by category
    const categoryProgress = await db.getMany(
      `SELECT 
        lm.category,
        COUNT(DISTINCT lm.id) as total,
        COUNT(DISTINCT CASE WHEN ulp.completed_at IS NOT NULL THEN lm.id END) as completed
       FROM learning_modules lm
       LEFT JOIN user_learning_progress ulp 
         ON lm.id = ulp.module_id AND ulp.user_id = ?
       WHERE lm.is_active = TRUE
       GROUP BY lm.category`,
      [req.userId]
    );

    // Get recently completed modules
    const recentCompleted = await db.getMany(
      `SELECT lm.id, lm.title, lm.category, lm.difficulty_level,
              ulp.completed_at, ulp.points_earned
       FROM learning_modules lm
       JOIN user_learning_progress ulp ON lm.id = ulp.module_id
       WHERE ulp.user_id = ? AND ulp.completed_at IS NOT NULL
       ORDER BY ulp.completed_at DESC
       LIMIT 5`,
      [req.userId]
    );

    // Get recommended modules
    const recommended = await db.getMany(
      `SELECT lm.*
       FROM learning_modules lm
       LEFT JOIN user_learning_progress ulp 
         ON lm.id = ulp.module_id AND ulp.user_id = ?
       WHERE lm.is_active = TRUE
       AND (ulp.id IS NULL OR (ulp.progress_percentage < 100 AND ulp.completed_at IS NULL))
       ORDER BY lm.difficulty_level, RAND()
       LIMIT 3`,
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        stats,
        categoryProgress,
        recentCompleted,
        recommended
      }
    });
  } catch (error) {
    console.error('Get my progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching progress'
    });
  }
});

/**
 * @route   GET /api/learning/categories
 * @desc    Get learning module categories
 * @access  Private
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = await db.getMany(
      `SELECT 
        category,
        COUNT(*) as module_count,
        SUM(CASE WHEN ulp.completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed_count
       FROM learning_modules lm
       LEFT JOIN user_learning_progress ulp 
         ON lm.id = ulp.module_id AND ulp.user_id = ?
       WHERE lm.is_active = TRUE
       GROUP BY category`,
      [req.userId]
    );

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories'
    });
  }
});

module.exports = router;