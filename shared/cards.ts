export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white'] as const;
export type CardColor = (typeof CARD_COLORS)[number];
/** "engine" is the wild card: it matches any color. */
export type Card = CardColor | 'engine';
export type RouteColor = CardColor | 'gray';
export const ALL_CARDS: Card[] = [...CARD_COLORS, 'engine'];

export const RULES = {
  cardsPerColor: 12,
  engineCards: 14,
  startingHand: 4,
  marketSize: 5,
  /** if this many engines are face-up at once, the market is wiped and refilled */
  marketEngineLimit: 3,
  carsPerPlayer: 45,
  /** final round starts when someone ends a turn with this many cars or fewer */
  finalRoundCars: 2,
  longestLineBonus: 10,
  /** points per route length (index = length) */
  routePoints: [0, 1, 2, 4, 7, 10, 15] as readonly number[],
  initialRegularContracts: 3,
  initialLongContracts: 1,
  initialMinKeep: 2,
  drawContracts: 3,
  drawMinKeep: 1,
  minPlayers: 2,
  maxPlayers: 5,
  /** with this many players or fewer only one track of a double route can be used */
  doubleRouteMinPlayers: 4,
};

export const PLAYER_COLORS = ['crimson', 'azure', 'amber', 'jade', 'violet'] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** Display colors shared by client UI and 3D scene */
export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  crimson: '#d94a4a',
  azure: '#3d8fe0',
  amber: '#f0a830',
  jade: '#2fb58a',
  violet: '#9a5fd6',
};

export const CARD_HEX: Record<Card | 'gray', string> = {
  red: '#d8423a',
  orange: '#ef8a2d',
  yellow: '#f2cf3a',
  green: '#5cae46',
  blue: '#3a78d0',
  purple: '#8e52bf',
  black: '#2d2f36',
  white: '#f1efe8',
  engine: '#c9a36a',
  gray: '#a9a69e',
};

export type Hand = Record<Card, number>;

export function emptyHand(): Hand {
  return { red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, black: 0, white: 0, engine: 0 };
}

export function handSize(h: Hand): number {
  let n = 0;
  for (const c of ALL_CARDS) n += h[c];
  return n;
}
