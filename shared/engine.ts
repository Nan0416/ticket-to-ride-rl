// Rocky Way rules engine. Pure and deterministic: (state, action) -> new state.
// The server owns the authoritative GameState; clients only ever see GameViews.

import { ALL_CARDS, CARD_COLORS, RULES, emptyHand, type Card, type CardColor, type Hand, type PlayerColor, PLAYER_COLORS } from './cards.ts';
import { CONTRACTS, CONTRACT_BY_ID, ROUTES, ROUTE_BY_ID, cityName, type Route } from './map/index.ts';
import { nextRandom, shuffleInPlace } from './rng.ts';
import { connectivity, longestLine } from './scoring.ts';

export class GameError extends Error {}

export interface PlayerState {
  id: string;
  name: string;
  color: PlayerColor;
  hand: Hand;
  cars: number;
  contracts: string[];
  /** contracts offered and waiting for a keep decision */
  pending: string[] | null;
  minKeep: number;
  routePoints: number;
}

export type Phase = 'choosing' | 'playing' | 'over';

export interface LogEntry {
  seq: number;
  player: number | null;
  text: string;
}

export interface FinalResult {
  player: number;
  routePoints: number;
  contractPoints: number;
  completed: string[];
  failed: string[];
  longest: number;
  longestBonus: number;
  total: number;
  rank: number;
}

export interface GameState {
  id: string;
  rng: number;
  players: PlayerState[];
  deck: Card[];
  discard: Card[];
  market: (Card | null)[];
  contractDeck: string[];
  phase: Phase;
  current: number;
  /** cards drawn so far in the current turn (0 or 1) */
  drawn: number;
  /** turns left once the final round has been triggered */
  finalTurnsLeft: number | null;
  claims: Record<string, number>;
  turn: number;
  log: LogEntry[];
  logSeq: number;
  results: FinalResult[] | null;
}

export type Payment = { color: CardColor; engines: number };

export type Action =
  | { type: 'keepContracts'; ids: string[] }
  | { type: 'drawMarket'; index: number }
  | { type: 'drawDeck' }
  | { type: 'drawContracts' }
  | { type: 'claimRoute'; routeId: string; color: CardColor; engines: number }
  | { type: 'pass' };

const LOG_LIMIT = 80;

// ---------------------------------------------------------------- setup

export function createGame(players: { id: string; name: string }[], seed: number): GameState {
  if (players.length < RULES.minPlayers || players.length > RULES.maxPlayers) {
    throw new GameError(`Rocky Way needs ${RULES.minPlayers}-${RULES.maxPlayers} players`);
  }
  const s: GameState = {
    id: (seed >>> 0).toString(36),
    rng: seed >>> 0,
    players: [],
    deck: [],
    discard: [],
    market: new Array(RULES.marketSize).fill(null),
    contractDeck: [],
    phase: 'choosing',
    current: 0,
    drawn: 0,
    finalTurnsLeft: null,
    claims: {},
    turn: 1,
    log: [],
    logSeq: 0,
    results: null,
  };
  for (const c of CARD_COLORS) for (let i = 0; i < RULES.cardsPerColor; i++) s.deck.push(c);
  for (let i = 0; i < RULES.engineCards; i++) s.deck.push('engine');
  shuffleInPlace(s.deck, s);

  const regular = shuffleInPlace(CONTRACTS.filter((c) => !c.long).map((c) => c.id), s);
  const long = shuffleInPlace(CONTRACTS.filter((c) => c.long).map((c) => c.id), s);
  s.contractDeck = regular;

  // random first player
  const first = Math.floor(nextRandom(s) * players.length);
  players.forEach((p, i) => {
    const hand = emptyHand();
    for (let k = 0; k < RULES.startingHand; k++) hand[s.deck.pop()!]++;
    const pending = [
      ...long.splice(-RULES.initialLongContracts),
      ...s.contractDeck.splice(-RULES.initialRegularContracts),
    ];
    s.players.push({
      id: p.id,
      name: p.name,
      color: PLAYER_COLORS[i],
      hand,
      cars: RULES.carsPerPlayer,
      contracts: [],
      pending,
      minKeep: RULES.initialMinKeep,
      routePoints: 0,
    });
  });
  s.current = first;
  refillMarket(s);
  log(s, null, `All aboard! Choose your starting contracts. ${s.players[first].name} will go first.`);
  return s;
}

