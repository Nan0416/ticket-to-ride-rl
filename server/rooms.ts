// In-memory lobby + game rooms. Each room holds the authoritative GameState and
// pushes a per-player GameView to every connected socket after each change.
import { randomBytes, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { PLAYER_COLORS, RULES } from '../shared/cards.ts';
import { applyAction, createGame, GameError, type GameState } from '../shared/engine.ts';
import { cleanName, type ClientMsg, type RoomInfo, type ServerMsg } from '../shared/protocol.ts';
import { viewFor } from '../shared/view.ts';

interface Seat {
  id: string;
  name: string;
  token: string;
  sockets: Set<WebSocket>;
}

interface Room {
  code: string;
  hostId: string;
  seats: Seat[];
  game: GameState | null;
  lastActive: number;
}

interface Conn {
  token?: string;
}

const rooms = new Map<string, Room>();
const sessions = new Map<string, { code: string; seatId: string }>();
const conns = new WeakMap<WebSocket, Conn>();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const IDLE_ROOM_MS = 6 * 60 * 60 * 1000;

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function newCode(): string {
  for (;;) {
    const bytes = randomBytes(4);
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!rooms.has(code)) return code;
  }
}

function roomInfo(room: Room): RoomInfo {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.game !== null,
    players: room.seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      color: room.game?.players.find((p) => p.id === s.id)?.color ?? PLAYER_COLORS[i],
      connected: s.sockets.size > 0,
      isHost: s.id === room.hostId,
    })),
  };
}

function broadcastRoom(room: Room) {
  const msg: ServerMsg = { t: 'room', room: roomInfo(room) };
  for (const seat of room.seats) for (const ws of seat.sockets) send(ws, msg);
}

function broadcastGame(room: Room) {
  if (!room.game) return;
  const connected = (id: string) => (room.seats.find((s) => s.id === id)?.sockets.size ?? 0) > 0;
  for (const seat of room.seats) {
    if (seat.sockets.size === 0) continue;
    const msg: ServerMsg = { t: 'game', view: viewFor(room.game, seat.id, connected) };
    for (const ws of seat.sockets) send(ws, msg);
  }
}

function uniqueName(room: Room, name: string): string {
  let candidate = name;
  for (let n = 2; room.seats.some((s) => s.name.toLowerCase() === candidate.toLowerCase()); n++) {
    candidate = `${name.slice(0, 13)} ${n}`;
  }
  return candidate;
}

function seatFor(ws: WebSocket): { room: Room; seat: Seat } | null {
  const token = conns.get(ws)?.token;
  if (!token) return null;
  const sess = sessions.get(token);
  const room = sess && rooms.get(sess.code);
  const seat = room?.seats.find((s) => s.id === sess!.seatId);
  return room && seat ? { room, seat } : null;
}

function attach(ws: WebSocket, room: Room, seat: Seat) {
  detach(ws);
  conns.set(ws, { token: seat.token });
  seat.sockets.add(ws);
  room.lastActive = Date.now();
  send(ws, { t: 'session', token: seat.token, code: room.code, playerId: seat.id });
  broadcastRoom(room);
  broadcastGame(room);
}

/** Remove the socket from whatever seat it occupies (the seat itself stays). */
export function detach(ws: WebSocket) {
  const found = seatFor(ws);
  conns.set(ws, {});
  if (!found) return;
  found.seat.sockets.delete(ws);
  broadcastRoom(found.room);
  broadcastGame(found.room);
}

function addSeat(room: Room, name: string): Seat {
  const seat: Seat = { id: 'p' + randomBytes(4).toString('hex'), name: uniqueName(room, name), token: randomUUID(), sockets: new Set() };
  room.seats.push(seat);
  sessions.set(seat.token, { code: room.code, seatId: seat.id });
  return seat;
}

