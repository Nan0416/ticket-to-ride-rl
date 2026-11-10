const PATHS: Record<string, string> = {
  star: '<path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z"/>',
  car: '<path d="M3 7h18v9H3z" opacity=".9"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="18.5" r="2"/>',
  cards: '<rect x="3" y="5" width="12" height="16" rx="2" opacity=".55"/><rect x="8" y="3" width="12" height="16" rx="2"/>',
  scroll: '<path d="M6 3h11a3 3 0 013 3v1h-4v12a3 3 0 01-3 3H6a3 3 0 01-3-3v-1h3zM9 8v1.5h6V8zm0 4v1.5h6V12z"/>',
  line: '<path d="M3 17l5-6 4 3 6-8 3 2-8 11-4-3-4 5z"/>',
  home: '<path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/>',
  chat: '<path d="M4 4h16v11H9l-5 4z"/>',
  help: '<path d="M12 2a10 10 0 110 20 10 10 0 010-20zm.1 14.2a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zM12 6c-2.2 0-3.7 1.3-3.8 3.3h2.3c.1-.8.6-1.3 1.4-1.3.8 0 1.4.5 1.4 1.2 0 .7-.3 1-1.2 1.6-1 .6-1.5 1.3-1.4 2.6v.6h2.3v-.5c0-.7.3-1 1.2-1.6 1-.6 1.7-1.4 1.7-2.8C15.9 7.2 14.3 6 12 6z"/>',
  exit: '<path d="M10 3h9v18h-9v-3h6V6h-6zM8 7l-5 5 5 5v-3h7v-4H8z"/>',
  check: '<path d="M9.5 16.6L4.9 12l-1.6 1.6 6.2 6.2L21 8.3l-1.6-1.6z"/>',
  cross: '<path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/>',
  copy: '<path d="M8 3h11v13H8zM5 7v14h11v-2H7V7z"/>',
  deck: '<rect x="4" y="6" width="13" height="15" rx="2" opacity=".5"/><rect x="7" y="3" width="13" height="15" rx="2"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 16): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}
