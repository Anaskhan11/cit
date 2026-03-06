/**
 * Socket.IO Handler
 * Handles real-time messaging, WebRTC signaling, and presence
 */

const db = require("../config/database");
const { socketAuth } = require("../middleware/auth.middleware");
const analysisService = require("../services/analysis.service");

// Store online users
const onlineUsers = new Map();

module.exports = (io) => {
  // Apply authentication middleware
  io.use(socketAuth);

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.userId}`);

    // Store user connection
    onlineUsers.set(socket.userId, {
      socketId: socket.id,
      userId: socket.userId,
      username: socket.user.username,
      lastSeen: new Date(),
    });

    // Update user's last seen
    db.update("UPDATE users SET last_seen = NOW() WHERE id = ?", [
      socket.userId,
    ]);

    // Join personal room for direct messages
    socket.join(`user_${socket.userId}`);

    // ==========================================
    // GROUP MESSAGING
    // ==========================================

    // Join group room
    socket.on("join_group", async (data) => {
      try {
        const { groupId } = data;

        // Verify membership
        const membership = await db.getOne(
          "SELECT id FROM group_members WHERE group_id = ? AND user_id = ?",
          [groupId, socket.userId],
        );

        if (!membership) {
          socket.emit("error", { message: "Not a member of this group" });
          return;
        }

        socket.join(`group_${groupId}`);
        console.log(`User ${socket.userId} joined group ${groupId}`);

        // Notify other members
        socket.to(`group_${groupId}`).emit("user_joined_group", {
          userId: socket.userId,
          username: socket.user.username,
          timestamp: new Date(),
        });

        socket.emit("joined_group", { groupId });
      } catch (error) {
        console.error("Join group error:", error);
        socket.emit("error", { message: "Error joining group" });
      }
    });

    // Leave group room
    socket.on("leave_group", (data) => {
      const { groupId } = data;
      socket.leave(`group_${groupId}`);

      socket.to(`group_${groupId}`).emit("user_left_group", {
        userId: socket.userId,
        username: socket.user.username,
        timestamp: new Date(),
      });

      socket.emit("left_group", { groupId });
    });

    // Send message
    socket.on("send_message", async (data) => {
      try {
        const {
          groupId,
          content,
          messageType = "text",
          replyToId,
          fileUrl,
          fileName,
        } = data;

        // Verify membership
        const membership = await db.getOne(
          "SELECT id, is_muted FROM group_members WHERE group_id = ? AND user_id = ?",
          [groupId, socket.userId],
        );

        if (!membership) {
          socket.emit("error", { message: "Not a member of this group" });
          return;
        }

        if (membership.is_muted) {
          socket.emit("error", { message: "You are muted in this group" });
          return;
        }

        // Save message to database
        const messageId = await db.insert(
          `INSERT INTO messages (group_id, sender_id, content, message_type, 
            reply_to_id, file_url, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            groupId,
            socket.userId,
            content,
            messageType,
            replyToId || null,
            fileUrl || null,
            fileName || null,
          ],
        );

        // Get full message with user details
        const message = await db.getOne(
          `SELECT m.id, m.group_id, m.sender_id, m.content, m.message_type,
                  m.file_url, m.file_name, m.reply_to_id, m.created_at,
                  u.username, u.full_name, u.avatar_url
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = ?`,
          [messageId],
        );

        // Analyze message if text
        let analysis = null;
        if (messageType === "text") {
          analysis = await analysisService.analyzeMessage(content, messageId);

          // Update user stats
          await analysisService.updateUserCommunicationScore(socket.userId);
        }

        const messageWithAnalysis = { ...message, analysis };

        // Broadcast to group
        io.to(`group_${groupId}`).emit("new_message", messageWithAnalysis);

        // Send confirmation to sender
        socket.emit("message_sent", {
          messageId,
          message: messageWithAnalysis,
        });
      } catch (error) {
        console.error("Send message error:", error);
        socket.emit("error", { message: "Error sending message" });
      }
    });

    // Typing indicator
    socket.on("typing", (data) => {
      const { groupId, isTyping } = data;
      socket.to(`group_${groupId}`).emit("user_typing", {
        groupId,
        userId: socket.userId,
        username: socket.user.username,
        isTyping,
      });
    });

    // Edit message
    socket.on("edit_message", async (data) => {
      try {
        const { messageId, content } = data;

        // Verify ownership
        const message = await db.getOne(
          "SELECT sender_id, group_id FROM messages WHERE id = ?",
          [messageId],
        );

        if (!message || message.sender_id !== socket.userId) {
          socket.emit("error", { message: "Cannot edit this message" });
          return;
        }

        // Update message
        await db.update(
          "UPDATE messages SET content = ?, is_edited = TRUE, edited_at = NOW() WHERE id = ?",
          [content, messageId],
        );

        // Re-analyze
        const analysis = await analysisService.analyzeMessage(
          content,
          messageId,
        );

        // Get updated message
        const updatedMessage = await db.getOne(
          `SELECT m.*, u.username, u.full_name, u.avatar_url
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = ?`,
          [messageId],
        );

        // Broadcast update
        io.to(`group_${message.group_id}`).emit("message_updated", {
          ...updatedMessage,
          analysis,
        });
      } catch (error) {
        console.error("Edit message error:", error);
        socket.emit("error", { message: "Error editing message" });
      }
    });

    // Delete message
    socket.on("delete_message", async (data) => {
      try {
        const { messageId } = data;

        const message = await db.getOne(
          "SELECT sender_id, group_id FROM messages WHERE id = ?",
          [messageId],
        );

        if (!message || message.sender_id !== socket.userId) {
          socket.emit("error", { message: "Cannot delete this message" });
          return;
        }

        await db.update(
          "UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?",
          [messageId],
        );

        io.to(`group_${message.group_id}`).emit("message_deleted", {
          messageId,
        });
      } catch (error) {
        console.error("Delete message error:", error);
        socket.emit("error", { message: "Error deleting message" });
      }
    });

    // ==========================================
    // WEBRTC SIGNALING
    // ==========================================

    // Join call room
    socket.on("join_call", async (data) => {
      try {
        const { callId } = data;

        // Verify call exists and is ongoing
        const call = await db.getOne(
          "SELECT group_id, status FROM calls WHERE id = ?",
          [callId],
        );

        if (!call || call.status !== "ongoing") {
          socket.emit("error", { message: "Call not found or ended" });
          return;
        }

        // Verify membership
        const membership = await db.getOne(
          "SELECT id FROM group_members WHERE group_id = ? AND user_id = ?",
          [call.group_id, socket.userId],
        );

        if (!membership) {
          socket.emit("error", { message: "Not a member of this group" });
          return;
        }

        socket.join(`call_${callId}`);

        // Add/update participant
        const existingParticipant = await db.getOne(
          "SELECT id FROM call_participants WHERE call_id = ? AND user_id = ?",
          [callId, socket.userId],
        );

        if (!existingParticipant) {
          await db.insert(
            "INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)",
            [callId, socket.userId],
          );
        }

        // Get all participants
        const participants = await db.getMany(
          `SELECT u.id, u.username, u.full_name, u.avatar_url
           FROM call_participants cp
           JOIN users u ON cp.user_id = u.id
           WHERE cp.call_id = ? AND cp.left_at IS NULL`,
          [callId],
        );

        // Notify others
        socket.to(`call_${callId}`).emit("user_joined_call", {
          callId,
          user: {
            id: socket.userId,
            username: socket.user.username,
            fullName: socket.user.full_name,
          },
          participants,
        });

        socket.emit("joined_call", { callId, participants });
      } catch (error) {
        console.error("Join call error:", error);
        socket.emit("error", { message: "Error joining call" });
      }
    });

    // WebRTC offer
    socket.on("webrtc_offer", (data) => {
      const { callId, targetUserId, offer } = data;
      io.to(`user_${targetUserId}`).emit("webrtc_offer", {
        callId,
        fromUserId: socket.userId,
        fromUsername: socket.user.username,
        offer,
      });
    });

    // WebRTC answer
    socket.on("webrtc_answer", (data) => {
      const { callId, targetUserId, answer } = data;
      io.to(`user_${targetUserId}`).emit("webrtc_answer", {
        callId,
        fromUserId: socket.userId,
        answer,
      });
    });

    // WebRTC ICE candidate
    socket.on("webrtc_ice_candidate", (data) => {
      const { callId, targetUserId, candidate } = data;
      io.to(`user_${targetUserId}`).emit("webrtc_ice_candidate", {
        callId,
        fromUserId: socket.userId,
        candidate,
      });
    });

    // Leave call
    socket.on("leave_call", async (data) => {
      try {
        const { callId } = data;

        socket.leave(`call_${callId}`);

        // Update participant record
        await db.update(
          "UPDATE call_participants SET left_at = NOW() WHERE call_id = ? AND user_id = ? AND left_at IS NULL",
          [callId, socket.userId],
        );

        // Update duration
        await db.update(
          `UPDATE call_participants 
           SET duration_seconds = TIMESTAMPDIFF(SECOND, joined_at, left_at)
           WHERE call_id = ? AND user_id = ?`,
          [callId, socket.userId],
        );

        // Notify others
        socket.to(`call_${callId}`).emit("user_left_call", {
          callId,
          userId: socket.userId,
          username: socket.user.username,
        });
      } catch (error) {
        console.error("Leave call error:", error);
      }
    });

    // Toggle audio/video
    socket.on("media_state_change", (data) => {
      const { callId, audioEnabled, videoEnabled } = data;
      socket.to(`call_${callId}`).emit("user_media_state_changed", {
        callId,
        userId: socket.userId,
        audioEnabled,
        videoEnabled,
      });
    });

    // ==========================================
    // PRESENCE & NOTIFICATIONS
    // ==========================================

    // Get online users in group
    socket.on("get_online_users", async (data) => {
      try {
        const { groupId } = data;

        // Get group members
        const members = await db.getMany(
          "SELECT user_id FROM group_members WHERE group_id = ?",
          [groupId],
        );

        // Filter online members
        const onlineMemberIds = members
          .filter((m) => onlineUsers.has(m.user_id))
          .map((m) => m.user_id);

        socket.emit("online_users", { groupId, onlineUsers: onlineMemberIds });
      } catch (error) {
        console.error("Get online users error:", error);
      }
    });

    // Mark notification as read
    socket.on("mark_notification_read", async (data) => {
      try {
        const { notificationId } = data;

        await db.update(
          "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?",
          [notificationId, socket.userId],
        );

        socket.emit("notification_marked_read", { notificationId });
      } catch (error) {
        console.error("Mark notification read error:", error);
      }
    });

    // ==========================================
    // DISCONNECT
    // ==========================================

    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${socket.userId}`);

      // Remove from online users
      onlineUsers.delete(socket.userId);

      // Update last seen
      await db.update("UPDATE users SET last_seen = NOW() WHERE id = ?", [
        socket.userId,
      ]);

      // Leave all call rooms and update
      const userCalls = await db.getMany(
        `SELECT call_id FROM call_participants 
         WHERE user_id = ? AND left_at IS NULL`,
        [socket.userId],
      );

      for (const call of userCalls) {
        await db.update(
          "UPDATE call_participants SET left_at = NOW() WHERE call_id = ? AND user_id = ?",
          [call.call_id, socket.userId],
        );

        socket.to(`call_${call.call_id}`).emit("user_left_call", {
          callId: call.call_id,
          userId: socket.userId,
          username: socket.user.username,
        });
      }
    });
  });

  // Helper function to send notification to user
  io.sendNotification = async (userId, notification) => {
    try {
      // Save to database
      const notificationId = await db.insert(
        "INSERT INTO notifications (user_id, type, title, content, related_id) VALUES (?, ?, ?, ?, ?)",
        [
          userId,
          notification.type,
          notification.title,
          notification.content,
          notification.relatedId,
        ],
      );

      // Send if online
      io.to(`user_${userId}`).emit("new_notification", {
        id: notificationId,
        ...notification,
        created_at: new Date(),
      });

      return notificationId;
    } catch (error) {
      console.error("Send notification error:", error);
    }
  };
};
