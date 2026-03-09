const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Endpoint untuk manajemen user dan pencarian user
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Mendapatkan daftar user untuk pencarian
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Kata kunci untuk mencari user berdasarkan username atau email
 *         example: "john"
 *     responses:
 *       200:
 *         description: Daftar user berhasil didapatkan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
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
// Get all users (untuk mencari user untuk chat)
router.get('/', auth, async (req, res) => {
  try {
    const { search } = req.query;
    let query = { _id: { $ne: req.user._id } }; // Exclude current user

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('username email isOnline lastSeen avatar')
      .limit(20);

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Mendapatkan informasi user berdasarkan ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID user yang ingin didapatkan informasinya
 *         example: "60d5ecb74b24a1234567890a"
 *     responses:
 *       200:
 *         description: Informasi user berhasil didapatkan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
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
// Get user by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('username email isOnline lastSeen avatar');

    if (!user) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update profil user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username baru (opsional)
 *                 example: "new_username"
 *               avatar:
 *                 type: string
 *                 description: URL avatar baru (opsional)
 *                 example: "https://example.com/avatar.jpg"
 *     responses:
 *       200:
 *         description: Profil berhasil diupdate
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Profile berhasil diupdate"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Username sudah digunakan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { username, avatar } = req.body;
    const updates = {};

    if (username) {
      // Cek apakah username sudah digunakan
      const existingUser = await User.findOne({ 
        username, 
        _id: { $ne: req.user._id } 
      });
      
      if (existingUser) {
        return res.status(400).json({ error: 'Username sudah digunakan' });
      }
      
      updates.username = username;
    }

    if (avatar !== undefined) {
      updates.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true }
    ).select('-password');

    res.json({ 
      message: 'Profile berhasil diupdate',
      user 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

module.exports = router;

