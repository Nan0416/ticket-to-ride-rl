// WebSocket message contract between client and server (JSON encoded).
import type { PlayerColor } from './cards.ts';
import type { Action } from './engine.ts';
import type { GameView } from './view.ts';

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; token: string }
  | { t: 'start' }
  | { t: 'leave' }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

export interface RoomPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  connected: boolean;
  isHost: boolean;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  started: boolean;
  players: RoomPlayer[];
}

export type ServerMsg =
  | { t: 'session'; token: string; code: string; playerId: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'game'; view: GameView }
  | { t: 'left' }
  | { t: 'error'; message: string; fatal?: boolean }
  | { t: 'chat'; from: string; color: PlayerColor; text: string }
  | { t: 'pong' };

export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;

export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}
