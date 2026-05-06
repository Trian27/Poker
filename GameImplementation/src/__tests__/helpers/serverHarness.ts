import jwt from 'jsonwebtoken';
import axios from 'axios';
import net from 'net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { PokerServer } from '../../server';
import { GameStateStorage, closeRedis, ensureRedisConnection } from '../../redis';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-change-in-production';

export interface HarnessUser {
  id: number;
  username: string;
  email?: string;
}

export const createAuthToken = (user: HarnessUser): string => jwt.sign(
  {
    id: user.id,
    username: user.username,
    email: user.email ?? `${user.username}@example.com`,
  },
  JWT_SECRET,
  { expiresIn: '24h' }
);

const getFreePort = async (): Promise<number> => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

export class ServerHarness {
  public readonly port: number;
  private server: PokerServer;
  private readonly clients: ClientSocket[] = [];

  private constructor(port: number, server: PokerServer) {
    this.port = port;
    this.server = server;
  }

  static async create(): Promise<ServerHarness> {
    await ensureRedisConnection();
    const port = await getFreePort();
    const server = new PokerServer(port);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return new ServerHarness(port, server);
  }

  get baseHttpUrl(): string {
    return `http://localhost:${this.port}`;
  }

  connectUser(user: HarnessUser, options?: { tableId?: number; spectator?: boolean }): Promise<ClientSocket> {
    const token = createAuthToken(user);
    const client = ioc(this.baseHttpUrl, {
      auth: {
        token,
        tableId: options?.tableId,
        spectator: options?.spectator,
      },
      reconnection: false,
      transports: ['websocket'],
    });
    this.clients.push(client);

    return new Promise((resolve, reject) => {
      client.once('connect', () => resolve(client));
      client.once('connect_error', (error) => reject(error));
    });
  }

  async seatPlayer(payload: {
    tableId: number;
    userId: number;
    username: string;
    stack: number;
    seatNumber: number;
    communityId?: number;
    tableName?: string;
  }): Promise<void> {
    const response = await axios.post(`${this.baseHttpUrl}/_internal/seat-player`, {
      table_id: payload.tableId,
      user_id: payload.userId,
      username: payload.username,
      stack: payload.stack,
      seat_number: payload.seatNumber,
      community_id: payload.communityId,
      table_name: payload.tableName,
    });
    expect(response.status).toBe(200);
  }

  async getGameState(gameId: string, userId: number): Promise<any> {
    const response = await axios.get(`${this.baseHttpUrl}/_internal/game/${gameId}/state`, {
      params: { userId },
    });
    expect(response.status).toBe(200);
    return response.data.gameState;
  }

  async waitForSocketEvent<T = any>(client: ClientSocket, eventName: string, timeoutMs: number = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), timeoutMs);
      client.once(eventName, (payload: T) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
  }

  async restart(): Promise<void> {
    this.clients.forEach((client) => {
      if (client.connected) {
        client.disconnect();
      }
      client.removeAllListeners();
    });
    this.clients.length = 0;

    await this.server.close();
    this.server = new PokerServer(this.port);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async close(): Promise<void> {
    this.clients.forEach((client) => {
      if (client.connected) {
        client.disconnect();
      }
      client.removeAllListeners();
    });
    await this.server.close();
    await closeRedis();
  }

  async clearGame(gameId: string): Promise<void> {
    await GameStateStorage.deleteGameState(gameId);
  }
}
