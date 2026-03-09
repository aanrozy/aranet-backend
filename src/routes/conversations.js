const express = require('express');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Conversations
 *   description: Endpoint untuk manajemen percakapan dan pesan
 */

/**
 * @swagger
 * /api/conversations:
 *   get:
 *     summary: Mendapatkan semua percakapan user yang sedang login
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Daftar percakapan berhasil didapatkan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Conversation'
 *       401:
 *         description: Token tidak valid atau tidak ada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Kesalahan server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get all conversations for current user
router.get('/', auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
      lastMessage: { $exists: true },
      // Filter out conversations deleted by current user
      'deletedForUsers.user': { $ne: req.user._id }
    })
    .populate('participants', 'username email isOnline lastSeen avatar')
    .populate('lastMessage')
    .sort({ lastActivity: -1 });

    // Format conversations untuk frontend
    const formattedConversations = conversations.map(conv => {
      const otherParticipant = conv.participants.find(
        p => p._id.toString() !== req.user._id.toString()
      );

      return {
        _id: conv._id,
        participant: otherParticipant,
        lastMessage: conv.lastMessage,
        lastActivity: conv.lastActivity,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt
      };
    });

    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

/**
 * @swagger
 * /api/conversations/with/{userId}:
 *   post:
 *     summary: Mendapatkan atau membuat percakapan dengan user lain
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID user yang ingin diajak percakapan
 *         example: "60d5ecb74b24a1234567890a"
 *     responses:
 *       200:
 *         description: Percakapan berhasil didapatkan atau dibuat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversation:
 *                   $ref: '#/components/schemas/Conversation'
 *       401:
 *         description: Token tidak valid atau tidak ada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User tidak ditemukan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Kesalahan server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get or create conversation with another user
router.post('/with/:userId', auth, async (req, res) => {
  try {
    const otherUserId = req.params.userId;

    // Cek apakah user lain ada
    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }

    // Cari conversation yang sudah ada
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, otherUserId] }
    })
    .populate('participants', 'username email isOnline lastSeen avatar')
    .populate('lastMessage');

    // Jika belum ada, buat conversation baru
    if (!conversation) {
      conversation = new Conversation({
        participants: [req.user._id, otherUserId]
      });
      await conversation.save();
      
      // Populate data setelah save
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username email isOnline lastSeen avatar')
        .populate('lastMessage');

      // Emit conversationCreated event to both participants for real-time update
      const io = req.app.get('io');
      if (io) {
        const dmNamespace = io.of('/dm');
        dmNamespace.to(`user:${req.user._id}`).emit('conversationCreated', {
          conversationId: conversation._id,
          participant: otherUser
        });
        dmNamespace.to(`user:${otherUserId}`).emit('conversationCreated', {
          conversationId: conversation._id,
          participant: req.user
        });
      }
    }

    // Format untuk frontend
    const otherParticipant = conversation.participants.find(
      p => p._id.toString() !== req.user._id.toString()
    );

    const formattedConversation = {
      _id: conversation._id,
      participant: otherParticipant,
      lastMessage: conversation.lastMessage,
      lastActivity: conversation.lastActivity,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    };

    res.json({ conversation: formattedConversation });
  } catch (error) {
    console.error('Get/create conversation error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

/**
 * @swagger
 * /api/conversations/{conversationId}/messages:
 *   get:
 *     summary: Mendapatkan pesan dalam percakapan
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID percakapan
 *         example: "60d5ecb74b24a1234567890b"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Nomor halaman untuk pagination
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Jumlah pesan per halaman
 *         example: 50
 *     responses:
 *       200:
 *         description: Pesan berhasil didapatkan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *       401:
 *         description: Token tidak valid atau tidak ada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Percakapan tidak ditemukan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Kesalahan server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get messages in a conversation
router.get('/:conversationId/messages', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Cek apakah user adalah participant dari conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation tidak ditemukan' });
    }

    const messages = await Message.find({
      conversation: conversationId,
      // Filter out messages deleted by current user
      'deletedForUsers.user': { $ne: req.user._id },
      // Also filter out globally deleted messages
      isDeleted: false
    })
    .populate("sender", "username email avatar")
    .populate({
      path: "repliedToMessage",
      populate: {
        path: "sender",
        select: "username email avatar"
      }
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    // Reverse untuk menampilkan pesan terlama di atas
    messages.reverse();

    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

/**
 * @swagger
 * /api/conversations/{conversationId}/forward:
 *   post:
 *     summary: Forward pesan ke percakapan lain
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID percakapan asal
 *         example: "60d5ecb74b24a1234567890b"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageId:
 *                 type: string
 *                 description: ID pesan yang akan di-forward
 *                 example: "60d5ecb74b24a1234567890c"
 *               targetUserIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array ID user yang akan menerima forward
 *                 example: ["60d5ecb74b24a1234567890d", "60d5ecb74b24a1234567890e"]
 *               additionalText:
 *                 type: string
 *                 description: Teks tambahan yang akan dikirim bersama forward (opsional)
 *                 example: "Lihat pesan ini"
 *     responses:
 *       200:
 *         description: Pesan berhasil di-forward
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Message forwarded successfully"
 *                 forwardedTo:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       username:
 *                         type: string
 *                       conversationId:
 *                         type: string
 *       401:
 *         description: Token tidak valid atau tidak ada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Percakapan atau pesan tidak ditemukan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Kesalahan server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Forward message to other users
router.post('/:conversationId/forward', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { messageId, targetUserIds, additionalText } = req.body;

    // Verify user is participant of the source conversation
    const sourceConversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id
    });

    if (!sourceConversation) {
      return res.status(404).json({ error: 'Source conversation not found' });
    }

    // Get the message to forward
    const messageToForward = await Message.findOne({
      _id: messageId,
      conversation: conversationId
    }).populate('sender', 'username email avatar');

    if (!messageToForward) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Validate target users exist
    const targetUsers = await User.find({
      _id: { $in: targetUserIds }
    }).select('username email avatar');

    if (targetUsers.length !== targetUserIds.length) {
      return res.status(404).json({ error: 'Some target users not found' });
    }

    const forwardedTo = [];

    // Forward to each target user
    for (const targetUser of targetUsers) {
      // Get or create conversation with target user
      let targetConversation = await Conversation.findOne({
        participants: { $all: [req.user._id, targetUser._id] }
      });

      if (!targetConversation) {
        targetConversation = new Conversation({
          participants: [req.user._id, targetUser._id]
        });
        await targetConversation.save();
      }

      // Create forwarded message
      const forwardedMessage = new Message({
        conversation: targetConversation._id,
        sender: req.user._id,
        text: additionalText || messageToForward.text,
        forwardedFromMessage: messageToForward._id,
        forwardedFromConversation: conversationId
      });

      await forwardedMessage.save();

      // Populate sender info
      await forwardedMessage.populate('sender', 'username email avatar');
      await forwardedMessage.populate({
        path: 'forwardedFromMessage',
        populate: {
          path: 'sender',
          select: 'username email avatar'
        }
      });
      await forwardedMessage.populate('forwardedFromConversation', 'name');

      // Update target conversation
      targetConversation.lastMessage = forwardedMessage._id;
      targetConversation.lastActivity = new Date();
      await targetConversation.save();

      forwardedTo.push({
        userId: targetUser._id,
        username: targetUser.username,
        conversationId: targetConversation._id
      });

      // Emit to target conversation via socket if they're online
      // This will be handled by the socket.io logic in index.js
    }

    res.json({
      message: 'Message forwarded successfully',
      forwardedTo
    });

  } catch (error) {
    console.error('Forward message error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;



/**
 * @swagger
 * /api/conversations/{conversationId}:
 *   delete:
 *     summary: Menghapus percakapan berdasarkan ID
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID percakapan yang akan dihapus
 *         example: "60d5ecb74b24a1234567890b"
 *     responses:
 *       200:
 *         description: Percakapan berhasil dihapus
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Conversation deleted successfully"
 *       401:
 *         description: Token tidak valid atau tidak ada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Tidak diizinkan menghapus percakapan ini
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Percakapan tidak ditemukan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Kesalahan server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete("/:conversationId", auth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id,
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await Conversation.deleteOne({ _id: conversationId });
    await Message.deleteMany({ conversation: conversationId });

    // Emit conversation deleted event to all participants
    const io = req.app.get("io");
    if (io) {
      const dmNamespace = io.of("/dm");
      for (const participantId of conversation.participants) {
        dmNamespace.to(`user:${participantId}`).emit("conversationDeleted", { conversationId });
      }
    }

    res.json({ message: "Conversation deleted successfully" });
  } catch (error) {
    console.error("Delete conversation error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


