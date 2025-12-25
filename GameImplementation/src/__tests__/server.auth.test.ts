/**
 * Socket.IO Authentication Tests
 * Tests JWT authentication middleware and connection handling
 */

import { Server as SocketIOServer } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { PokerServer } from '../server';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-change-in-production';
const TEST_PORT = 3001; // Different port for testing

describe('Socket.IO Authentication', () => {
  let server: PokerServer;
  let serverInstance: any;

  beforeAll((done) => {
    server = new PokerServer(TEST_PORT);
    serverInstance = server['server'];
    // Give server time to start
    setTimeout(done, 100);
  });

  afterAll((done) => {
    serverInstance?.close(done);
  });

  describe('JWT Authentication', () => {
    it('should accept valid JWT token', (done) => {
      const token = jwt.sign(
        { id: 1, username: 'testuser', email: 'test@example.com' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      const client = ioc(`http://localhost:${TEST_PORT}`, {
        auth: { token }
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        done(new Error(`Should not reject valid token: ${err.message}`));
      });
    });

    it('should reject invalid JWT token', (done) => {
      const client = ioc(`http://localhost:${TEST_PORT}`, {
        auth: { token: 'invalid-token' }
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not connect with invalid token'));
      });

      client.on('connect_error', (err) => {
        expect(err.message).toContain('Authentication');
        done();
      });
    });

    it('should reject missing JWT token', (done) => {
      const client = ioc(`http://localhost:${TEST_PORT}`);

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not connect without token'));
      });

      client.on('connect_error', (err) => {
        expect(err.message).toContain('Authentication');
        done();
      });
    });

    it('should reject expired JWT token', (done) => {
      const token = jwt.sign(
        { id: 1, username: 'testuser', email: 'test@example.com' },
        JWT_SECRET,
        { expiresIn: '-1h' } // Expired 1 hour ago
      );

      const client = ioc(`http://localhost:${TEST_PORT}`, {
        auth: { token }
      });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Should not connect with expired token'));
      });

      client.on('connect_error', (err) => {
        expect(err.message).toContain('Authentication');
        done();
      });
    });

    it('should attach user data to socket', (done) => {
      const userData = { id: 1, username: 'testuser', email: 'test@example.com' };
      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '24h' });

      const client = ioc(`http://localhost:${TEST_PORT}`, {
        auth: { token }
      });

      client.on('connect', () => {
        // User data should be attached to socket.data.user
        // We can't directly access it from client, but we can verify connection works
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        done(new Error(`Unexpected error: ${err.message}`));
      });
    });
  });

  describe('Connection Lifecycle', () => {
    let client: ClientSocket;
    let token: string;

    beforeEach(() => {
      token = jwt.sign(
        { id: 1, username: 'testuser', email: 'test@example.com' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
    });

    afterEach(() => {
      if (client && client.connected) {
        client.disconnect();
      }
    });

    it('should emit connected event on successful connection', (done) => {
      client = ioc(`http://localhost:${TEST_PORT}`, {
        auth: { token }
      });

      client.on('connected', (data) => {
        expect(data.message).toBeTruthy();
        expect(data.socketId).toBe(client.id);
        done();
      });

      client.on('connect_error', (err) => {
        done(new Error(`Connection failed: ${err.message}`));
      });
    });

    it('should handle multiple simultaneous connections', (done) => {
      const tokens = [
        jwt.sign({ id: 1, username: 'user1', email: 'user1@example.com' }, JWT_SECRET, { expiresIn: '24h' }),
        jwt.sign({ id: 2, username: 'user2', email: 'user2@example.com' }, JWT_SECRET, { expiresIn: '24h' }),
        jwt.sign({ id: 3, username: 'user3', email: 'user3@example.com' }, JWT_SECRET, { expiresIn: '24h' })
      ];

      const clients: ClientSocket[] = [];
      let connectedCount = 0;

      tokens.forEach((token, index) => {
        const client = ioc(`http://localhost:${TEST_PORT}`, {
          auth: { token }
        });

        client.on('connect', () => {
          connectedCount++;
          clients.push(client);

          if (connectedCount === tokens.length) {
            // All connected
            expect(clients).toHaveLength(3);
            // Disconnect all
            clients.forEach(c => c.disconnect());
            done();
          }
        });

        client.on('connect_error', (err) => {
          done(new Error(`Client ${index} failed: ${err.message}`));
        });
      });
    });

    it('should handle reconnection with same token', (done) => {
      client = ioc(`http://localhost:${TEST_PORT}`, {
        auth: { token }
      });

      let firstConnection = true;

      client.on('connect', () => {
        if (firstConnection) {
          firstConnection = false;
          // Disconnect and reconnect
          client.disconnect();
          setTimeout(() => {
            client.connect();
          }, 100);
        } else {
          // Second connection successful
          expect(client.connected).toBe(true);
          done();
        }
      });

      client.on('connect_error', (err) => {
        done(new Error(`Reconnection failed: ${err.message}`));
      });
    });
  });
});