function removeSeat(room: Room, seat: Seat) {
  room.seats = room.seats.filter((s) => s !== seat);
  sessions.delete(seat.token);
  if (room.seats.length === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === seat.id) room.hostId = room.seats[0].id;
  broadcastRoom(room);
}

export function handleMessage(ws: WebSocket, raw: string) {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(ws, { t: 'error', message: 'Bad message' });
  }
  const fail = (message: string, fatal = false) => send(ws, { t: 'error', message, fatal });

  switch (msg.t) {
    case 'ping':
      return send(ws, { t: 'pong' });

    case 'create': {
      const name = cleanName(msg.name);
      if (!name) return fail('Please enter a name');
      leaveCurrent(ws);
      const room: Room = { code: newCode(), hostId: '', seats: [], game: null, lastActive: Date.now() };
      rooms.set(room.code, room);
      const seat = addSeat(room, name);
      room.hostId = seat.id;
      return attach(ws, room, seat);
    }

    case 'join': {
      const name = cleanName(msg.name);
      if (!name) return fail('Please enter a name');
      const room = rooms.get(String(msg.code ?? '').trim().toUpperCase());
      if (!room) return fail('No game with that code');
      if (room.game) return fail('That game has already started');
      if (room.seats.length >= RULES.maxPlayers) return fail(`That game is full (${RULES.maxPlayers} players max)`);
      leaveCurrent(ws);
      return attach(ws, room, addSeat(room, name));
    }

    case 'resume': {
      const sess = sessions.get(String(msg.token));
      const room = sess && rooms.get(sess.code);
      const seat = room?.seats.find((s) => s.id === sess!.seatId);
      if (!room || !seat) return fail('That game is no longer available', true);
      return attach(ws, room, seat);
    }

    case 'leave': {
      leaveCurrent(ws);
      return send(ws, { t: 'left' });
    }

    case 'start': {
      const found = seatFor(ws);
      if (!found) return fail('You are not in a game');
      const { room, seat } = found;
      if (room.hostId !== seat.id) return fail('Only the host can start the game');
      if (room.game && room.game.phase !== 'over') return fail('Already started');
      if (room.seats.length < RULES.minPlayers) return fail(`Need at least ${RULES.minPlayers} players`);
      room.game = createGame(
        room.seats.map((s) => ({ id: s.id, name: s.name })),
        randomBytes(4).readUInt32LE(0),
      );
      broadcastRoom(room);
      return broadcastGame(room);
    }

    case 'action': {
      const found = seatFor(ws);
      if (!found?.room.game) return fail('No game in progress');
      const { room, seat } = found;
      try {
        room.game = applyAction(room.game!, seat.id, msg.action);
      } catch (e) {
        if (e instanceof GameError) return fail(e.message);
        console.error('engine error', e);
        return fail('Something went wrong with that move');
      }
      room.lastActive = Date.now();
      return broadcastGame(room);
    }

    case 'chat': {
      const found = seatFor(ws);
      if (!found) return;
      const text = String(msg.text ?? '').slice(0, 200).trim();
      if (!text) return;
      const { room, seat } = found;
      const color = roomInfo(room).players.find((p) => p.id === seat.id)!.color;
      for (const s of room.seats) for (const sock of s.sockets) send(sock, { t: 'chat', from: seat.name, color, text });
      return;
    }

    default:
      return fail('Unknown message');
  }
}

/** Explicit leave: lobby seats are freed; seats in a running game are kept for reconnects. */
function leaveCurrent(ws: WebSocket) {
  const found = seatFor(ws);
  detach(ws);
  if (found && !found.room.game) removeSeat(found.room, found.seat);
}

export function sweepIdleRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = room.seats.some((s) => s.sockets.size > 0);
    if (!anyone && now - room.lastActive > IDLE_ROOM_MS) {
      for (const s of room.seats) sessions.delete(s.token);
      rooms.delete(room.code);
    }
  }
}

export function stats() {
  return { rooms: rooms.size, sessions: sessions.size };
}
