import { io, type Socket } from 'socket.io-client';

export interface GameSocket {
  on(event: string, handler: (...args: any[]) => void): GameSocket;
  once(event: string, handler: (...args: any[]) => void): GameSocket;
  emit(event: string, payload?: unknown): GameSocket;
  close(): void;
  disconnect(): void;
  connected: boolean;
  id?: string;
}

export interface GameSocketOptions {
  serverUrl: string;
  token: string;
  spectator?: boolean;
  tableId?: number;
}

export const createGameSocket = ({ serverUrl, token, spectator, tableId }: GameSocketOptions): GameSocket => {
  return io(serverUrl, {
    auth: {
      token,
      spectator,
      tableId,
    },
    transports: ['websocket', 'polling'],
  }) as Socket as GameSocket;
};
