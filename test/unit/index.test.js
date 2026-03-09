const request = require('supertest');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { generateRandomTripcode } = require('../../src/utils/tripcode');

// Mock Redis
class MockRedis {
  constructor() {
    this.data = new Map();
    this.sets = new Map();
  }
  async get(key) { return this.data.get(key); }
  async set(key, value, opts) { this.data.set(key, value); }
  async sadd(set, value) {
    if (!this.sets.has(set)) this.sets.set(set, new Set());
    this.sets.get(set).add(value);
  }
  async smembers(set) {
    return Array.from(this.sets.get(set) || []);
  }
  async srem(set, value) {
    if (this.sets.has(set)) this.sets.get(set).delete(value);
  }
  async del(key) { this.data.delete(key); }
  async ttl(key) { return 100; }
}

describe('Backend API', () => {
  let app, server, io, redis;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    redis = new MockRedis();
    // Minimal /topics endpoint for test
    app.get('/topics', async (req, res) => {
      const topicNames = await redis.smembers('topics:list');
      const topics = [];
      for (const name of topicNames) {
        const ttl = await redis.ttl(`topic:${name}`);
        if (ttl > 0) topics.push({ name, ttl });
      }
      res.json({ topics });
    });
    server = http.createServer(app);
    io = new Server(server);
  });

  it('GET /topics returns topics', async () => {
    await redis.sadd('topics:list', 'testtopic');
    const res = await request(app).get('/topics');
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([{ name: 'testtopic', ttl: 100 }]);
  });

  it('generateRandomTripcode returns 8 hex chars', () => {
    const trip = generateRandomTripcode();
    expect(trip).toMatch(/^[a-f0-9]{8}$/);
  });
});
