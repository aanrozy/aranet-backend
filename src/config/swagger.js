const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Aranet Direct Message API',
      version: '1.0.0',
      description: 'API untuk aplikasi chat real-time Aranet dengan fitur autentikasi, manajemen user, dan percakapan',
      contact: {
        name: 'Aranet Team',
        email: 'support@aranet.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      },
      {
        url: 'https://aranet.onrender.com/',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token untuk autentikasi. Format: Bearer <token>'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'ID unik user'
            },
            username: {
              type: 'string',
              description: 'Username user'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'Email user'
            },
            isOnline: {
              type: 'boolean',
              description: 'Status online user'
            },
            lastSeen: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu terakhir user terlihat online'
            },
            avatar: {
              type: 'string',
              description: 'URL avatar user'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu pembuatan akun'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu update terakhir'
            }
          }
        },
        Message: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'ID unik pesan'
            },
            conversation: {
              type: 'string',
              description: 'ID conversation'
            },
            sender: {
              $ref: '#/components/schemas/User'
            },
            text: {
              type: 'string',
              description: 'Isi pesan'
            },
            isDeleted: {
              type: 'boolean',
              description: 'Status apakah pesan sudah dihapus'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu pesan dibuat'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu pesan diupdate'
            }
          }
        },
        Conversation: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'ID unik conversation'
            },
            participant: {
              $ref: '#/components/schemas/User'
            },
            lastMessage: {
              $ref: '#/components/schemas/Message'
            },
            lastActivity: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu aktivitas terakhir'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu conversation dibuat'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Waktu conversation diupdate'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Pesan error'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Pesan sukses'
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./src/routes/*.js', './index.js'], // Path ke file yang berisi dokumentasi API
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs
};

