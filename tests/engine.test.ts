import { describe, expect, it } from 'vitest';
import { RULES, emptyHand } from '../shared/cards.ts';
import { applyAction, createGame, legalActions, paymentOptions, totalCards, type Action, type GameState } from '../shared/engine.ts';
import { CONTRACTS, ROUTES, ROUTE_BY_ID } from '../shared/map/index.ts';
import { connectivity, longestLine } from '../shared/scoring.ts';
import { viewFor } from '../shared/view.ts';
import { nextRandom } from '../shared/rng.ts';

const TOTAL_CARDS = RULES.cardsPerColor * 8 + RULES.engineCards;

function newGame(n = 3, seed = 42) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  return createGame(players, seed);
}

/** Start a game and have everyone keep all their starting contracts. */
function started(n = 3, seed = 42): GameState {
  let s = newGame(n, seed);
  for (const p of s.players) s = applyAction(s, p.id, { type: 'keepContracts', ids: p.pending! });
  return s;
}

const cur = (s: GameState) => s.players[s.current].id;

describe('map data', () => {
  it('references valid cities and twins', () => {
    for (const r of ROUTES) {
      expect(r.length).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeLessThanOrEqual(6);
      if (r.twin) expect(ROUTE_BY_ID.get(r.twin)?.twin).toBe(r.id);
    }
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(CONTRACTS.map((c) => c.id)).size).toBe(CONTRACTS.length);
  });
});

describe('setup', () => {
  it('deals hands, market and contracts', () => {
    const s = newGame(4);
    expect(s.phase).toBe('choosing');
    expect(s.market.filter(Boolean)).toHaveLength(5);
    expect(s.market.filter((c) => c === 'engine').length).toBeLessThan(3);
    for (const p of s.players) {
      expect(Object.values(p.hand).reduce((a, b) => a + b, 0)).toBe(RULES.startingHand);
      expect(p.pending).toHaveLength(4);
      expect(p.cars).toBe(RULES.carsPerPlayer);
    }
    expect(totalCards(s)).toBe(TOTAL_CARDS);
  });

  it('requires keeping at least 2 starting contracts, then starts play', () => {
    let s = newGame(2);
    const p0 = s.players[0];
    expect(() => applyAction(s, 'p0', { type: 'keepContracts', ids: [p0.pending![0]] })).toThrow(/at least 2/);
    s = applyAction(s, 'p0', { type: 'keepContracts', ids: p0.pending!.slice(0, 2) });
    expect(s.phase).toBe('choosing');
    expect(() => applyAction(s, 'p0', { type: 'drawDeck' })).toThrow();
    s = applyAction(s, 'p1', { type: 'keepContracts', ids: s.players[1].pending! });
    expect(s.phase).toBe('playing');
    expect(s.players[0].contracts).toHaveLength(2);
  });

  it('is deterministic for a seed', () => {
    expect(newGame(3, 7)).toEqual(newGame(3, 7));
    expect(newGame(3, 7).deck).not.toEqual(newGame(3, 8).deck);
  });
});

describe('drawing cards', () => {
  it('two deck draws end the turn', () => {
    let s = started();
    const who = s.current;
    s = applyAction(s, cur(s), { type: 'drawDeck' });
    expect(s.current).toBe(who);
    expect(s.drawn).toBe(1);
    expect(() => applyAction(s, cur(s), { type: 'drawContracts' })).toThrow();
    s = applyAction(s, cur(s), { type: 'drawDeck' });
    expect(s.current).not.toBe(who);
    expect(s.drawn).toBe(0);
  });

  it('a face-up engine ends the turn immediately and cannot be a second card', () => {
    let s = started();
    s.market[0] = 'engine';
    s.market[1] = 'red';
    const who = s.current;
    const t = applyAction(s, cur(s), { type: 'drawMarket', index: 0 });
    expect(t.current).not.toBe(who);
    expect(t.players[who].hand.engine).toBe(s.players[who].hand.engine + 1);

    s = applyAction(s, cur(s), { type: 'drawMarket', index: 1 });
    s.market[0] = 'engine';
    expect(() => applyAction(s, cur(s), { type: 'drawMarket', index: 0 })).toThrow(/second card/);
  });

  it('wipes the market when 3 engines are face-up', () => {
    let s = started();
    s.market = ['engine', 'engine', 'red', 'blue', 'green'];
    s.deck.push('engine'); // next refill reveals a third engine
    const before = totalCards(s);
    s = applyAction(s, cur(s), { type: 'drawMarket', index: 2 });
    expect(s.market.filter((c) => c === 'engine').length).toBeLessThan(3);
    expect(totalCards(s)).toBe(before);
  });

  it('rejects moves from the wrong player', () => {
    const s = started();
    const other = s.players[(s.current + 1) % 3].id;
    expect(() => applyAction(s, other, { type: 'drawDeck' })).toThrow(/not your turn/);
  });
});

