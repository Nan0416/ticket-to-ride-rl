import { CARD_HEX, PLAYER_COLOR_HEX, type Card, type PlayerColor, type RouteColor } from '../../../shared/cards.ts';
import { CONTRACT_BY_ID, cityName } from '../../../shared/map/index.ts';

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** Shape per color so cards are distinguishable without relying on hue alone. */
const GLYPHS: Record<Card | 'gray', string> = {
  red: '<path d="M12 3l9 9-9 9-9-9z"/>',
  orange: '<circle cx="12" cy="12" r="8"/>',
  yellow: '<path d="M12 3l10 17H2z"/>',
  green: '<path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
  blue: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  purple: '<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/>',
  black: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  white: '<path fill-rule="evenodd" d="M12 3a9 9 0 110 18 9 9 0 010-18zm0 5a4 4 0 100 8 4 4 0 000-8z"/>',
  engine:
    '<path d="M4 15V9h3V6h7v3h2l3 3v3h1v3H3v-3zM8 8v2h4V8z"/><circle cx="7" cy="19" r="2"/><circle cx="16" cy="19" r="2"/>',
  gray: '<rect x="5" y="9" width="14" height="6" rx="1"/>',
};

export function glyph(c: Card | 'gray', size = 18): string {
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[c]}</svg>`;
}

export const CARD_LABEL: Record<Card, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  black: 'Black',
  white: 'White',
  engine: 'Engine',
};

export function cardChip(c: Card, extra = '', attrs = ''): string {
  return `<button class="card c-${c} ${extra}" ${attrs} title="${CARD_LABEL[c]}">${glyph(c, 20)}</button>`;
}

export function colorDot(color: PlayerColor, size = 12): string {
  return `<span class="dot" style="--c:${PLAYER_COLOR_HEX[color]};width:${size}px;height:${size}px"></span>`;
}

export function routeColorSwatch(c: RouteColor): string {
  return `<span class="swatch c-${c}" style="--c:${CARD_HEX[c]}">${glyph(c, 14)}</span>`;
}

export function contractLabel(id: string): { a: string; b: string; points: number; long: boolean } {
  const c = CONTRACT_BY_ID.get(id)!;
  return { a: cityName(c.a), b: cityName(c.b), points: c.points, long: !!c.long };
}
