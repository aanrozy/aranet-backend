require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Redis } = require('@upstash/redis');
const ipaddr = require('ipaddr.js');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Import utilities
const { generateRandomTripcode } = require('./src/utils/tripcode');

// Import Swagger configuration
const { swaggerUi, specs } = require('./src/config/swagger');

// Import database connection
const connectDB = require('./src/config/database');

// Import models
const User = require('./src/models/User');
const Conversation = require('./src/models/Conversation');
const Message = require('./src/models/Message');

// Import services
const redisService = require('./src/services/redisService');

// Import routes
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const conversationRoutes = require('./src/routes/conversations');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Redis for anonymous chat
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && 
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    process.env.UPSTASH_REDIS_REST_URL !== 'your_upstash_redis_url' &&
    process.env.UPSTASH_REDIS_REST_TOKEN !== 'your_upstash_redis_token') {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('Redis initialized for anonymous chat');
} else {
  console.warn('Redis not configured, anonymous chat features may be limited');
}

// Connect to MongoDB for direct messages
connectDB();

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: ["https://aranet.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000, // 25 seconds
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  connectTimeout: 45000, // 45 seconds
  upgradeTimeout: 30000, // 30 seconds
});

// Middleware
app.use(cors({
  origin: ["https://aranet.vercel.app", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

// Make io accessible in routes
app.set('io', io);

// Swagger UI for DM API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Aranet API Documentation'
}));

// ============================================
// ANONYMOUS CHAT ROUTES (EXISTING FUNCTIONALITY)
// ============================================

app.post('/topics', async (req, res) => {
  try {
    if (!redis) {
      return res.status(503).json({ error: 'Redis not configured' });
    }
    
    const { topic, recaptchaToken } = req.body;
    if (!topic || !recaptchaToken) {
      return res
        .status(400)
        .json({ error: 'Topic and reCAPTCHA token required' });
    }

    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const verifyRes = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${secret}&response=${recaptchaToken}`,
      }
    );

    const verifyJson = await verifyRes.json();

    if (!verifyJson.success) {
      return res.status(400).json({ error: 'reCAPTCHA verification failed' });
    }

    // Rate limit by IP Range
    const rawIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    let ipRange = rawIp;
    
    try {
      // Handle potential list of IPs in x-forwarded-for
      const firstIp = rawIp.split(',')[0].trim();
      if (ipaddr.isValid(firstIp)) {
        let addr = ipaddr.parse(firstIp);
        
        // If it's an IPv4-mapped IPv6 address, convert it to IPv4
        if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
          addr = addr.toIPv4Address();
        }

        if (addr.kind() === 'ipv4') {
          // For IPv4, use /24 range (e.g., 1.2.3.0/24)
          const parts = addr.toString().split('.');
          ipRange = parts.slice(0, 3).join('.') + '.0/24';
        } else if (addr.kind() === 'ipv6') {
          // For IPv6, use /64 range
          const parts = addr.toNormalizedString().split(':');
          ipRange = parts.slice(0, 4).join(':') + '::/64';
        }
      }
    } catch (e) {
      console.error('IP parsing error:', e);
    }
    
    const rateLimitKey = `rate_limit:${ipRange}`;

    const lastPost = await redis.get(rateLimitKey);
    if (lastPost) {
      const ttl = await redis.ttl(rateLimitKey);
      return res.status(429).json({
        error: `Tolong tunggu ${ttl} detik sebelum menambah topik lagi.`,
      });
    }

    await redis.sadd('topics:list', topic);
    await redis.set(`topic:${topic}`, '1', { ex: 86400 });

    await redis.set(rateLimitKey, '1', { ex: 3600 });

    res.json({ success: true, message: 'Topic created' });
  } catch (error) {
    console.error('Error in POST /topics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/topics', async (req, res) => {
  try {
    if (!redis) {
      return res.json({ topics: [] });
    }
    
    const topicNames = await redis.smembers('topics:list');
    const topics = [];
    for (const name of topicNames) {
      const ttl = await redis.ttl(`topic:${name}`);
      if (ttl > 0) {
        topics.push({ name, ttl });
      } else {
        await redis.srem('topics:list', name);
        await redis.del(`chat:${name}`);
      }
    }
    res.json({ topics });
  } catch (error) {
    console.error('Error in GET /topics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/:topic', async (req, res) => {
  const topic = req.params.topic;
  try {
    if (!redis) {
      return res.json({ messages: [] });
    }
    
    const messagesStr = await redis.get(`chat:${topic}`);
    const messages =
      typeof messagesStr === 'string'
        ? JSON.parse(messagesStr)
        : messagesStr || [];
    res.json({ messages });
  } catch (err) {
    console.error('Error fetching chat:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DIRECT MESSAGE ROUTES (NEW FUNCTIONALITY)
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);

// ============================================
// SOCKET.IO HANDLING
// ============================================

// Anonymous chat namespace
const anonymousNamespace = io.of('/anonymous');
anonymousNamespace.on('connection', (socket) => {
  console.log('Anonymous user connected:', socket.id);
  
  socket.on('joinTopic', (topic) => {
    socket.join(topic);
    console.log(`${socket.id} joined topic ${topic}`);
  });

  socket.on('newMessage', async ({ topic, username, text, userID, repliedToMessageId }) => {
    if (!redis) {
      socket.emit('errorMessage', 'Redis not configured');
      return;
    }
    
    const cleanName = username.split('#')[0].trim();
    if (!cleanName) return;

    const userTripKey = `tripcode:${userID}`;
    let tripcode = await redis.get(userTripKey);

    if (!tripcode) {
      let newTrip;
      let foundUnique = false;
      for (let i = 0; i < 5; i++) {
        newTrip = generateRandomTripcode();
        const used = await redis.get(`tripcode_owner:${newTrip}`);
        if (!used) {
          foundUnique = true;
          break;
        }
      }
      if (!foundUnique) {
        socket.emit('errorMessage', 'Gagal membuat tripcode.');
        return;
      }

      tripcode = newTrip;
      await redis.set(userTripKey, tripcode);
      await redis.set(`tripcode_owner:${tripcode}`, userID);
    }

    // Get replied message if repliedToMessageId is provided
    let repliedToMessage = null;
    if (repliedToMessageId) {
      try {
        const messagesStr = await redis.get(`chat:${topic}`);
        const existingMessages = typeof messagesStr === 'string' ? JSON.parse(messagesStr) : messagesStr || [];
        repliedToMessage = existingMessages.find(msg => msg.id === repliedToMessageId);
      } catch (_) {}
    }

    const message = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      username: cleanName,
      tripcode,
      text,
      time: new Date().toISOString(),
      userID,
      repliedToMessageId: repliedToMessageId || null,
      repliedToMessage: repliedToMessage || null,
    };

    let messages = [];
    try {
      const messagesStr = await redis.get(`chat:${topic}`);
      messages =
        typeof messagesStr === 'string'
          ? JSON.parse(messagesStr)
          : messagesStr || [];
    } catch (_) {}

    messages.push(message);
    if (messages.length > 50) messages.shift();

    await redis.set(`chat:${topic}`, JSON.stringify(messages));
    anonymousNamespace.to(topic).emit('message', message);
  });

  socket.on('disconnect', () => {
    console.log('Anonymous user disconnected:', socket.id);
  });
});

// Direct message namespace with authentication
const dmNamespace = io.of('/dm');
dmNamespace.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return next(new Error('User not found'));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

dmNamespace.on('connection', async (socket) => {
  console.log('DM user connected:', socket.user.username, socket.id);

  // Update user online status
  await User.findByIdAndUpdate(socket.userId, {
    isOnline: true,
    lastSeen: new Date()
  });

  // Store user socket mapping and set online status in Redis
  await redisService.setUserOnline(socket.userId, socket.id);
  
  // Join user to their personal room
  socket.join(`user:${socket.userId}`);

  // Join user to all their conversation rooms
  const conversations = await Conversation.find({
    participants: socket.userId
  });
  
  conversations.forEach(conv => {
    socket.join(`conversation:${conv._id}`);
  });

  // Notify other users about online status
  socket.broadcast.emit('userOnline', {
    userId: socket.userId,
    username: socket.user.username
  });

  // Handle joining specific conversation
  socket.on('joinConversation', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
    console.log(`${socket.user.username} joined conversation ${conversationId}`);
  });

  // Handle sending message
  socket.on('sendMessage', async (data) => {
    try {
      const { conversationId, text, repliedToMessageId, forwardedFromMessageId, forwardedFromConversationId } = data;

      // Rate limiting check
      const canSend = await redisService.checkRateLimit(socket.userId, 'send_message', 30, 60);
      if (!canSend) {
        socket.emit('error', { message: 'Too many messages. Please slow down.' });
        return;
      }

      // Verify user is participant of the conversation
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }

      // Create new message with reply/forward data
      const messageData = {
        conversation: conversationId,
        sender: socket.userId,
        text: text.trim()
      };

      // Add reply data if provided
      if (repliedToMessageId) {
        messageData.repliedToMessage = repliedToMessageId;
      }

      // Add forward data if provided
      if (forwardedFromMessageId) {
        messageData.forwardedFromMessage = forwardedFromMessageId;
        if (forwardedFromConversationId) {
          messageData.forwardedFromConversation = forwardedFromConversationId;
        }
      }

      const message = new Message(messageData);
      await message.save();

      // Populate sender info and related messages
      await message.populate('sender', 'username email avatar');
      
      // Populate replied message if exists
      if (repliedToMessageId) {
        await message.populate({
          path: 'repliedToMessage',
          populate: {
            path: 'sender',
            select: 'username email avatar'
          }
        });
      }

      // Populate forwarded message if exists
      if (forwardedFromMessageId) {
        await message.populate({
          path: 'forwardedFromMessage',
          populate: {
            path: 'sender',
            select: 'username email avatar'
          }
        });
        
        if (forwardedFromConversationId) {
          await message.populate('forwardedFromConversation', 'name');
        }
      }

      // Update conversation last activity and last message
      conversation.lastMessage = message._id;
      conversation.lastActivity = new Date();
      await conversation.save();

      // Cache the message in Redis
      await redisService.cacheConversationLastMessage(conversationId, {
        _id: message._id,
        sender: message.sender,
        text: message.text,
        createdAt: message.createdAt
      });

      // Invalidate conversations cache for all participants
      for (const participantId of conversation.participants) {
        await redisService.invalidateUserConversationsCache(participantId.toString());
      }

      // Emit message to all participants in the conversation
      const messageResponse = {
        _id: message._id,
        conversation: message.conversation,
        sender: message.sender,
        text: message.text,
        repliedToMessage: message.repliedToMessage,
        forwardedFromMessage: message.forwardedFromMessage,
        forwardedFromConversation: message.forwardedFromConversation,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      };

      dmNamespace.to(`conversation:${conversationId}`).emit('newMessage', messageResponse);

      // Emit conversation update to all participants for real-time chat list update
      for (const participantId of conversation.participants) {
        dmNamespace.to(`user:${participantId}`).emit('conversationUpdate', {
          conversationId: conversationId,
          lastMessage: messageResponse,
          lastActivity: conversation.lastActivity
        });
      }

      // Publish to Redis for potential scaling
      await redisService.publishNewMessage(conversationId, messageResponse);

    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicators
  socket.on('typing', async (data) => {
    const { conversationId, isTyping } = data;
    
    // Update typing status in Redis
    await redisService.setUserTyping(conversationId, socket.userId, isTyping);
    
    // Emit to other participants with conversationId included
    socket.to(`conversation:${conversationId}`).emit('userTyping', {
      conversationId,
      userId: socket.userId,
      username: socket.user.username,
      isTyping
    });
  });

  // Handle message delivery confirmation
  socket.on('messageDelivered', async (data) => {
    const { messageId } = data;
    await redisService.setMessageDelivered(messageId, socket.userId);
  });

  // Handle delete message
  socket.on('deleteMessage', async (data) => {
    try {
      const { messageId, deleteType } = data; // deleteType: 'forMe' or 'forEveryone'

      // Find the message and verify it exists
      const message = await Message.findOne({
        _id: messageId,
        isDeleted: false
      });

      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Verify user is either sender or participant in conversation
      const conversation = await Conversation.findOne({
        _id: message.conversation,
        participants: socket.userId
      });

      if (!conversation) {
        socket.emit('error', { message: 'You are not authorized to delete this message' });
        return;
      }

      if (deleteType === 'forEveryone') {
        // Only sender can delete for everyone
        if (message.sender.toString() !== socket.userId) {
          socket.emit('error', { message: 'Only sender can delete message for everyone' });
          return;
        }

        // Hard delete message
        await Message.deleteOne({ _id: messageId });

        // Emit message deletion to all participants in the conversation
        dmNamespace.to(`conversation:${message.conversation}`).emit('messageDeleted', {
          messageId: messageId,
          conversationId: message.conversation,
          deleteType: 'forEveryone',
          deletedBy: socket.userId
        });

        // If this was the last message in conversation, update conversation's lastMessage
        if (conversation.lastMessage && conversation.lastMessage.toString() === messageId) {
          // Find the previous non-deleted message
          const previousMessage = await Message.findOne({
            conversation: message.conversation,
            isDeleted: false,
            _id: { $ne: messageId }
          }).sort({ createdAt: -1 });

          if (previousMessage) {
            conversation.lastMessage = previousMessage._id;
          } else {
            conversation.lastMessage = null;
          }
          conversation.lastActivity = new Date();
          await conversation.save();

          // Emit conversation update to all participants
          for (const participantId of conversation.participants) {
            dmNamespace.to(`user:${participantId}`).emit('conversationUpdate', {
              conversationId: conversation._id,
              lastMessage: previousMessage ? {
                _id: previousMessage._id,
                text: previousMessage.text,
                sender: previousMessage.sender,
                createdAt: previousMessage.createdAt
              } : null,
              lastActivity: conversation.lastActivity
            });
          }
        }

      } else if (deleteType === 'forMe') {
        // Check if user already deleted this message for themselves
        const alreadyDeleted = message.deletedForUsers.some(
          deleted => deleted.user.toString() === socket.userId
        );

        if (alreadyDeleted) {
          socket.emit('error', { message: 'Message already deleted for you' });
          return;
        }

        // Add user to deletedForUsers array
        message.deletedForUsers.push({
          user: socket.userId,
          deletedAt: new Date()
        });
        await message.save();

        // Emit message deletion only to the user who deleted it
        socket.emit('messageDeleted', {
          messageId: messageId,
          conversationId: message.conversation,
          deleteType: 'forMe',
          deletedBy: socket.userId
        });
      }

      // Invalidate cache
      await redisService.invalidateUserConversationsCache(socket.userId);

    } catch (error) {
      console.error('Delete message error:', error);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  // Handle delete conversation
  socket.on('deleteConversation', async (data) => {
    try {
      const { conversationId, deleteType } = data; // deleteType should always be 'forMe' for conversation list

      // Find the conversation and verify user is a participant
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found or you are not authorized' });
        return;
      }

      // For conversation list, we only support 'forMe' delete type
      if (deleteType === 'forEveryone') {
        // This should only be available from active chat page, not conversation list
        // Delete conversation for everyone - hard delete
        await Conversation.deleteOne({ _id: conversationId });
        
        // Also delete all messages in this conversation
        await Message.deleteMany({ conversation: conversationId });

        // Emit conversation deletion to all participants
        for (const participantId of conversation.participants) {
          dmNamespace.to(`user:${participantId}`).emit('conversationDeleted', {
            conversationId: conversationId,
            deleteType: 'forEveryone',
            deletedBy: socket.userId
          });
        }

        // Invalidate cache for all participants
        for (const participantId of conversation.participants) {
          await redisService.invalidateUserConversationsCache(participantId.toString());
        }

      } else {
        // Default behavior: delete for me only
        // Check if user already deleted this conversation for themselves
        const alreadyDeleted = conversation.deletedForUsers.some(
          deleted => deleted.user.toString() === socket.userId
        );

        if (alreadyDeleted) {
          socket.emit('error', { message: 'Conversation already deleted for you' });
          return;
        }

        // Add user to deletedForUsers array
        conversation.deletedForUsers.push({
          user: socket.userId,
          deletedAt: new Date()
        });
        await conversation.save();

        // Check if all participants have deleted the conversation
        const allParticipantsDeleted = conversation.participants.every(participantId => 
          conversation.deletedForUsers.some(deleted => 
            deleted.user.toString() === participantId.toString()
          )
        );

        if (allParticipantsDeleted) {
          // If all participants deleted it, hard delete the conversation and messages
          await Conversation.deleteOne({ _id: conversationId });
          await Message.deleteMany({ conversation: conversationId });

          // Emit conversation deletion to all participants
          for (const participantId of conversation.participants) {
            dmNamespace.to(`user:${participantId}`).emit('conversationDeleted', {
              conversationId: conversationId,
              deleteType: 'forEveryone',
              deletedBy: 'system'
            });
          }
        } else {
          // Emit conversation deletion only to the user who deleted it
          socket.emit('conversationDeleted', {
            conversationId: conversationId,
            deleteType: 'forMe',
            deletedBy: socket.userId
          });
        }

        // Invalidate cache for user
        await redisService.invalidateUserConversationsCache(socket.userId);
      }

    } catch (error) {
      console.error('Delete conversation error:', error);
      socket.emit('error', { message: 'Failed to delete conversation' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log('DM user disconnected:', socket.user.username, socket.id);

    // Update user offline status
    await User.findByIdAndUpdate(socket.userId, {
      isOnline: false,
      lastSeen: new Date()
    });

    // Set user offline in Redis
    await redisService.setUserOffline(socket.userId);

    // Publish status change
    await redisService.publishUserStatusChange(socket.userId, 'offline');

    // Notify other users about offline status
    socket.broadcast.emit('userOffline', {
      userId: socket.userId,
      username: socket.user.username
    });
  });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    message: 'Aranet API - Anonymous Chat & Direct Messages',
    status: 'OK',
    timestamp: new Date().toISOString(),
    features: {
      anonymousChat: 'Available',
      directMessages: 'Available',
      documentation: '/api-docs'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Anonymous chat: Available`);
  console.log(`Direct messages: Available`);
  console.log(`API documentation: http://localhost:${PORT}/api-docs`);
});

