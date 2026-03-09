/**
 * Call Routes
 * Handles audio/video call management and WebRTC signaling
 */

const express = require('express');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');
const { initiateCallValidation } = require('../middleware/validation.middleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   POST /api/calls/group/:groupId/force-end
 * @desc    Force end any ongoing calls in a group (admin/group creator only)
 * @access  Private
 */
router.post('/group/:groupId/force-end', async (req, res) => {
  try {
    const { groupId } = req.params;

    // Check if user is admin or group creator
    const group = await db.getOne(
      'SELECT creator_id FROM `groups` WHERE id = ?',
      [groupId]
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (group.creator_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only group creator can force end calls'
      });
    }

    // Find and end all ongoing calls in this group
    const ongoingCalls = await db.getMany(
      'SELECT id FROM calls WHERE group_id = ? AND status = "ongoing"',
      [groupId]
    );

    if (ongoingCalls.length === 0) {
      return res.json({
        success: true,
        message: 'No ongoing calls to end'
      });
    }

    for (const call of ongoingCalls) {
      // End the call
      await db.update(
        'UPDATE calls SET status = "ended", ended_at = NOW() WHERE id = ?',
        [call.id]
      );

      // Update all participants
      await db.update(
        'UPDATE call_participants SET left_at = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, joined_at, NOW()) WHERE call_id = ? AND left_at IS NULL',
        [call.id]
      );

      // Calculate total duration
      await db.update(
        'UPDATE calls SET duration_seconds = TIMESTAMPDIFF(SECOND, started_at, ended_at) WHERE id = ?',
        [call.id]
      );
    }

    res.json({
      success: true,
      message: `Force ended ${ongoingCalls.length} call(s)`
    });
  } catch (error) {
    console.error('Force end call error:', error);
    res.status(500).json({
      success: false,
      message: 'Error force ending calls'
    });
  }
});

/**
 * @route   POST /api/calls/initiate
 * @desc    Initiate a new call
 * @access  Private
 */
