import jwt from 'jsonwebtoken';
import axios, { type AxiosResponse } from 'axios';
import net from 'net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { PokerServer } from '../../server';
import { GameStateStorage, closeRedis, ensureRedisConnection } from '../../redis';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-change-in-production';

export interface HarnessUser {
  id: number;
  username: string;
  email?: string;
  isTestUser?: boolean;
  testRunTag?: string | null;
}

export interface SeatPlayerRequestPayload {
  tableId: number;
  userId: number;
  username: string;
  stack: number;
  seatNumber: number;
  communityId?: number;
  tableName?: string;
  isTestOnly?: boolean;
  testRunTag?: string | null;
  promotionId?: string | null;
}

export const createAuthToken = (user: HarnessUser): string => jwt.sign(
  {
    user_id: user.id,
    id: user.id,
    username: user.username,
    email: user.email ?? `${user.username}@example.com`,
    is_test_user: Boolean(user.isTestUser),
    test_run_tag: user.testRunTag ?? null,
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

  async seatPlayerRaw(payload: SeatPlayerRequestPayload): Promise<AxiosResponse<any>> {
    return axios.post(`${this.baseHttpUrl}/_internal/seat-player`, {
      table_id: payload.tableId,
      user_id: payload.userId,
      username: payload.username,
      stack: payload.stack,
      seat_number: payload.seatNumber,
      community_id: payload.communityId,
      table_name: payload.tableName,
      is_test_only: payload.isTestOnly,
      test_run_tag: payload.testRunTag,
      promotion_id: payload.promotionId,
    }, {
      validateStatus: () => true,
    });
  }

  async seatPlayer(payload: SeatPlayerRequestPayload): Promise<void> {
    const response = await this.seatPlayerRaw(payload);
    expect(response.status).toBe(200);
  }

  async getPromotionStatus(promotionId: string): Promise<AxiosResponse<any>> {
    return axios.get(`${this.baseHttpUrl}/_internal/promotions/${promotionId}`, {
      validateStatus: () => true,
    });
  }

  async rollbackPromotion(promotionId: string): Promise<void> {
    const response = await this.rollbackPromotionRaw(promotionId);
    expect(response.status).toBe(200);
  }

  async rollbackPromotionRaw(promotionId: string): Promise<AxiosResponse<any>> {
    return axios.post(`${this.baseHttpUrl}/_internal/promotions/${promotionId}/rollback`, {}, {
      validateStatus: () => true,
    });
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