// ---------------------------------------------------------------- helpers

function log(s: GameState, player: number | null, text: string) {
  s.log.push({ seq: ++s.logSeq, player, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function drawCard(s: GameState): Card | null {
  if (s.deck.length === 0) {
    if (s.discard.length === 0) return null;
    s.deck = shuffleInPlace(s.discard, s);
    s.discard = [];
    log(s, null, 'The discard pile was shuffled into a new deck.');
  }
  return s.deck.pop() ?? null;
}

function enginesInMarket(s: GameState) {
  return s.market.filter((c) => c === 'engine').length;
}

function refillMarket(s: GameState) {
  for (let i = 0; i < s.market.length; i++) if (s.market[i] === null) s.market[i] = drawCard(s);
  // Too many engines face-up: wipe and redeal (bounded, in case the deck is engine-heavy)
  for (let guard = 0; guard < 4 && enginesInMarket(s) >= RULES.marketEngineLimit; guard++) {
    const nonEnginesLeft = [...s.deck, ...s.discard].filter((c) => c !== 'engine').length;
    if (nonEnginesLeft < RULES.marketSize - RULES.marketEngineLimit + 1) break;
    for (let i = 0; i < s.market.length; i++) {
      const c = s.market[i];
      if (c) s.discard.push(c);
      s.market[i] = null;
    }
    for (let i = 0; i < s.market.length; i++) s.market[i] = drawCard(s);
    log(s, null, `${RULES.marketEngineLimit} engines face-up — the market was redealt.`);
  }
}

function canDrawAnotherCard(s: GameState): boolean {
  return s.deck.length + s.discard.length > 0 || s.market.some((c) => c !== null && c !== 'engine');
}

export function routeLabel(r: Route): string {
  return `${cityName(r.a)} – ${cityName(r.b)}`;
}

export function playerIndex(s: GameState, playerId: string): number {
  const i = s.players.findIndex((p) => p.id === playerId);
  if (i < 0) throw new GameError('You are not in this game');
  return i;
}

/** Why the player can't claim this route right now (ignoring cards), or null if they can. */
export function claimBlocker(s: GameState, pi: number, route: Route): string | null {
  if (s.claims[route.id] !== undefined) return 'That route is already taken';
  if (route.twin) {
    const owner = s.claims[route.twin];
    if (owner === pi) return 'You already own the parallel track';
    if (owner !== undefined && s.players.length < RULES.doubleRouteMinPlayers) {
      return `With ${s.players.length} players only one track of a double route can be used`;
    }
  }
  if (s.players[pi].cars < route.length) return `You only have ${s.players[pi].cars} cars left`;
  return null;
}

/** All distinct ways to pay for a route from a hand, cheapest in engines first. */
export function paymentOptions(hand: Hand, route: Route): Payment[] {
  const out: Payment[] = [];
  const colors: readonly CardColor[] = route.color === 'gray' ? CARD_COLORS : [route.color];
  for (const color of colors) {
    const maxColored = Math.min(hand[color], route.length);
    for (let colored = maxColored; colored >= 1; colored--) {
      const engines = route.length - colored;
      if (engines <= hand.engine) out.push({ color, engines });
    }
  }
  if (hand.engine >= route.length) {
    out.push({ color: route.color === 'gray' ? 'red' : route.color, engines: route.length });
  }
  return out.sort((a, b) => a.engines - b.engines);
}

function requireTurn(s: GameState, pi: number) {
  if (s.phase === 'over') throw new GameError('The game is over');
  if (s.phase !== 'playing') throw new GameError('Waiting for everyone to choose contracts');
  if (s.current !== pi) throw new GameError("It's not your turn");
  if (s.players[pi].pending) throw new GameError('Choose which contracts to keep first');
}

// ---------------------------------------------------------------- actions

export function applyAction(state: GameState, playerId: string, action: Action): GameState {
  const s = structuredClone(state);
  const pi = playerIndex(s, playerId);
  const p = s.players[pi];

  switch (action.type) {
    case 'keepContracts': {
      if (!p.pending) throw new GameError('You have no contracts to choose from');
      if (s.phase === 'playing' && s.current !== pi) throw new GameError("It's not your turn");
      const ids = [...new Set(action.ids)];
      if (!ids.every((id) => p.pending!.includes(id))) throw new GameError('Invalid contract choice');
      const need = Math.min(p.minKeep, p.pending.length);
      if (ids.length < need) throw new GameError(`Keep at least ${need} contract${need > 1 ? 's' : ''}`);
      p.contracts.push(...ids);
      const returned = p.pending.filter((id) => !ids.includes(id));
      // returned regular contracts go to the bottom of the deck; long ones leave the game
      s.contractDeck.unshift(...returned.filter((id) => !CONTRACT_BY_ID.get(id)?.long));
      p.pending = null;
      if (s.phase === 'choosing') {
        log(s, pi, `${p.name} kept ${ids.length} starting contract${ids.length > 1 ? 's' : ''}.`);
        if (s.players.every((q) => !q.pending)) {
          s.phase = 'playing';
          log(s, null, `Let's roll! ${s.players[s.current].name} takes the first turn.`);
        }
      } else {
        log(s, pi, `${p.name} kept ${ids.length} new contract${ids.length > 1 ? 's' : ''}.`);
        endTurn(s);
      }
      return s;
    }

    case 'drawMarket': {
      requireTurn(s, pi);
      const card = s.market[action.index];
      if (card === null || card === undefined) throw new GameError('There is no card there');
      if (card === 'engine' && s.drawn > 0) throw new GameError("An engine can't be your second card");
      p.hand[card]++;
      s.market[action.index] = null;
      refillMarket(s);
      log(s, pi, `${p.name} took a face-up ${card} card.`);
      if (card === 'engine') endTurn(s);
      else afterDraw(s);
      return s;
    }

    case 'drawDeck': {
      requireTurn(s, pi);
      const card = drawCard(s);
      if (!card) throw new GameError('The deck is empty');
      p.hand[card]++;
      // a market slot may have been empty because the deck ran dry
      if (s.market.some((c) => c === null)) refillMarket(s);
      log(s, pi, `${p.name} drew from the deck.`);
      afterDraw(s);
      return s;
    }

    case 'drawContracts': {
      requireTurn(s, pi);
      if (s.drawn > 0) throw new GameError('Finish drawing cards this turn');
      if (s.contractDeck.length === 0) throw new GameError('No contracts left');
      p.pending = s.contractDeck.splice(-RULES.drawContracts);
      p.minKeep = RULES.drawMinKeep;
      log(s, pi, `${p.name} is looking at new contracts.`);
      return s;
    }

    case 'claimRoute': {
      requireTurn(s, pi);
      if (s.drawn > 0) throw new GameError('Finish drawing cards this turn');
      const route = ROUTE_BY_ID.get(action.routeId);
      if (!route) throw new GameError('Unknown route');
      const blocked = claimBlocker(s, pi, route);
      if (blocked) throw new GameError(blocked);
      const engines = Math.floor(action.engines);
      if (!(engines >= 0 && engines <= route.length)) throw new GameError('Invalid payment');
      const colored = route.length - engines;
      if (colored > 0) {
        if (!CARD_COLORS.includes(action.color)) throw new GameError('Invalid card color');
        if (route.color !== 'gray' && action.color !== route.color) throw new GameError(`This route needs ${route.color} cards`);
        if (p.hand[action.color] < colored) throw new GameError(`Not enough ${action.color} cards`);
      }
      if (p.hand.engine < engines) throw new GameError('Not enough engine cards');
      if (colored > 0) {
        p.hand[action.color] -= colored;
        for (let i = 0; i < colored; i++) s.discard.push(action.color);
      }
      p.hand.engine -= engines;
      for (let i = 0; i < engines; i++) s.discard.push('engine');
      s.claims[route.id] = pi;
      p.cars -= route.length;
      const pts = RULES.routePoints[route.length];
      p.routePoints += pts;
      log(s, pi, `${p.name} built ${routeLabel(route)} (+${pts}).`);
      endTurn(s);
      return s;
    }

    case 'pass': {
      requireTurn(s, pi);
      if (s.drawn === 0 && hasAnyMove(s, pi)) throw new GameError('You still have moves available');
      log(s, pi, `${p.name} passed.`);
      endTurn(s);
      return s;
    }

    default:
      throw new GameError('Unknown action');
  }
}

function afterDraw(s: GameState) {
  s.drawn++;
  if (s.drawn >= 2 || !canDrawAnotherCard(s)) endTurn(s);
}

function hasAnyMove(s: GameState, pi: number): boolean {
  if (canDrawAnotherCard(s) || s.market.some((c) => c !== null)) return true;
  if (s.contractDeck.length > 0) return true;
  const p = s.players[pi];
  return ROUTES.some((r) => !claimBlocker(s, pi, r) && paymentOptions(p.hand, r).length > 0);
}

function endTurn(s: GameState) {
  const p = s.players[s.current];
  if (s.finalTurnsLeft !== null) {
    s.finalTurnsLeft--;
    if (s.finalTurnsLeft <= 0) {
      finish(s);
      return;
    }
  } else if (p.cars <= RULES.finalRoundCars) {
    s.finalTurnsLeft = s.players.length;
    log(s, s.current, `${p.name} is down to ${p.cars} cars — everyone gets one final turn!`);
  }
  s.current = (s.current + 1) % s.players.length;
  s.drawn = 0;
  s.turn++;
}

function finish(s: GameState) {
  s.phase = 'over';
  s.drawn = 0;
  const owned = s.players.map((_, i) => Object.keys(s.claims).filter((id) => s.claims[id] === i));
  const longest = owned.map((ids) => longestLine(ids));
  const maxLongest = Math.max(...longest);
  const results: FinalResult[] = s.players.map((p, i) => {
    const connected = connectivity(owned[i]);
    const completed: string[] = [];
    const failed: string[] = [];
    let contractPoints = 0;
    for (const id of p.contracts) {
      const c = CONTRACT_BY_ID.get(id)!;
      if (connected(c.a, c.b)) {
        completed.push(id);
        contractPoints += c.points;
      } else {
        failed.push(id);
        contractPoints -= c.points;
      }
    }
    const longestBonus = maxLongest > 0 && longest[i] === maxLongest ? RULES.longestLineBonus : 0;
    return {
      player: i,
      routePoints: p.routePoints,
      contractPoints,
      completed,
      failed,
      longest: longest[i],
      longestBonus,
      total: p.routePoints + contractPoints + longestBonus,
      rank: 0,
    };
  });
  const sorted = [...results].sort(
    (a, b) => b.total - a.total || b.completed.length - a.completed.length || b.longestBonus - a.longestBonus,
  );
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank =
      prev && prev.total === r.total && prev.completed.length === r.completed.length && prev.longestBonus === r.longestBonus
        ? prev.rank
        : i + 1;
  });
  s.results = results;
  const winners = results.filter((r) => r.rank === 1).map((r) => s.players[r.player].name);
  log(s, null, `Final whistle! ${winners.join(' & ')} win${winners.length > 1 ? '' : 's'} with ${sorted[0].total} points.`);
}

// ---------------------------------------------------------------- queries

/** Every legal action for a player right now (used by tests and future bots). */
export function legalActions(s: GameState, playerId: string): Action[] {
  const pi = s.players.findIndex((p) => p.id === playerId);
  if (pi < 0 || s.phase === 'over') return [];
  const p = s.players[pi];
  if (p.pending) {
    // a representative subset: keep everything, or keep the first `minKeep`
    const need = Math.min(p.minKeep, p.pending.length);
    const out: Action[] = [{ type: 'keepContracts', ids: [...p.pending] }];
    if (need < p.pending.length) out.push({ type: 'keepContracts', ids: p.pending.slice(0, need) });
    return s.phase === 'playing' && s.current !== pi ? [] : out;
  }
  if (s.phase !== 'playing' || s.current !== pi) return [];
  const out: Action[] = [];
  s.market.forEach((c, index) => {
    if (c && !(c === 'engine' && s.drawn > 0)) out.push({ type: 'drawMarket', index });
  });
  if (s.deck.length + s.discard.length > 0) out.push({ type: 'drawDeck' });
  if (s.drawn === 0) {
    if (s.contractDeck.length > 0) out.push({ type: 'drawContracts' });
    for (const r of ROUTES) {
      if (claimBlocker(s, pi, r)) continue;
      for (const pay of paymentOptions(p.hand, r)) out.push({ type: 'claimRoute', routeId: r.id, ...pay });
    }
  }
  if (out.length === 0) out.push({ type: 'pass' });
  return out;
}

export function ownedRoutes(s: GameState, pi: number): string[] {
  return Object.keys(s.claims).filter((id) => s.claims[id] === pi);
}

export function totalCards(s: GameState): number {
  let n = s.deck.length + s.discard.length + s.market.filter((c) => c !== null).length;
  for (const p of s.players) for (const c of ALL_CARDS) n += p.hand[c];
  return n;
}