router.post('/initiate', initiateCallValidation, async (req, res) => {
  try {
    const { groupId, callType } = req.body;

    // Check if user is member of group
    const membership = await db.getOne(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    // Check if there's already an ongoing call
    const ongoingCall = await db.getOne(
      'SELECT id FROM calls WHERE group_id = ? AND status = "ongoing"',
      [groupId]
    );

    if (ongoingCall) {
      return res.status(400).json({
        success: false,
        message: 'There is already an ongoing call in this group',
        data: { callId: ongoingCall.id }
      });
    }

    // Create call record
    const callId = await db.insert(
      'INSERT INTO calls (group_id, initiator_id, call_type, status) VALUES (?, ?, ?, ?)',
      [groupId, req.userId, callType, 'ongoing']
    );

    // Add initiator as participant
    await db.insert(
      'INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)',
      [callId, req.userId]
    );

    // Get call details
    const call = await db.getOne(
      'SELECT c.*, g.name as group_name, u.full_name as initiator_name FROM calls c JOIN `groups` g ON c.group_id = g.id JOIN users u ON c.initiator_id = u.id WHERE c.id = ?',
      [callId]
    );

    // Notify group members via Socket.IO
    if (req.io) {
      req.io.to(`group_${groupId}`).emit('incoming_call', {
        callId,
        groupId,
        callType,
        initiator: {
          id: req.userId,
          name: call.initiator_name
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Call initiated successfully',
      data: { call }
    });
  } catch (error) {
    console.error('Initiate call error:', error);
    res.status(500).json({
      success: false,
      message: 'Error initiating call'
    });
  }
});

/**
 * @route   POST /api/calls/:callId/join
 * @desc    Join an ongoing call
 * @access  Private
 */
router.post('/:callId/join', async (req, res) => {
  try {
    const { callId } = req.params;

    // Get call details
    const call = await db.getOne(
      'SELECT group_id, status, call_type FROM calls WHERE id = ?',
      [callId]
    );

    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    if (call.status !== 'ongoing') {
      return res.status(400).json({
        success: false,
        message: 'Call has ended'
      });
    }

    // Check if user is member of group
    const membership = await db.getOne(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [call.group_id, req.userId]
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    // Check if already in call
    const existingParticipant = await db.getOne(
      'SELECT id FROM call_participants WHERE call_id = ? AND user_id = ?',
      [callId, req.userId]
    );

    if (!existingParticipant) {
      // Add participant
      await db.insert(
        'INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)',
        [callId, req.userId]
      );

      // Update participant count
      await db.update(
        'UPDATE calls SET participant_count = (SELECT COUNT(*) FROM call_participants WHERE call_id = ?) WHERE id = ?',
        [callId, callId]
      );
    }

    // Get all participants
    const participants = await db.getMany(
      'SELECT u.id, u.username, u.full_name, u.avatar_url, cp.joined_at FROM call_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.call_id = ?',
      [callId]
    );

    // Notify others
    if (req.io) {
      const user = await db.getOne(
        'SELECT full_name FROM users WHERE id = ?',
        [req.userId]
      );

      req.io.to(`call_${callId}`).emit('user_joined_call', {
        callId,
        user: {
          id: req.userId,
          name: user.full_name
        },
        participants
      });
    }

    res.json({
      success: true,
      message: 'Joined call successfully',
      data: { 
        call,
        participants
      }
    });
  } catch (error) {
    console.error('Join call error:', error);
    res.status(500).json({
      success: false,
      message: 'Error joining call'
    });
  }
});

/**
 * @route   POST /api/calls/:callId/leave
 * @desc    Leave a call
 * @access  Private
 */
router.post('/:callId/leave', async (req, res) => {
  try {
    const { callId } = req.params;

    // Update participant record
    await db.update(
      'UPDATE call_participants SET left_at = NOW() WHERE call_id = ? AND user_id = ? AND left_at IS NULL',
      [callId, req.userId]
    );

    // Calculate duration
    await db.update(
      'UPDATE call_participants SET duration_seconds = TIMESTAMPDIFF(SECOND, joined_at, left_at) WHERE call_id = ? AND user_id = ?',
      [callId, req.userId]
    );

    // Update participant count
    await db.update(
      'UPDATE calls SET participant_count = (SELECT COUNT(*) FROM call_participants WHERE call_id = ? AND left_at IS NULL) WHERE id = ?',
      [callId, callId]
    );

    // Notify others
    if (req.io) {
      req.io.to(`call_${callId}`).emit('user_left_call', {
        callId,
        userId: req.userId
      });
    }

    res.json({
      success: true,
      message: 'Left call successfully'
    });
  } catch (error) {
    console.error('Leave call error:', error);
    res.status(500).json({
      success: false,
      message: 'Error leaving call'
    });
  }
});

/**
 * @route   POST /api/calls/:callId/end
 * @desc    End a call (initiator only)
 * @access  Private
 */
router.post('/:callId/end', async (req, res) => {
  try {
    const { callId } = req.params;

    // Get call details
    const call = await db.getOne(
      'SELECT group_id, initiator_id, status FROM calls WHERE id = ?',
      [callId]
    );

    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    if (call.status !== 'ongoing') {
      return res.status(400).json({
        success: false,
        message: 'Call has already ended'
      });
    }

    // Only initiator or admin can end call
    const membership = await db.getOne(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [call.group_id, req.userId]
    );

    if (call.initiator_id !== req.userId && membership?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only the call initiator or admin can end the call'
      });
    }

    // End call
    await db.update(
      'UPDATE calls SET status = "ended", ended_at = NOW() WHERE id = ?',
      [callId]
    );

    // Update all participants duration
    await db.update(
      'UPDATE call_participants SET left_at = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, joined_at, NOW()) WHERE call_id = ? AND left_at IS NULL',
      [callId]
    );

    // Calculate total duration
    await db.update(
      'UPDATE calls SET duration_seconds = TIMESTAMPDIFF(SECOND, started_at, ended_at) WHERE id = ?',
      [callId]
    );

    // Notify all participants
    if (req.io) {
      req.io.to(`call_${callId}`).emit('call_ended', { callId });
      req.io.to(`group_${call.group_id}`).emit('call_ended_in_group', { callId });
    }

    res.json({
      success: true,
      message: 'Call ended successfully'
    });
  } catch (error) {
    console.error('End call error:', error);
    res.status(500).json({
      success: false,
      message: 'Error ending call'
    });
  }
});

/**
 * @route   GET /api/calls/:callId
 * @desc    Get call details
 * @access  Private
 */
router.get('/:callId', async (req, res) => {
  try {
    const { callId } = req.params;

    const call = await db.getOne(
      'SELECT c.*, g.name as group_name FROM calls c JOIN `groups` g ON c.group_id = g.id WHERE c.id = ?',
      [callId]
    );

    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Call not found'
      });
    }

    // Get participants
    const participants = await db.getMany(
      'SELECT u.id, u.username, u.full_name, u.avatar_url, cp.joined_at, cp.left_at, cp.duration_seconds FROM call_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.call_id = ? ORDER BY cp.joined_at',
      [callId]
    );

    res.json({
      success: true,
      data: { call, participants }
    });
  } catch (error) {
    console.error('Get call error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching call details'
    });
  }
});

/**
 * @route   GET /api/calls/group/:groupId/history
 * @desc    Get call history for a group
 * @access  Private
 */
router.get('/group/:groupId/history', async (req, res) => {
  try {
    const { groupId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Check if user is member
    const membership = await db.getOne(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.userId]
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const calls = await db.getMany(
      'SELECT c.*, u.full_name as initiator_name FROM calls c JOIN users u ON c.initiator_id = u.id WHERE c.group_id = ? ORDER BY c.started_at DESC LIMIT ' + limit + ' OFFSET ' + offset,
      [groupId]
    );

    res.json({
      success: true,
      data: { 
        calls,
        pagination: {
          page,
          limit,
          hasMore: calls.length === limit
        }
      }
    });
  } catch (error) {
    console.error('Get call history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching call history'
    });
  }
});

module.exports = router;