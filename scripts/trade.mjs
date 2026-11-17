import { COMMIT_TIMEOUT, denominations } from "./constants.mjs";
import * as socket from "./socket.mjs";

/**
 * One trade between two actors, as seen by one client.
 *
 * Each side has exactly one controlling user, and only that user writes the
 * side's offer. Every change bumps the side's `rev`. Accepting records the pair
 * of revisions the user saw ({self, other}); an acceptance only counts while
 * both revisions are still current, so any change to either offer silently
 * voids both acceptances without extra messages or races.
 *
 * Offer shape: { items: { [itemId]: ItemInfo }, currency: { [denom]: number } }
 * ItemInfo carries display data so the partner never needs to read our actor.
 */
export class Trade {
  /** @type {Map<string, Trade>} */
  static #all = new Map();

  static get(id) { return this.#all.get(id); }
  static get all() { return [...this.#all.values()]; }

  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {{actorUuid: string, userId: string}[]} data.sides  Two sides; side 0 started the trade.
   */
  constructor({ id, sides }) {
    this.id = id ?? foundry.utils.randomID();
    this.sides = sides.map(s => ({
      actorUuid: s.actorUuid,
      userId: s.userId,
      offer: Trade.emptyOffer(),
      rev: 0,
      accepted: null
    }));
    /** open | committing | done | cancelled */
    this.status = "open";
    /** @type {import("./app.mjs").TradeApp|null} */
    this.app = null;
    this.error = null;
    this.#commitTimer = null;
    Trade.#all.set(this.id, this);
  }

  #commitTimer;

  static emptyOffer() {
    return { items: {}, currency: Object.fromEntries(denominations().map(d => [d, 0])) };
  }

  /* -------------------------------------------- */
  /*  Queries                                     */
  /* -------------------------------------------- */

  /** Both sides are controlled by this user: one window edits both. */
  get local() {
    return this.sides.every(s => s.userId === game.user.id);
  }

  /** Users on the other end of the wire (empty for a local trade). */
  get partnerUserIds() {
    return [...new Set(this.sides.map(s => s.userId))].filter(id => id !== game.user.id);
  }

  get participantIds() {
    return [...new Set(this.sides.map(s => s.userId))];
  }

  canEdit(index) {
    return this.status === "open" && this.sides[index]?.userId === game.user.id;
  }

  actor(index) {
    return fromUuidSync(this.sides[index].actorUuid);
  }

  isAccepted(index) {
    const a = this.sides[index].accepted;
    return !!a && a.self === this.sides[index].rev && a.other === this.sides[1 - index].rev;
  }

  get ready() {
    return this.isAccepted(0) && this.isAccepted(1);
  }

  isEmpty(index) {
    const { items, currency } = this.sides[index].offer;
    return !Object.keys(items).length && !Object.values(currency).some(v => v > 0);
  }

  get bothEmpty() {
    return this.isEmpty(0) && this.isEmpty(1);
  }

  /** Data the executor needs: who, which actor, what. */
  serialize() {
    return this.sides.map(({ actorUuid, userId, offer }) => ({ actorUuid, userId, offer }));
  }

  /* -------------------------------------------- */
  /*  Editing (own sides only)                    */
  /* -------------------------------------------- */

  /** Offer `qty` of an item (0 withdraws it). */
  setItem(index, item, qty) {
    if (!this.canEdit(index)) return false;
    const offer = this.sides[index].offer;
    const held = item.system.quantity ?? 1;
    qty = Math.clamp(Math.floor(Number(qty) || 0), 0, held);
    const current = offer.items[item.id]?.qty ?? 0;
    if (qty === current) return false;
    if (qty > 0) offer.items[item.id] = itemInfo(item, qty);
    else delete offer.items[item.id];
    this.#changed(index);
    return true;
  }

  setCoin(index, denom, value, held) {
    if (!this.canEdit(index)) return false;
    const offer = this.sides[index].offer;
    value = Math.clamp(Math.floor(Number(value) || 0), 0, Math.max(0, held ?? 0));
    if ((offer.currency[denom] ?? 0) === value) return false;
    offer.currency[denom] = value;
    this.#changed(index);
    return true;
  }

  /**
   * Bring an offer back in line with the actor after its inventory changed
   * (item used up, sold elsewhere, coins spent). Returns true if anything moved.
   */
  reconcile(index) {
    if (!this.canEdit(index)) return false;
    const actor = this.actor(index);
    if (!actor) return false;
    const offer = this.sides[index].offer;
    let changed = false;
    for (const [id, info] of Object.entries(offer.items)) {
      const item = actor.items.get(id);
      const held = item?.system.quantity ?? 0;
      if (!item || held <= 0) { delete offer.items[id]; changed = true; continue; }
      const fresh = itemInfo(item, Math.min(info.qty, held));
      if (!foundry.utils.objectsEqual(fresh, info)) { offer.items[id] = fresh; changed = true; }
    }
    for (const d of Object.keys(offer.currency)) {
      const held = actor.system.currency?.[d] ?? 0;
      if (offer.currency[d] > held) { offer.currency[d] = held; changed = true; }
    }
    if (changed) this.#changed(index);
    return changed;
  }

  /** Accept (or withdraw acceptance of) the trade as it stands, for one of our sides. */
  accept(index, value = true) {
    if (!this.canEdit(index)) return;
    const side = this.sides[index];
    side.accepted = value ? { self: side.rev, other: this.sides[1 - index].rev } : null;
    this.#broadcast(index);
    this.#checkReady();
  }

  #changed(index) {
    const side = this.sides[index];
    side.rev += 1;
    side.accepted = null;
    this.error = null;
    this.#broadcast(index);
  }

  #broadcast(index) {
    if (this.local) return;
    const { offer, rev, accepted } = this.sides[index];
    socket.send("update", this.partnerUserIds, { tradeId: this.id, side: index, offer, rev, accepted });
  }

  /* -------------------------------------------- */
  /*  Remote updates                              */
  /* -------------------------------------------- */

  /** Apply the partner's side as they broadcast it. */
  applyRemote(msg) {
    const side = this.sides[msg.side];
    if (!side || side.userId !== msg.from || side.userId === game.user.id) return false;
    if (msg.rev < side.rev) return false;
    side.offer = msg.offer;
    side.rev = msg.rev;
    side.accepted = msg.accepted ?? null;
    if (this.status === "open") this.error = null;
    this.#checkReady();
    return true;
  }

  /* -------------------------------------------- */
  /*  Completion                                  */
  /* -------------------------------------------- */

  /** Player-to-player: when both acceptances line up, ask the GM to carry it out. */
  #checkReady() {
    if (this.local || this.status !== "open" || !this.ready) return;
    const gm = game.users.activeGM;
    if (!gm) {
      this.fail(game.i18n.localize("TRADEX.Error.NoGM"));
      return;
    }
    this.status = "committing";
    socket.send("commit", gm.id, { tradeId: this.id, sides: this.serialize() });
    this.#commitTimer = setTimeout(() => {
      if (this.status === "committing") this.fail(game.i18n.localize("TRADEX.Error.GMTimeout"));
    }, COMMIT_TIMEOUT);
    this.app?.refresh();
  }

  /** Mark the attempt as in progress (local trades). */
  beginLocalCommit() {
    this.status = "committing";
    this.app?.refresh();
  }

  /** The trade went through. */
  finish() {
    clearTimeout(this.#commitTimer);
    this.status = "done";
    Trade.#all.delete(this.id);
    this.app?.close({ fromTrade: true });
  }

  /** The attempt failed: back to negotiating with our acceptances cleared. */
  fail(reason) {
    clearTimeout(this.#commitTimer);
    if (this.status === "done" || this.status === "cancelled") return;
    this.status = "open";
    this.error = reason ?? null;
    if (reason) ui.notifications.error(reason);
    this.sides.forEach((s, i) => {
      if (s.userId !== game.user.id || !s.accepted) return;
      s.accepted = null;
      this.#broadcast(i);
    });
    this.app?.refresh();
  }

  /**
   * End the trade without completing it.
   * @param {object} [options]
   * @param {boolean} [options.notify=true]  Tell the partner.
   * @param {string}  [options.message]      Shown to this user.
   */
  cancel({ notify = true, message } = {}) {
    if (this.status === "done" || this.status === "cancelled") return;
    clearTimeout(this.#commitTimer);
    this.status = "cancelled";
    Trade.#all.delete(this.id);
    if (notify && !this.local) socket.send("cancel", this.partnerUserIds, { tradeId: this.id });
    if (message) ui.notifications.warn(message);
    this.app?.close({ fromTrade: true });
  }
}

/* -------------------------------------------- */

/** Display data for an offered item. */
export function itemInfo(item, qty) {
  const sys = item.system;
  const weight = typeof sys.weight === "object" ? sys.weight?.value : sys.weight;
  const info = {
    qty,
    name: item.name,
    img: item.img,
    type: item.type,
    price: { value: Number(sys.price?.value) || 0, denomination: sys.price?.denomination ?? "gp" },
    weight: Number(weight) || 0
  };
  if (item.type === "container") {
    const contents = item.actor?.items.filter(i => isInside(i, item)) ?? [];
    info.contents = contents.length;
  }
  return info;
}

/** Whether `item` sits somewhere inside `container` (any depth). */
export function isInside(item, container) {
  const items = item.actor?.items;
  let parentId = item.system.container;
  const seen = new Set();
  while (parentId && !seen.has(parentId)) {
    if (parentId === container.id) return true;
    seen.add(parentId);
    parentId = items?.get(parentId)?.system.container;
  }
  return false;
}

/** Physical, tradeable item. */
export function isTradeable(item) {
  return item && ("quantity" in item.system);
}

/** Actor that can hold coins and items. */
export function canTrade(actor) {
  return !!actor && (actor.system?.currency !== undefined) && !!actor.items;
}
