const crypto = require('crypto');

function generateRandomTripcode() {
  return crypto.randomBytes(4).toString('hex');
}

module.exports = { generateRandomTripcode };
