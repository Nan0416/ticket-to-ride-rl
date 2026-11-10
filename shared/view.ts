// What a single client is allowed to see of the game.
import type { Card, Hand, PlayerColor } from './cards.ts';
import { handSize } from './cards.ts';
import { CONTRACT_BY_ID } from './map/index.ts';
import { ownedRoutes, type FinalResult, type GameState, type LogEntry, type Phase } from './engine.ts';
import { connectivity, longestLine } from './scoring.ts';

export interface PublicPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  cars: number;
  handCount: number;
  contractCount: number;
  routePoints: number;
  longest: number;
  choosing: boolean;
  connected: boolean;
}

export interface MyContract {
  id: string;
  done: boolean;
}

export interface GameView {
  gameId: string;
  phase: Phase;
  current: number;
  drawn: number;
  finalTurnsLeft: number | null;
  turn: number;
  players: PublicPlayer[];
  market: (Card | null)[];
  deckCount: number;
  discardCount: number;
  contractDeckCount: number;
  claims: Record<string, number>;
  log: LogEntry[];
  results: (FinalResult & { contracts: MyContract[] })[] | null;
  me: {
    index: number;
    hand: Hand;
    contracts: MyContract[];
    pending: string[] | null;
    minKeep: number;
  } | null;
}

export function viewFor(s: GameState, playerId: string | null, connected: (id: string) => boolean = () => true): GameView {
  const meIndex = s.players.findIndex((p) => p.id === playerId);
  const owned = s.players.map((_, i) => ownedRoutes(s, i));
  const me = meIndex >= 0 ? s.players[meIndex] : null;
  let myContracts: MyContract[] = [];
  if (me) {
    const conn = connectivity(owned[meIndex]);
    myContracts = me.contracts.map((id) => {
      const c = CONTRACT_BY_ID.get(id)!;
      return { id, done: conn(c.a, c.b) };
    });
  }
  return {
    gameId: s.id,
    phase: s.phase,
    current: s.current,
    drawn: s.drawn,
    finalTurnsLeft: s.finalTurnsLeft,
    turn: s.turn,
    players: s.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      cars: p.cars,
      handCount: handSize(p.hand),
      contractCount: p.contracts.length,
      routePoints: p.routePoints,
      longest: longestLine(owned[i]),
      choosing: p.pending !== null,
      connected: connected(p.id),
    })),
    market: [...s.market],
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    contractDeckCount: s.contractDeck.length,
    claims: { ...s.claims },
    log: s.log.slice(-40),
    results: s.results
      ? s.results.map((r) => ({
          ...r,
          contracts: [...r.completed.map((id) => ({ id, done: true })), ...r.failed.map((id) => ({ id, done: false }))],
        }))
      : null,
    me: me
      ? {
          index: meIndex,
          hand: { ...me.hand },
          contracts: myContracts,
          pending: me.pending ? [...me.pending] : null,
          minKeep: me.minKeep,
        }
      : null,
  };
}
