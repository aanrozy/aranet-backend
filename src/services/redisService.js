const { Redis } = require('@upstash/redis');

class RedisService {
  constructor() {
    // Only initialize Redis if credentials are provided
    if (process.env.UPSTASH_REDIS_REST_URL && 
        process.env.UPSTASH_REDIS_REST_TOKEN &&
        process.env.UPSTASH_REDIS_REST_URL !== 'your_upstash_redis_url' &&
        process.env.UPSTASH_REDIS_REST_TOKEN !== 'your_upstash_redis_token') {
      this.redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      this.enabled = true;
    } else {
      console.warn('Redis credentials not provided, Redis features disabled');
      this.redis = null;
      this.enabled = false;
    }
  }

  // User online status management
  async setUserOnline(userId, socketId) {
    if (!this.enabled) return;
    await this.redis.set(`user:${userId}:socket`, socketId);
    await this.redis.sadd('online_users', userId);
    await this.redis.set(`user:${userId}:lastSeen`, Date.now());
  }

  async setUserOffline(userId) {
    if (!this.enabled) return;
    await this.redis.del(`user:${userId}:socket`);
    await this.redis.srem('online_users', userId);
    await this.redis.set(`user:${userId}:lastSeen`, Date.now());
  }

  async getUserSocket(userId) {
    if (!this.enabled) return null;
    return await this.redis.get(`user:${userId}:socket`);
  }

  async getOnlineUsers() {
    if (!this.enabled) return [];
    return await this.redis.smembers('online_users');
  }

  async isUserOnline(userId) {
    if (!this.enabled) return false;
    return await this.redis.sismember('online_users', userId);
  }

  // Conversation caching
  async cacheConversationLastMessage(conversationId, message) {
    if (!this.enabled) return;
    const cacheKey = `conversation:${conversationId}:lastMessage`;
    await this.redis.set(cacheKey, JSON.stringify(message), { ex: 3600 });
  }

  async getCachedConversationLastMessage(conversationId) {
    if (!this.enabled) return null;
    const cacheKey = `conversation:${conversationId}:lastMessage`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  // Recent conversations cache
  async cacheUserConversations(userId, conversations) {
    if (!this.enabled) return;
    const cacheKey = `user:${userId}:conversations`;
    await this.redis.set(cacheKey, JSON.stringify(conversations), { ex: 1800 }); // 30 minutes
  }

  async getCachedUserConversations(userId) {
    if (!this.enabled) return null;
    const cacheKey = `user:${userId}:conversations`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  async invalidateUserConversationsCache(userId) {
    if (!this.enabled) return;
    const cacheKey = `user:${userId}:conversations`;
    await this.redis.del(cacheKey);
  }

  // Typing indicators
  async setUserTyping(conversationId, userId, isTyping) {
    if (!this.enabled) return;
    const key = `conversation:${conversationId}:typing`;
    if (isTyping) {
      await this.redis.sadd(key, userId);
      await this.redis.expire(key, 10); // Auto-expire in 10 seconds
    } else {
      await this.redis.srem(key, userId);
    }
  }

  async getTypingUsers(conversationId) {
    if (!this.enabled) return [];
    const key = `conversation:${conversationId}:typing`;
    return await this.redis.smembers(key);
  }

  // Message delivery status
  async setMessageDelivered(messageId, userId) {
    if (!this.enabled) return;
    const key = `message:${messageId}:delivered`;
    await this.redis.sadd(key, userId);
    await this.redis.expire(key, 86400); // 24 hours
  }

  async getMessageDeliveredUsers(messageId) {
    if (!this.enabled) return [];
    const key = `message:${messageId}:delivered`;
    return await this.redis.smembers(key);
  }

  // Rate limiting
  async checkRateLimit(userId, action, limit = 10, window = 60) {
    if (!this.enabled) return true; // Allow if Redis is disabled
    const key = `rate_limit:${userId}:${action}`;
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, window);
    }
    
    return current <= limit;
  }

  // Session management (optional, jika tidak menggunakan JWT stateless)
  async setUserSession(userId, sessionData) {
    if (!this.enabled) return;
    const key = `session:${userId}`;
    await this.redis.set(key, JSON.stringify(sessionData), { ex: 86400 * 7 }); // 7 days
  }

  async getUserSession(userId) {
    if (!this.enabled) return null;
    const key = `session:${userId}`;
    const session = await this.redis.get(key);
    return session ? JSON.parse(session) : null;
  }

  async deleteUserSession(userId) {
    if (!this.enabled) return;
    const key = `session:${userId}`;
    await this.redis.del(key);
  }

  // Pub/Sub for real-time notifications
  async publishUserStatusChange(userId, status) {
    if (!this.enabled) return;
    await this.redis.publish('user_status_changes', JSON.stringify({
      userId,
      status,
      timestamp: Date.now()
    }));
  }

  async publishNewMessage(conversationId, message) {
    if (!this.enabled) return;
    await this.redis.publish('new_messages', JSON.stringify({
      conversationId,
      message,
      timestamp: Date.now()
    }));
  }

  // Cleanup expired data
  async cleanupExpiredData() {
    if (!this.enabled) return;
    // This would be called periodically to clean up expired typing indicators, etc.
    const typingKeys = await this.redis.keys('conversation:*:typing');
    for (const key of typingKeys) {
      const ttl = await this.redis.ttl(key);
      if (ttl === -1) { // No expiration set
        await this.redis.expire(key, 10);
      }
    }
  }
}

module.exports = new RedisService();

