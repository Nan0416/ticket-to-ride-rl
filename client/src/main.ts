import './styles.css';
import { ALL_CARDS, PLAYER_COLOR_HEX, RULES, type Card, type PlayerColor } from '../../shared/cards.ts';
import { paymentOptions, type Action, type Payment } from '../../shared/engine.ts';
import { ROUTE_BY_ID, cityName, CONTRACT_BY_ID } from '../../shared/map/index.ts';
import type { RoomInfo, ServerMsg } from '../../shared/protocol.ts';
import type { GameView } from '../../shared/view.ts';
import { Net, type ConnState } from './net.ts';
import { createStage } from './scene/stage.ts';
import { icon } from './ui/icons.ts';
import { $, CARD_LABEL, cardChip, colorDot, contractLabel, esc, glyph, routeColorSwatch } from './ui/util.ts';

// ------------------------------------------------------------------ state

interface FeedItem {
  key: string;
  kind: 'log' | 'chat';
  player: number | null;
  from?: string;
  color?: PlayerColor;
  text: string;
}

interface AppState {
  conn: ConnState;
  session: { token: string; code: string; playerId: string } | null;
  room: RoomInfo | null;
  view: GameView | null;
  selectedRoute: string | null;
  payIdx: number;
  keep: string[];
  sheet: null | 'contracts' | 'feed';
  modal: null | 'help' | 'results';
  feed: FeedItem[];
  lastLogSeq: number;
  unread: number;
  joinCode: string;
}

const params = new URLSearchParams(location.search);
let S: AppState = {
  conn: 'connecting',
  session: null,
  room: null,
  view: null,
  selectedRoute: null,
  payIdx: 0,
  keep: [],
  sheet: null,
  modal: null,
  feed: [],
  lastLogSeq: 0,
  unread: 0,
  joinCode: (params.get('room') ?? '').toUpperCase(),
};

function set(patch: Partial<AppState>) {
  S = { ...S, ...patch };
  render();
}

const store = {
  get name(): string {
    try {
      return localStorage.getItem('rockyway.name') ?? '';
    } catch {
      return '';
    }
  },
  set name(v: string) {
    try {
      localStorage.setItem('rockyway.name', v);
    } catch {
      /* ignore */
    }
  },
};

// ------------------------------------------------------------------ boot

const net = new Net();

// When the host plays on localhost, invite links should use the machine's LAN address instead.
let lanHost: string | null = null;
if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  fetch('/api/lan')
    .then((r) => r.json())
    .then((d: { addresses: string[] }) => {
      const ip = d.addresses.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) ?? d.addresses[0];
      if (ip) {
        lanHost = `${ip}${location.port ? ':' + location.port : ''}`;
        render();
      }
    })
    .catch(() => {});
}
const inviteLink = (code: string) => `${location.protocol}//${lanHost ?? location.host}${location.pathname}?room=${code}`;
const stage = createStage($('#stage'));
stage.setIdle(true);

const send = (action: Action) => net.send({ t: 'action', action });

net.onState((conn) => set({ conn }));
net.onMessage(onServer);

function onServer(m: ServerMsg) {
  switch (m.t) {
    case 'session':
      net.token = m.token;
      history.replaceState(null, '', `?room=${m.code}`);
      set({ session: { token: m.token, code: m.code, playerId: m.playerId } });
      break;
    case 'room':
      set({ room: m.room });
      break;
    case 'game':
      onGame(m.view);
      break;
    case 'left':
      resetToHome();
      break;
    case 'error':
      toast(m.message, 'error');
      if (m.fatal) resetToHome();
      break;
    case 'chat': {
      const item: FeedItem = { key: `c${Date.now()}${Math.random()}`, kind: 'chat', player: null, from: m.from, color: m.color, text: m.text };
      set({ feed: [...S.feed, item].slice(-120), unread: S.sheet === 'feed' ? 0 : S.unread + 1 });
      break;
    }
  }
}