describe('claiming routes', () => {
  const colored = ROUTES.find((r) => r.color !== 'gray' && r.length === 3 && !r.twin)!;
  const gray = ROUTES.find((r) => r.color === 'gray' && r.length === 2)!;

  it('pays with matching cards and engines', () => {
    let s = started();
    const pi = s.current;
    s.players[pi].hand = { ...emptyHand(), [colored.color]: 2, engine: 1 };
    const before = totalCards(s);
    expect(() =>
      applyAction(s, cur(s), { type: 'claimRoute', routeId: colored.id, color: colored.color as any, engines: 0 }),
    ).toThrow(/Not enough/);
    s = applyAction(s, cur(s), { type: 'claimRoute', routeId: colored.id, color: colored.color as any, engines: 1 });
    expect(s.claims[colored.id]).toBe(pi);
    expect(s.players[pi].cars).toBe(RULES.carsPerPlayer - 3);
    expect(s.players[pi].routePoints).toBe(RULES.routePoints[3]);
    expect(totalCards(s)).toBe(before);
    expect(s.players[pi].hand.engine + s.players[pi].hand[colored.color as 'red']).toBe(0);
  });

  it('rejects the wrong color on a colored route but allows any one color on gray', () => {
    const s = started();
    const pi = s.current;
    const wrong = colored.color === 'red' ? 'blue' : 'red';
    s.players[pi].hand = { ...emptyHand(), [wrong]: 3, purple: 2 };
    expect(() => applyAction(s, cur(s), { type: 'claimRoute', routeId: colored.id, color: wrong, engines: 0 })).toThrow(/needs/);
    const t = applyAction(s, cur(s), { type: 'claimRoute', routeId: gray.id, color: 'purple', engines: 0 });
    expect(t.claims[gray.id]).toBe(pi);
  });

  it('lists payment options', () => {
    const hand = { ...emptyHand(), red: 1, blue: 2, engine: 1 };
    const opts = paymentOptions(hand, gray);
    expect(opts).toContainEqual({ color: 'blue', engines: 0 });
    expect(opts).toContainEqual({ color: 'red', engines: 1 });
    expect(opts).toContainEqual({ color: 'blue', engines: 1 });
    expect(opts[0].engines).toBe(0);
  });

  it('closes the second track of a double route in 2-3 player games', () => {
    const dbl = ROUTES.find((r) => r.twin)!;
    const twin = ROUTE_BY_ID.get(dbl.twin!)!;
    for (const [n, allowed] of [
      [3, false],
      [4, true],
    ] as const) {
      let s = started(n);
      s.claims[dbl.id] = (s.current + 1) % n;
      const pi = s.current;
      s.players[pi].hand = { ...emptyHand(), engine: 6 };
      const act: Action = { type: 'claimRoute', routeId: twin.id, color: 'red', engines: twin.length };
      if (allowed) expect(applyAction(s, cur(s), act).claims[twin.id]).toBe(pi);
      else expect(() => applyAction(s, cur(s), act)).toThrow(/only one track/);
      // never both tracks for the same player
      s = started(n);
      s.claims[dbl.id] = s.current;
      s.players[s.current].hand = { ...emptyHand(), engine: 6 };
      expect(() => applyAction(s, cur(s), act)).toThrow(/parallel/);
    }
  });
});

