/**
 * Message Routes
 * Handles message retrieval and management
 */

const express = require("express");
const db = require("../config/database");
const { authMiddleware } = require("../middleware/auth.middleware");
const {
  sendMessageValidation,
} = require("../middleware/validation.middleware");
const analysisService = require("../services/analysis.service");

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/messages/group/:groupId
 * @desc    Get messages for a group
 * @access  Private (Group members only)
 */
router.get("/group/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50, before } = req.query;

    // Check if user is member
    const membership = await db.getOne(
      "SELECT id FROM group_members WHERE group_id = ? AND user_id = ?",
      [groupId, req.userId],
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    const offset = (page - 1) * limit;
    const params = [groupId];
    let whereClause = "m.group_id = ? AND m.is_deleted = FALSE";

    if (before) {
      whereClause += " AND m.created_at < ?";
      params.push(before);
    }

    params.push(parseInt(limit), parseInt(offset));

    const messages = await db.getMany(
      `SELECT m.id, m.group_id, m.sender_id, m.content, m.message_type,
              m.file_url, m.file_name, m.reply_to_id, m.is_edited, m.created_at,
              u.username, u.full_name, u.avatar_url,
              ma.clarity_score, ma.tone, ma.emotion_detected, ma.suggestions,
              ma.improved_version, ma.potential_misunderstanding
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       LEFT JOIN message_analysis ma ON m.id = ma.message_id
       WHERE ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      params,
    );

    // Update last read message
    if (messages.length > 0) {
      await db.update(
        "UPDATE group_members SET last_read_message_id = ? WHERE group_id = ? AND user_id = ?",
        [messages[0].id, groupId, req.userId],
      );
    }

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
    });
  }
});

/**
 * @route   POST /api/messages/group/:groupId
 * @desc    Send a message (HTTP fallback)
 * @access  Private (Group members only)
 */
router.post("/group/:groupId", sendMessageValidation, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content, messageType, replyToId, fileUrl, fileName } = req.body;

    // Check if user is member
    const membership = await db.getOne(
      "SELECT id, is_muted FROM group_members WHERE group_id = ? AND user_id = ?",
      [groupId, req.userId],
    );

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    if (membership.is_muted) {
      return res.status(403).json({
        success: false,
        message: "You are muted in this group",
      });
    }

    // Insert message
    const messageId = await db.insert(
      `INSERT INTO messages (group_id, sender_id, content, message_type, 
        reply_to_id, file_url, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        groupId,
        req.userId,
        content,
        messageType || "text",
        replyToId || null,
        fileUrl || null,
        fileName || null,
      ],
    );

    // Get created message
    const message = await db.getOne(
      `SELECT m.id, m.group_id, m.sender_id, m.content, m.message_type,
              m.file_url, m.file_name, m.reply_to_id, m.created_at,
              u.username, u.full_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`,
      [messageId],
    );

    // Analyze message with AI if it's a text message
    let analysis = null;
    if (messageType === "text" || !messageType) {
      analysis = await analysisService.analyzeMessage(content, messageId);

      // Update user stats
      await analysisService.updateUserCommunicationScore(req.userId);
    }

    // Emit to group members via Socket.IO
    if (req.io) {
      req.io.to(`group_${groupId}`).emit("new_message", {
        ...message,
        analysis,
      });
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: { message: { ...message, analysis } },
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending message",
    });
  }
});

/**
 * @route   PUT /api/messages/:messageId
 * @desc    Edit a message
 * @access  Private (Message sender only)
 */
router.put("/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Content cannot be empty",
      });
    }

    // Check if message exists and belongs to user
    const message = await db.getOne(
      "SELECT sender_id, group_id FROM messages WHERE id = ? AND is_deleted = FALSE",
      [messageId],
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    if (message.sender_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages",
      });
    }

    // Update message
    await db.update(
      "UPDATE messages SET content = ?, is_edited = TRUE, edited_at = NOW() WHERE id = ?",
      [content, messageId],
    );

    // Re-analyze message
    const analysis = await analysisService.analyzeMessage(content, messageId);

    // Get updated message
    const updatedMessage = await db.getOne(
      `SELECT m.id, m.group_id, m.sender_id, m.content, m.message_type,
              m.is_edited, m.edited_at, m.created_at,
              u.username, u.full_name, u.avatar_url,
              ma.clarity_score, ma.tone, ma.suggestions
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       LEFT JOIN message_analysis ma ON m.id = ma.message_id
       WHERE m.id = ?`,
      [messageId],
    );

    // Emit update to group
    if (req.io) {
      req.io
        .to(`group_${message.group_id}`)
        .emit("message_updated", updatedMessage);
    }

    res.json({
      success: true,
      message: "Message updated successfully",
      data: { message: updatedMessage },
    });
  } catch (error) {
    console.error("Edit message error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating message",
    });
  }
});

/**
 * @route   DELETE /api/messages/:messageId
 * @desc    Delete a message (soft delete)
 * @access  Private (Message sender or admin)
 */
router.delete("/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;

    // Check if message exists
    const message = await db.getOne(
      `SELECT m.sender_id, m.group_id, gm.role
       FROM messages m
       JOIN group_members gm ON m.group_id = gm.group_id AND gm.user_id = ?
       WHERE m.id = ? AND m.is_deleted = FALSE`,
      [req.userId, messageId],
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // Check if user can delete (sender or admin)
    if (message.sender_id !== req.userId && message.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    // Soft delete
    await db.update(
      "UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?",
      [messageId],
    );

    // Emit deletion to group
    if (req.io) {
      req.io
        .to(`group_${message.group_id}`)
        .emit("message_deleted", { messageId });
    }

    res.json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting message",
    });
  }
});

/**
 * @route   GET /api/messages/search
 * @desc    Search messages across groups
 * @access  Private
 */
router.get("/search", async (req, res) => {
  try {
    const { query, groupId } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters",
      });
    }

    let sql = `
      SELECT m.id, m.group_id, m.content, m.message_type, m.created_at,
             u.username, u.full_name, u.avatar_url,
             g.name as group_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN group_members gm ON m.group_id = gm.group_id
      JOIN groups g ON m.group_id = g.id
      WHERE gm.user_id = ?
      AND m.is_deleted = FALSE
      AND m.message_type = 'text'
      AND m.content LIKE ?
    `;

    const params = [req.userId, `%${query}%`];

    if (groupId) {
      sql += " AND m.group_id = ?";
      params.push(groupId);
    }

    sql += " ORDER BY m.created_at DESC LIMIT 50";

    const messages = await db.getMany(sql, params);

    res.json({
      success: true,
      data: { messages },
    });
  } catch (error) {
    console.error("Search messages error:", error);
    res.status(500).json({
      success: false,
      message: "Error searching messages",
    });
  }
});

module.exports = router;
