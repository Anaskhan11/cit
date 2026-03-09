/**
 * Group Routes
 * Handles group creation, management, and membership
 */

const express = require('express');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');
const { createGroupValidation, joinGroupValidation } = require('../middleware/validation.middleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/groups
 * @desc    Get all groups (public) and user's groups
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    
    let groups;
    
    if (type === 'my') {
      // Get user's groups
      groups = await db.getMany(
        'SELECT g.id, g.name, g.description, g.type, g.avatar_url, g.created_at, gm.role, gm.joined_at, (SELECT COUNT(*) FROM `group_members` WHERE group_id = g.id) as member_count, (SELECT COUNT(*) FROM `messages` WHERE group_id = g.id AND is_deleted = FALSE) as message_count FROM `groups` g JOIN `group_members` gm ON g.id = gm.group_id WHERE gm.user_id = ? AND g.is_active = TRUE ORDER BY g.created_at DESC',
        [req.userId]
      );
    } else if (type === 'public') {
      // Get public groups user is not in
      groups = await db.getMany(
        'SELECT g.id, g.name, g.description, g.avatar_url, g.created_at, u.username as creator_username, u.full_name as creator_name, (SELECT COUNT(*) FROM `group_members` WHERE group_id = g.id) as member_count FROM `groups` g JOIN `users` u ON g.creator_id = u.id WHERE g.type = "public" AND g.is_active = TRUE AND g.id NOT IN (SELECT group_id FROM `group_members` WHERE user_id = ?) ORDER BY g.created_at DESC LIMIT 50',
        [req.userId]
      );
    } else {
      // Get all groups
      groups = await db.getMany(
        'SELECT g.id, g.name, g.description, g.type, g.avatar_url, g.created_at, u.username as creator_username, (SELECT COUNT(*) FROM `group_members` WHERE group_id = g.id) as member_count, EXISTS(SELECT 1 FROM `group_members` WHERE group_id = g.id AND user_id = ?) as is_member FROM `groups` g JOIN `users` u ON g.creator_id = u.id WHERE g.is_active = TRUE ORDER BY g.created_at DESC LIMIT 50',
        [req.userId]
      );
    }

    res.json({
      success: true,
      data: { groups }
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching groups'
    });
  }
});

/**
 * @route   POST /api/groups
 * @desc    Create a new group
 * @access  Private
 */
router.post('/', createGroupValidation, async (req, res) => {
  try {
    const { name, description, type, maxMembers } = req.body;

    // Create group
    const groupId = await db.insert(
      'INSERT INTO groups (name, description, creator_id, type, max_members) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, req.userId, type || 'public', maxMembers || 100]
    );

    // Add creator as admin
    await db.insert(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [groupId, req.userId, 'admin']
    );

    // Get created group
    const group = await db.getOne(
      'SELECT g.*, gm.role, (SELECT COUNT(*) FROM `group_members` WHERE group_id = g.id) as member_count FROM `groups` g JOIN `group_members` gm ON g.id = gm.group_id WHERE g.id = ? AND gm.user_id = ?',
      [groupId, req.userId]
    );

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { group }
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating group'
    });
  }
});

/**
 * @route   GET /api/groups/:groupId
 * @desc    Get group details
 * @access  Private
 */
router.get('/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await db.getOne(
      'SELECT g.*, u.username as creator_username, u.full_name as creator_name, (SELECT COUNT(*) FROM `group_members` WHERE group_id = g.id) as member_count, (SELECT COUNT(*) FROM `messages` WHERE group_id = g.id AND is_deleted = FALSE) as message_count, EXISTS(SELECT 1 FROM `group_members` WHERE group_id = g.id AND user_id = ?) as is_member, (SELECT role FROM `group_members` WHERE group_id = g.id AND user_id = ?) as user_role FROM `groups` g JOIN `users` u ON g.creator_id = u.id WHERE g.id = ? AND g.is_active = TRUE',
      [req.userId, req.userId, groupId]
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Get members
    const members = await db.getMany(
      'SELECT u.id, u.username, u.full_name, u.avatar_url, gm.role, gm.joined_at, gm.is_muted FROM `group_members` gm JOIN `users` u ON gm.user_id = u.id WHERE gm.group_id = ? AND u.is_active = TRUE ORDER BY gm.role, gm.joined_at',
      [groupId]
    );

    res.json({
      success: true,
      data: { group, members }
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching group'
    });
  }
});