function resetToHome() {
  net.token = null;
  history.replaceState(null, '', location.pathname);
  stage.board.setClaims({}, [], false);
  stage.board.setSelected(null);
  stage.board.setFocusCities([]);
  stage.board.setContractCities([]);
  stage.setIdle(true);
  stage.resetView();
  set({ session: null, room: null, view: null, selectedRoute: null, feed: [], lastLogSeq: 0, modal: null, sheet: null });
}

function myIndex(v: GameView | null = S.view): number {
  return v?.me?.index ?? -1;
}

function onGame(view: GameView) {
  if (S.view && S.view.gameId !== view.gameId) {
    // rematch: start fresh
    S = { ...S, view: null, feed: [], lastLogSeq: 0, selectedRoute: null, modal: null };
    stage.board.setSelected(null);
  }
  const prev = S.view;
  const firstView = !prev;
  stage.board.setClaims(view.claims, view.players.map((p) => p.color), !firstView);
  if (firstView) {
    stage.setIdle(false);
    stage.resetView();
  }

  // feed: append new log entries
  const fresh = view.log.filter((e) => e.seq > S.lastLogSeq);
  const feed = [...S.feed, ...fresh.map<FeedItem>((e) => ({ key: `l${e.seq}`, kind: 'log', player: e.player, text: e.text }))].slice(-120);

  // keep-selection resets whenever a new contract offer shows up
  const pendingKey = view.me?.pending?.join(',') ?? '';
  const prevPendingKey = prev?.me?.pending?.join(',') ?? '';
  const keep = pendingKey !== prevPendingKey ? [] : S.keep.filter((id) => view.me?.pending?.includes(id));

  // drop selection when that route got built
  let selectedRoute = S.selectedRoute;
  if (selectedRoute && view.claims[selectedRoute] !== undefined && prev?.claims[selectedRoute] === undefined) {
    selectedRoute = null;
    stage.board.setSelected(null);
  }

  // your-turn nudge
  const me = myIndex(view);
  const myTurnNow = view.phase === 'playing' && view.current === me;
  const myTurnBefore = prev?.phase === 'playing' && prev.current === me;
  if (myTurnNow && !myTurnBefore && !firstView) {
    navigator.vibrate?.(60);
    flashBanner();
  }
  document.title = myTurnNow ? '● Your turn — Rocky Way' : 'Rocky Way';

  // contract cities on the map
  const open = view.me?.contracts.filter((c) => !c.done).map((c) => CONTRACT_BY_ID.get(c.id)!) ?? [];
  stage.board.setContractCities(open.flatMap((c) => [c.a, c.b]));

  const modal = view.phase === 'over' && prev?.phase !== 'over' ? 'results' : S.modal;
  set({ view, feed, lastLogSeq: Math.max(S.lastLogSeq, ...view.log.map((e) => e.seq)), keep, selectedRoute, modal });
}

// ------------------------------------------------------------------ helpers

function isMyTurn(v = S.view) {
  return !!v && v.phase === 'playing' && v.current === myIndex(v) && !v.me?.pending;
}

function routeBlocker(v: GameView, routeId: string): string | null {
  const r = ROUTE_BY_ID.get(routeId)!;
  const me = myIndex(v);
  const owner = v.claims[routeId];
  if (owner !== undefined) return `Built by ${v.players[owner].name}`;
  if (r.twin) {
    const twinOwner = v.claims[r.twin];
    if (twinOwner === me) return 'You already own the parallel track';
    if (twinOwner !== undefined && v.players.length < RULES.doubleRouteMinPlayers)
      return `Closed: with ${v.players.length} players only one track of a double route is used`;
  }
  if (v.phase !== 'playing') return v.phase === 'over' ? 'The game is over' : 'Waiting for everyone to pick contracts';
  if (v.current !== me) return `Wait for your turn (${v.players[v.current].name} is playing)`;
  if (v.me?.pending) return 'Choose your contracts first';
  if (v.drawn > 0) return 'Draw your second card first';
  if (v.players[me].cars < r.length) return `You only have ${v.players[me].cars} cars left`;
  return null;
}