describe('contracts', () => {
  it('drawing contracts requires keeping at least one and ends the turn', () => {
    let s = started();
    const who = s.current;
    s = applyAction(s, cur(s), { type: 'drawContracts' });
    expect(s.players[who].pending).toHaveLength(3);
    expect(s.current).toBe(who);
    expect(() => applyAction(s, cur(s), { type: 'drawDeck' })).toThrow(/contracts to keep/);
    expect(() => applyAction(s, cur(s), { type: 'keepContracts', ids: [] })).toThrow(/at least 1/);
    const before = s.contractDeck.length;
    s = applyAction(s, cur(s), { type: 'keepContracts', ids: [s.players[who].pending![0]] });
    expect(s.current).not.toBe(who);
    expect(s.contractDeck.length).toBe(before + 2);
  });
});

describe('scoring helpers', () => {
  it('computes connectivity and the longest line', () => {
    const ids = ['vancouver-calgary', 'calgary-regina', 'regina-winnipeg', 'calgary-edmonton'];
    const conn = connectivity(ids);
    expect(conn('vancouver', 'winnipeg')).toBe(true);
    expect(conn('vancouver', 'portland')).toBe(false);
    const len = (id: string) => ROUTE_BY_ID.get(id)!.length;
    expect(longestLine(ids)).toBe(len('vancouver-calgary') + len('calgary-regina') + len('regina-winnipeg'));
    // a loop can be traversed fully
    const loop = ['denver-omaha', 'omaha-kansascity-1', 'denver-kansascity-1'];
    expect(longestLine(loop)).toBe(loop.reduce((n, id) => n + len(id), 0));
  });
});

describe('end of game', () => {
  it('triggers a final round and scores', () => {
    let s = started(3);
    const trigger = s.current;
    s.players[trigger].cars = 3;
    const r = ROUTES.find((x) => x.length === 1 && !x.twin)!;
    s.players[trigger].hand = { ...emptyHand(), engine: 1 };
    s = applyAction(s, cur(s), { type: 'claimRoute', routeId: r.id, color: 'red', engines: 1 });
    expect(s.finalTurnsLeft).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(s.phase).toBe('playing');
      s = applyAction(s, cur(s), { type: 'drawDeck' });
      if (s.phase === 'playing' && s.drawn === 1) s = applyAction(s, cur(s), { type: 'drawDeck' });
    }
    expect(s.phase).toBe('over');
    expect(s.results).toHaveLength(3);
    const res = s.results!.find((x) => x.player === trigger)!;
    expect(res.longestBonus).toBe(RULES.longestLineBonus);
    expect(res.total).toBe(res.routePoints + res.contractPoints + res.longestBonus);
    expect(Math.min(...s.results!.map((x) => x.rank))).toBe(1);
  });
});

describe('random full games', () => {
  it('always terminate and keep invariants', () => {
    for (let g = 0; g < 120; g++) {
      const n = 2 + (g % 4);
      let s = newGame(n, 1000 + g);
      const rng = { rng: g * 7919 };
      let steps = 0;
      while (s.phase !== 'over') {
        if (++steps > 4000) throw new Error(`game ${g} did not finish`);
        const actors = s.phase === 'choosing' ? s.players.filter((p) => p.pending).map((p) => p.id) : [cur(s)];
        const actor = actors[Math.floor(nextRandom(rng) * actors.length)];
        const acts = legalActions(s, actor);
        expect(acts.length).toBeGreaterThan(0);
        // prefer building so games end in reasonable time
        const claims = acts.filter((a) => a.type === 'claimRoute');
        const pool = claims.length && nextRandom(rng) < 0.6 ? claims : acts;
        s = applyAction(s, actor, pool[Math.floor(nextRandom(rng) * pool.length)]);
        expect(totalCards(s)).toBe(TOTAL_CARDS);
        for (const p of s.players) expect(p.cars).toBeGreaterThanOrEqual(0);
      }
      expect(s.results).toHaveLength(n);
      // views never leak other players' hands
      const v = viewFor(s, s.players[0].id);
      expect(JSON.stringify(v.players)).not.toContain('"hand"');
    }
  });
});