/**
 * @route   POST /api/groups/:groupId/join
 * @desc    Join a group
 * @access  Private
 */
router.post('/:groupId/join', joinGroupValidation, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Check if group exists and is active
    const group = await db.getOne(
      'SELECT id, type, max_members FROM groups WHERE id = ? AND is_active = TRUE',
      [groupId]
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if already a member
    const existingMember = await db.getOne(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this group'
      });
    }

    // Check member limit
    const memberCount = await db.getOne(
      'SELECT COUNT(*) as count FROM group_members WHERE group_id = ?',
      [groupId]
    );

    if (memberCount.count >= group.max_members) {
      return res.status(400).json({
        success: false,
        message: 'Group has reached maximum member limit'
      });
    }

    // Add member
    await db.insert(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [groupId, req.userId, 'member']
    );

    // Add system message
    const user = await db.getOne(
      'SELECT full_name FROM users WHERE id = ?',
      [req.userId]
    );

    await db.insert(
      'INSERT INTO messages (group_id, sender_id, content, message_type) VALUES (?, ?, ?, ?)',
      [groupId, req.userId, `${user.full_name} joined the group`, 'system']
    );

    res.json({
      success: true,
      message: 'Joined group successfully'
    });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({
      success: false,
      message: 'Error joining group'
    });
  }
});

/**
 * @route   POST /api/groups/:groupId/leave
 * @desc    Leave a group
 * @access  Private
 */
router.post('/:groupId/leave', async (req, res) => {
  try {
    const { groupId } = req.params;

    // Check if member
    const membership = await db.getOne(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (!membership) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    // If admin, check if there are other admins
    if (membership.role === 'admin') {
      const otherAdmins = await db.getOne(
        `SELECT COUNT(*) as count FROM group_members 
         WHERE group_id = ? AND role = 'admin' AND user_id != ?`,
        [groupId, req.userId]
      );

      if (otherAdmins.count === 0) {
        // Transfer ownership to oldest moderator or member
        const newAdmin = await db.getOne(
          `SELECT user_id FROM group_members 
           WHERE group_id = ? AND user_id != ?
           ORDER BY role = 'moderator' DESC, joined_at ASC
           LIMIT 1`,
          [groupId, req.userId]
        );

        if (newAdmin) {
          await db.update(
            'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?',
            ['admin', groupId, newAdmin.user_id]
          );
        } else {
          // No other members, delete the group
          await db.update(
            'UPDATE groups SET is_active = FALSE WHERE id = ?',
            [groupId]
          );
        }
      }
    }

    // Remove member
    await db.delete(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    // Add system message
    const user = await db.getOne(
      'SELECT full_name FROM users WHERE id = ?',
      [req.userId]
    );

    await db.insert(
      'INSERT INTO messages (group_id, sender_id, content, message_type) VALUES (?, ?, ?, ?)',
      [groupId, req.userId, `${user.full_name} left the group`, 'system']
    );

    res.json({
      success: true,
      message: 'Left group successfully'
    });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({
      success: false,
      message: 'Error leaving group'
    });
  }
});

/**
 * @route   PUT /api/groups/:groupId
 * @desc    Update group
 * @access  Private (Admin only)
 */
router.put('/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, avatarUrl } = req.body;

    // Check if user is admin
    const membership = await db.getOne(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update group'
      });
    }

    const updateFields = [];
    const values = [];

    if (name) {
      updateFields.push('name = ?');
      values.push(name);
    }

    if (description !== undefined) {
      updateFields.push('description = ?');
      values.push(description);
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

    values.push(groupId);

    await db.update(
      `UPDATE groups SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: 'Group updated successfully'
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating group'
    });
  }
});

/**
 * @route   DELETE /api/groups/:groupId
 * @desc    Delete group
 * @access  Private (Admin only)
 */
router.delete('/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;

    // Check if user is admin
    const membership = await db.getOne(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete group'
      });
    }

    // Soft delete group
    await db.update(
      'UPDATE groups SET is_active = FALSE WHERE id = ?',
      [groupId]
    );

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting group'
    });
  }
});

module.exports = router;