function currentPayments(): Payment[] {
  const v = S.view;
  if (!v?.me || !S.selectedRoute) return [];
  return paymentOptions(v.me.hand, ROUTE_BY_ID.get(S.selectedRoute)!);
}

function selectRoute(id: string | null) {
  if (!S.view || id === S.selectedRoute) id = null;
  const v = S.view;
  const canBuild = !!(v && id && !routeBlocker(v, id) && v.me && paymentOptions(v.me.hand, ROUTE_BY_ID.get(id)!).length);
  stage.board.setSelected(id, canBuild ? v!.players[myIndex(v)].color : undefined);
  set({ selectedRoute: id, payIdx: 0 });
}

stage.onPick((id) => selectRoute(id));

if (import.meta.env.DEV) (window as any).__rw = { stage, net, get state() { return S; } };

// ------------------------------------------------------------------ toasts / banner

function toast(text: string, kind: 'error' | 'info' = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

function flashBanner() {
  const b = $('#banner');
  b.classList.remove('flash');
  void b.offsetWidth;
  b.classList.add('flash');
}

// ------------------------------------------------------------------ rendering

const cache = new Map<string, string>();
function patch(sel: string, html: string) {
  if (cache.get(sel) === html) return;
  cache.set(sel, html);
  $(sel).innerHTML = html;
}

function render() {
  const inGame = !!(S.room?.started && S.view);
  document.body.classList.toggle('in-game', inGame);
  stage.setInteractive(inGame);
  patch('#screen', inGame ? '' : renderScreen());
  $('#hud').hidden = !inGame;
  if (inGame) renderHud();
  patch('#modal', renderModal());
  patch('#conn', S.conn === 'open' ? '' : `<div class="conn-pill">${S.conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>`);
}

function renderScreen(): string {
  if (!S.session) {
    const code = esc(S.joinCode);
    return `
    <div class="card-screen">
      <div class="brand">
        <div class="brand-mark">${icon('car', 30)}</div>
        <h1>Rocky Way</h1>
        <p class="tag">Lay track across North America. Connect your contracts. Outbuild your friends.</p>
      </div>
      <label class="field"><span>Your name</span>
        <input id="name" maxlength="16" autocomplete="nickname" placeholder="e.g. Casey" value="${esc(store.name)}" />
      </label>
      <button class="btn primary big" data-act="create">Create a new game</button>
      <div class="or"><span>or join a friend</span></div>
      <div class="join-row">
        <input id="code" name="room-code" type="text" inputmode="text" maxlength="4" placeholder="CODE" value="${code}" autocapitalize="characters" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" />
        <button class="btn" data-act="join">Join</button>
      </div>
      <p class="fine">2–5 players · phones, tablets & desktop</p>
    </div>`;
  }
  const room = S.room;
  if (!room) return `<div class="card-screen"><p>Joining…</p></div>`;
  const me = S.session.playerId;
  const isHost = room.hostId === me;
  const link = inviteLink(room.code);
  const slots = Array.from({ length: RULES.maxPlayers }, (_, i) => room.players[i]);
  return `
  <div class="card-screen lobby">
    <div class="lobby-head">
      <div>
        <div class="eyebrow">Room code</div>
        <div class="room-code">${esc(room.code)}</div>
      </div>
      <button class="btn small ghost" data-act="copy-link" data-link="${esc(link)}">${icon('copy')} Copy invite link</button>
    </div>
    <p class="fine">Friends on the same Wi-Fi can open <b class="invite-url">${esc(link.replace(/^https?:\/\//, ''))}</b></p>
    <ul class="seats">
      ${slots
        .map((p) =>
          p
            ? `<li class="seat" style="--c:${PLAYER_COLOR_HEX[p.color]}">${colorDot(p.color, 14)}<span class="seat-name">${esc(p.name)}${p.id === me ? ' <em>(you)</em>' : ''}</span>${p.isHost ? '<span class="badge">host</span>' : ''}${p.connected ? '' : '<span class="badge muted">offline</span>'}</li>`
            : `<li class="seat empty">Waiting for a player…</li>`,
        )
        .join('')}
    </ul>
    ${
      isHost
        ? `<button class="btn primary big" data-act="start" ${room.players.length < RULES.minPlayers ? 'disabled' : ''}>${room.players.length < RULES.minPlayers ? 'Need at least 2 players' : `Start game (${room.players.length} players)`}</button>`
        : `<div class="waiting">Waiting for the host to start…</div>`
    }
    <button class="btn ghost small" data-act="leave">${icon('exit')} Leave</button>
  </div>`;
}

function renderHud() {
  const v = S.view!;
  const me = myIndex(v);

  // top bar
  patch(
    '#topbar',
    `<div class="logo">${icon('car', 18)}<span>Rocky Way</span><span class="room">${esc(S.room?.code ?? '')}</span></div>
     <div class="top-actions">
       <button class="icon-btn" data-act="reset-view" title="Reset view">${icon('home', 18)}</button>
       <button class="icon-btn only-mobile" data-act="sheet" data-sheet="contracts" title="Contracts">${icon('scroll', 18)}</button>
       <button class="icon-btn only-mobile" data-act="sheet" data-sheet="feed" title="Log & chat">${icon('chat', 18)}${S.unread ? `<span class="pip">${S.unread}</span>` : ''}</button>
       <button class="icon-btn" data-act="help" title="How to play">${icon('help', 18)}</button>
       <button class="icon-btn" data-act="leave-game" title="Leave game">${icon('exit', 18)}</button>
     </div>`,
  );

  // players
  patch(
    '#players',
    v.players
      .map((p, i) => {
        const cls = [v.phase === 'playing' && v.current === i ? 'turn' : '', i === me ? 'me' : '', p.connected ? '' : 'offline'].join(' ');
        return `<div class="pchip ${cls}" style="--c:${PLAYER_COLOR_HEX[p.color]}">
          <div class="pname">${colorDot(p.color)}<span>${esc(p.name)}</span>${p.choosing ? `<span class="mini">choosing</span>` : ''}${p.connected ? '' : '<span class="mini warn">offline</span>'}</div>
          <div class="pstats">
            <span title="Route points">${icon('star', 13)}${p.routePoints}</span>
            <span title="Cars left">${icon('car', 13)}${p.cars}</span>
            <span title="Cards in hand">${icon('cards', 13)}${p.handCount}</span>
            <span title="Contracts">${icon('scroll', 13)}${p.contractCount}</span>
            <span title="Longest line">${icon('line', 13)}${p.longest}</span>
          </div>
        </div>`;
      })
      .join(''),
  );

  // banner
  patch('#banner', `<div class="banner-inner ${isMyTurn(v) ? 'mine' : ''}">${bannerText(v)}</div>`);

  // market
  const canDraw = isMyTurn(v);
  const marketCards = v.market
    .map((c, i) => {
      if (!c) return `<div class="card empty"></div>`;
      const disabled = !canDraw || (c === 'engine' && v.drawn > 0);
      return cardChip(c, disabled ? 'disabled' : 'clickable', `data-act="market" data-i="${i}" ${disabled ? 'aria-disabled="true"' : ''}`);
    })
    .join('');
  const deckDisabled = !canDraw || v.deckCount + v.discardCount === 0;
  const contractsDisabled = !canDraw || v.drawn > 0 || v.contractDeckCount === 0;
  patch(
    '#market',
    `<div class="panel-title">Market</div>
     <div class="market-cards">${marketCards}</div>
     <div class="decks">
       <button class="deck ${deckDisabled ? 'disabled' : 'clickable'}" data-act="deck">${icon('deck', 22)}<span>Deck</span><b>${v.deckCount}</b></button>
       <button class="deck contracts ${contractsDisabled ? 'disabled' : 'clickable'}" data-act="draw-contracts">${icon('scroll', 22)}<span>Contracts</span><b>${v.contractDeckCount}</b></button>
     </div>`,
  );

  // hand
  const pays = currentPayments();
  const pay = pays[S.payIdx];
  const route = S.selectedRoute ? ROUTE_BY_ID.get(S.selectedRoute) : undefined;
  const spend: Partial<Record<Card, number>> = {};
  if (pay && route && !routeBlocker(v, route.id)) {
    if (route.length - pay.engines > 0) spend[pay.color] = route.length - pay.engines;
    if (pay.engines) spend.engine = pay.engines;
  }
  const hand = v.me?.hand;
  const total = hand ? ALL_CARDS.reduce((n, c) => n + hand[c], 0) : 0;
  patch(
    '#hand',
    hand
      ? `<div class="hand-cards">${ALL_CARDS.filter((c) => hand[c] > 0)
          .map(
            (c) =>
              `<div class="hand-card ${spend[c] ? 'spend' : ''}">${cardChip(c)}<b class="count">${hand[c]}</b>${spend[c] ? `<span class="minus">−${spend[c]}</span>` : ''}</div>`,
          )
          .join('')}${total === 0 ? '<div class="empty-hand">No cards yet. Draw from the market or the deck.</div>' : ''}</div>`
      : '',
  );

  // contracts
  const mine = v.me?.contracts ?? [];
  const done = mine.filter((c) => c.done).length;
  patch(
    '#contracts',
    `<div class="panel-title">Your contracts <span class="muted">${done}/${mine.length}</span><button class="icon-btn only-mobile close" data-act="sheet" data-sheet="">${icon('cross', 16)}</button></div>
     <ul class="contract-list">${
       mine.length
         ? mine
             .map((c) => {
               const l = contractLabel(c.id);
               return `<li class="contract ${c.done ? 'done' : ''} ${l.long ? 'long' : ''}" data-act="focus-contract" data-id="${c.id}" data-hover-contract="${c.id}">
                 <span class="route-name">${esc(l.a)} <span class="arrow">→</span> ${esc(l.b)}</span>
                 <span class="pts">${c.done ? icon('check', 14) : ''}${l.points}</span></li>`;
             })
             .join('')
         : '<li class="muted small">No contracts yet</li>'
     }</ul>`,
  );
  $('#contracts').classList.toggle('open', S.sheet === 'contracts');

  // feed (log + chat)
  const feedHtml = S.feed
    .slice(-60)
    .map((f) => {
      if (f.kind === 'chat') return `<div class="feed-item chat"><b style="color:${PLAYER_COLOR_HEX[f.color!]}">${esc(f.from)}:</b> ${esc(f.text)}</div>`;
      const p = f.player !== null ? v.players[f.player] : null;
      return `<div class="feed-item">${p ? colorDot(p.color, 8) : '<span class="dot sys"></span>'}<span>${esc(f.text)}</span></div>`;
    })
    .join('');
  const list = $('#feed-list');
  if (cache.get('#feed-list') !== feedHtml) {
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    patch('#feed-list', feedHtml);
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  $('#feed').classList.toggle('open', S.sheet === 'feed');

  // claim panel
  renderClaim(v);
}

function bannerText(v: GameView): string {
  const me = myIndex(v);
  const cur = v.players[v.current];
  const final = v.finalTurnsLeft !== null ? `<span class="final">Final round · ${v.finalTurnsLeft} turn${v.finalTurnsLeft === 1 ? '' : 's'} left</span>` : '';
  if (v.phase === 'over') return `<span>Game over!</span> <button class="link" data-act="results">See results</button>`;
  if (v.phase === 'choosing') {
    if (v.me?.pending) return `Pick your starting contracts — keep at least ${v.me.minKeep}`;
    const waiting = v.players.filter((p) => p.choosing).map((p) => esc(p.name));
    return `Waiting for ${waiting.join(', ')} to pick contracts…`;
  }
  if (v.current === me) {
    if (v.me?.pending) return `${final}Keep at least ${v.me.minKeep} of the new contracts`;
    if (v.drawn > 0) return `${final}<span>Draw one more card <span class="muted">(not a face-up engine)</span></span>`;
    return `${final}<span><b>Your turn</b> — draw 2 cards, build a route, or take contracts</span>`;
  }
  return `${final}${colorDot(cur.color)}<span><b>${esc(cur.name)}</b>${cur.choosing ? ' is choosing contracts…' : "'s turn"}</span>`;
}

function renderClaim(v: GameView) {
  const el = $('#claim');
  const id = S.selectedRoute;
  if (!id) {
    el.hidden = true;
    patch('#claim', '');
    return;
  }
  el.hidden = false;
  const r = ROUTE_BY_ID.get(id)!;
  const pts = RULES.routePoints[r.length];
  const blocker = routeBlocker(v, id);
  const pays = currentPayments();
  let body = '';
  if (blocker) body = `<p class="claim-note">${esc(blocker)}</p>`;
  else if (!pays.length) {
    const need = r.color === 'gray' ? `${r.length} cards of any one color` : `${r.length} ${r.color} cards`;
    body = `<p class="claim-note">You need ${need} (engines count as any color).</p>`;
  } else {
    body = `<div class="pay-options">${pays
      .slice(0, 12)
      .map((p, i) => {
        const colored = r.length - p.engines;
        const parts = [colored ? `${colored}× ${glyph(p.color, 14)} ${CARD_LABEL[p.color]}` : '', p.engines ? `${p.engines}× ${glyph('engine', 14)} Engine` : '']
          .filter(Boolean)
          .join(' + ');
        return `<button class="pay ${i === S.payIdx ? 'on' : ''} c-${colored ? p.color : 'engine'}" data-act="pay" data-i="${i}">${parts}</button>`;
      })
      .join('')}</div>
      <button class="btn primary build" data-act="build">Build route · +${pts}</button>`;
  }
  patch(
    '#claim',
    `<div class="claim-head">
       <div>
         <div class="claim-title">${esc(cityName(r.a))} – ${esc(cityName(r.b))}</div>
         <div class="claim-meta">${routeColorSwatch(r.color)} ${r.color === 'gray' ? 'Any color' : CARD_LABEL[r.color as Card]} · ${r.length} car${r.length > 1 ? 's' : ''} · ${pts} pt${pts > 1 ? 's' : ''}${r.twin ? ' · double route' : ''}</div>
       </div>
       <button class="icon-btn" data-act="cancel-claim" title="Close">${icon('cross', 16)}</button>
     </div>${body}`,
  );
}

function renderModal(): string {
  const v = S.view;
  // contract choice has priority while pending
  if (v?.me?.pending && S.room?.started) {
    const min = Math.min(v.me.minKeep, v.me.pending.length);
    const n = S.keep.length;
    const starting = v.phase === 'choosing';
    return `<div class="sheet-modal contracts-offer">
      <div class="modal-title">${starting ? 'Starting contracts' : 'New contracts'}</div>
      <p class="muted small">Connect both cities with your own routes by the end of the game to score the points. Unfinished contracts count against you. Keep at least ${min}.</p>
      <ul class="offer-list">${v.me.pending
        .map((id) => {
          const l = contractLabel(id);
          const on = S.keep.includes(id);
          return `<li class="offer ${on ? 'on' : ''} ${l.long ? 'long' : ''}" data-act="toggle-keep" data-id="${id}" data-hover-contract="${id}">
            <span class="check">${on ? icon('check', 16) : ''}</span>
            <span class="route-name">${esc(l.a)} <span class="arrow">→</span> ${esc(l.b)}${l.long ? '<span class="badge gold">long haul</span>' : ''}</span>
            <span class="pts">${l.points}</span></li>`;
        })
        .join('')}</ul>
      <button class="btn primary" data-act="keep" ${n < min ? 'disabled' : ''}>${n < min ? `Select at least ${min}` : `Keep ${n} contract${n > 1 ? 's' : ''}`}</button>
    </div>`;
  }
  if (S.modal === 'help') return helpModal();
  if (S.modal === 'results' && v?.results) return resultsModal(v);
  return '';
}

function helpModal(): string {
  const pts = RULES.routePoints
    .slice(1)
    .map((p, i) => `<span class="pt"><b>${i + 1}</b> car${i ? 's' : ''} → ${p}</span>`)
    .join('');
  return `<div class="backdrop" data-act="close-modal"></div>
  <div class="center-modal help">
    <div class="modal-title">How to play Rocky Way</div>
    <p>On your turn, do <b>one</b> of these:</p>
    <ol>
      <li><b>Draw 2 cards</b> from the face-up market or the deck. A face-up <b>engine</b> (wild) counts as your whole draw.</li>
      <li><b>Build a route</b>: tap a route on the map and pay cards matching its color and length. Gray routes take any single color. Engines match anything.</li>
      <li><b>Take contracts</b>: draw 3 and keep at least 1.</li>
    </ol>
    <p><b>Scoring.</b> Routes score when built: <span class="pts-table">${pts}</span></p>
    <p>Completed contracts add their points and unfinished ones subtract them. The longest continuous line gets <b>+${RULES.longestLineBonus}</b>.</p>
    <p>When someone ends a turn with ${RULES.finalRoundCars} or fewer cars, everyone (including them) gets one final turn.</p>
    <p class="muted small">In 2–3 player games only one track of each double route can be used. Mouse: drag to orbit, right-drag to pan, scroll to zoom. Touch: one finger pans, pinch zooms, two-finger drag orbits. Tap a route to inspect it.</p>
    <button class="btn primary" data-act="close-modal">Got it</button>
  </div>`;
}

function resultsModal(v: GameView): string {
  const rows = [...v.results!].sort((a, b) => a.rank - b.rank);
  const isHost = S.room?.hostId === S.session?.playerId;
  return `<div class="backdrop" data-act="close-modal"></div>
  <div class="center-modal results">
    <div class="modal-title">Final scores</div>
    <div class="results-table">
      ${rows
        .map((r) => {
          const p = v.players[r.player];
          return `<div class="result-row ${r.rank === 1 ? 'winner' : ''}" style="--c:${PLAYER_COLOR_HEX[p.color]}">
            <div class="rank">${r.rank === 1 ? '🏆' : `#${r.rank}`}</div>
            <div class="who">${colorDot(p.color)} <b>${esc(p.name)}</b></div>
            <div class="breakdown">
              <span>Routes <b>${r.routePoints}</b></span>
              <span>Contracts <b class="${r.contractPoints < 0 ? 'neg' : ''}">${r.contractPoints >= 0 ? '+' : ''}${r.contractPoints}</b></span>
              <span>Longest line ${r.longest}${r.longestBonus ? ` <b>+${r.longestBonus}</b>` : ''}</span>
            </div>
            <div class="total">${r.total}</div>
            <div class="their-contracts">${r.contracts
              .map((c) => {
                const l = contractLabel(c.id);
                return `<span class="mini-contract ${c.done ? 'done' : 'failed'}">${c.done ? icon('check', 12) : icon('cross', 12)}${esc(l.a)}–${esc(l.b)} ${l.points}</span>`;
              })
              .join('')}</div>
          </div>`;
        })
        .join('')}
    </div>
    <div class="modal-actions">
      ${isHost ? `<button class="btn primary" data-act="play-again">Play again</button>` : '<span class="muted small">The host can start a rematch.</span>'}
      <button class="btn ghost" data-act="close-modal">View board</button>
      <button class="btn ghost" data-act="leave">Leave</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ events

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t) return;
  const act = t.dataset.act!;
  switch (act) {
    case 'create': {
      const name = ($('#name') as HTMLInputElement).value.trim();
      if (!name) return toast('Enter your name first', 'error');
      store.name = name;
      net.send({ t: 'create', name });
      break;
    }
    case 'join': {
      const name = ($('#name') as HTMLInputElement).value.trim();
      const code = ($('#code') as HTMLInputElement).value.trim().toUpperCase();
      if (!name) return toast('Enter your name first', 'error');
      if (code.length !== 4) return toast('Enter the 4-letter room code', 'error');
      store.name = name;
      net.send({ t: 'join', code, name });
      break;
    }
    case 'copy-link': {
      const link = t.dataset.link!;
      navigator.clipboard?.writeText(link).then(
        () => toast('Invite link copied'),
        () => toast(link),
      );
      break;
    }
    case 'start':
    case 'play-again':
      net.send({ t: 'start' });
      set({ modal: null });
      break;
    case 'leave':
      net.send({ t: 'leave' });
      break;
    case 'leave-game':
      if (confirmLeave()) net.send({ t: 'leave' });
      break;
    case 'market':
      if (!t.classList.contains('disabled')) send({ type: 'drawMarket', index: Number(t.dataset.i) });
      break;
    case 'deck':
      if (!t.classList.contains('disabled')) send({ type: 'drawDeck' });
      break;
    case 'draw-contracts':
      if (!t.classList.contains('disabled')) send({ type: 'drawContracts' });
      break;
    case 'pay':
      set({ payIdx: Number(t.dataset.i) });
      break;
    case 'build': {
      const pay = currentPayments()[S.payIdx];
      if (pay && S.selectedRoute) send({ type: 'claimRoute', routeId: S.selectedRoute, color: pay.color, engines: pay.engines });
      break;
    }
    case 'cancel-claim':
      selectRoute(null);
      break;
    case 'toggle-keep': {
      const id = t.dataset.id!;
      set({ keep: S.keep.includes(id) ? S.keep.filter((k) => k !== id) : [...S.keep, id] });
      break;
    }
    case 'keep':
      send({ type: 'keepContracts', ids: S.keep });
      stage.board.setFocusCities([]);
      break;
    case 'focus-contract': {
      const c = CONTRACT_BY_ID.get(t.dataset.id!)!;
      stage.board.setFocusCities([c.a, c.b]);
      stage.flyToCities([c.a, c.b]);
      if (S.sheet) set({ sheet: null });
      break;
    }
    case 'sheet': {
      const sheet = (t.dataset.sheet || null) as AppState['sheet'];
      set({ sheet: S.sheet === sheet ? null : sheet, unread: sheet === 'feed' ? 0 : S.unread });
      break;
    }
    case 'reset-view':
      stage.resetView();
      break;
    case 'help':
      set({ modal: 'help' });
      break;
    case 'results':
      set({ modal: 'results' });
      break;
    case 'close-modal':
      set({ modal: null });
      break;
  }
});

function confirmLeave(): boolean {
  // a game in progress keeps your seat; leaving just disconnects this tab
  const inProgress = S.view && S.view.phase !== 'over';
  return !inProgress || window.confirm('Leave this game? Your seat is kept, but you will need the same tab to rejoin.');
}

// hovering a contract highlights its cities on the map
document.addEventListener('pointerover', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-contract]');
  if (!t) return;
  const c = CONTRACT_BY_ID.get(t.dataset.hoverContract!)!;
  stage.board.setFocusCities([c.a, c.b]);
});
document.addEventListener('pointerout', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-contract]');
  const to = (e as PointerEvent).relatedTarget as HTMLElement | null;
  if (t && !to?.closest('[data-hover-contract]')) stage.board.setFocusCities([]);
});

document.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if (e.key === 'Enter' && el.id === 'code') $('[data-act="join"]').click();
  if (e.key === 'Enter' && el.id === 'name' && !S.session) $(S.joinCode ? '[data-act="join"]' : '[data-act="create"]').click();
  if (e.key === 'Escape') {
    if (S.modal) set({ modal: null });
    else if (S.selectedRoute) selectRoute(null);
  }
});
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'code') {
    el.value = el.value.toUpperCase().replace(/[^A-Z]/g, '');
    S.joinCode = el.value;
  }
  if (el.id === 'name') store.name = el.value;
});

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input') as HTMLInputElement;
  const text = input.value.trim();
  if (text) net.send({ t: 'chat', text });
  input.value = '';
});

render();
