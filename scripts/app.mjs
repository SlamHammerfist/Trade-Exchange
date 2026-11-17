import { MODULE_ID, TEMPLATES, TYPE_ORDER, denominations } from "./constants.mjs";
import { isInside, isTradeable } from "./trade.mjs";
import { executeTrade } from "./transfer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The trade window. Two side panels (this user's side on the left) and a footer
 * with the acceptance state. Remote changes re-render only the partner's panel
 * and the footer, so typing in your own panel is never interrupted.
 */
export class TradeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {import("./trade.mjs").Trade} trade */
  constructor(trade, options = {}) {
    super({ id: `${MODULE_ID}-${trade.id}`, ...options });
    this.trade = trade;
    trade.app = this;
    /** Side index shown in the left panel. */
    this.leftIndex = trade.local ? 0 : Math.max(0, trade.sides.findIndex(s => s.userId === game.user.id));
    this.#filters = { left: "", right: "" };
    this.#hooks = [];
  }

  #filters;
  #hooks;

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "tx-window"],
    tag: "div",
    window: { icon: "fa-solid fa-handshake", resizable: true },
    position: { width: 860, height: 680 },
    actions: {
      step: TradeApp.#onStep,
      accept: TradeApp.#onAccept,
      complete: TradeApp.#onComplete,
      cancel: TradeApp.#onCancel,
      openItem: TradeApp.#onOpenItem
    }
  };

  static PARTS = {
    left: { template: TEMPLATES.side, scrollable: [".tx-items"] },
    right: { template: TEMPLATES.side, scrollable: [".tx-items"] },
    footer: { template: TEMPLATES.footer }
  };

  get title() {
    const [a, b] = [0, 1].map(i => this.trade.actor(i)?.name ?? "?");
    return game.i18n.format("TRADEX.Title", { a, b });
  }

  partFor(index) {
    return index === this.leftIndex ? "left" : "right";
  }

  indexFor(partId) {
    return partId === "left" ? this.leftIndex : 1 - this.leftIndex;
  }

  /** Re-render panels and footer. */
  refresh(indexes = [0, 1]) {
    if (!this.rendered) return;
    const parts = [...new Set(indexes.map(i => this.partFor(i))), "footer"];
    this.render({ parts });
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "footer") context.footer = this.#footerContext();
    else context.side = this.#sideContext(this.indexFor(partId));
    return context;
  }

  #sideContext(index) {
    const trade = this.trade;
    const side = trade.sides[index];
    const actor = trade.actor(index);
    const editable = trade.canEdit(index);
    const offer = side.offer;
    const user = game.users.get(side.userId);

    const coins = denominations().map(key => {
      const cfg = CONFIG.DND5E.currencies[key];
      return {
        key,
        label: game.i18n.localize(cfg.label),
        icon: cfg.icon,
        held: Number(actor?.system.currency?.[key]) || 0,
        offered: offer.currency[key] ?? 0
      };
    });

    const groups = editable && actor
      ? this.#inventoryGroups(actor, offer)
      : this.#offerGroups(offer);

    return {
      index,
      editable,
      name: actor?.name ?? game.i18n.localize("TRADEX.UnknownActor"),
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      userName: user?.name ?? "",
      coins,
      groups,
      hasItems: groups.length > 0,
      total: offerSummary(offer),
      filter: this.#filters[this.partFor(index)]
    };
  }

  /** Whole inventory, grouped by type, containers followed by their contents. */
  #inventoryGroups(actor, offer) {
    const items = actor.items.filter(isTradeable);
    const ids = new Set(items.map(i => i.id));
    const offeredContainers = items.filter(i => i.type === "container" && offer.items[i.id]);
    const children = new Map();
    const top = [];
    for (const item of items) {
      const parent = item.system.container;
      if (parent && ids.has(parent)) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(item);
      } else top.push(item);
    }
    const sort = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, game.i18n.lang);

    const row = (item, depth, out) => {
      const enclosed = offeredContainers.find(c => c !== item && isInside(item, c));
      const qty = offer.items[item.id]?.qty ?? 0;
      const kids = (children.get(item.id) ?? []).sort(sort);
      out.push({
        id: item.id,
        name: item.name,
        search: item.name.toLowerCase(),
        img: item.img,
        held: item.system.quantity ?? 1,
        qty,
        offered: qty > 0 && !enclosed,
        locked: !!enclosed,
        note: enclosed
          ? game.i18n.format("TRADEX.WithContainer", { container: enclosed.name })
          : (item.type === "container" && kids.length ? game.i18n.format("TRADEX.Contains", { n: actor.items.filter(i => isInside(i, item)).length }) : ""),
        depth
      });
      for (const kid of kids) row(kid, depth + 1, out);
    };

    const byType = new Map();
    for (const item of top.sort(sort)) {
      if (!byType.has(item.type)) byType.set(item.type, []);
      row(item, 0, byType.get(item.type));
    }
    return orderGroups([...byType].map(([type, rows]) => ({ type, label: typeLabel(type), items: rows })));
  }

  /** Read-only: what the other side offers, from the display data they sent. */
  #offerGroups(offer) {
    const byType = new Map();
    for (const [id, info] of Object.entries(offer.items)) {
      if (!byType.has(info.type)) byType.set(info.type, []);
      byType.get(info.type).push({
        id,
        name: info.name,
        img: info.img,
        qty: info.qty,
        offered: true,
        note: info.contents ? game.i18n.format("TRADEX.Contains", { n: info.contents }) : "",
        depth: 0
      });
    }
    for (const rows of byType.values()) rows.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    return orderGroups([...byType].map(([type, rows]) => ({ type, label: typeLabel(type), items: rows })));
  }

  #footerContext() {
    const trade = this.trade;
    const order = [this.leftIndex, 1 - this.leftIndex];
    const statuses = order.map(i => {
      const accepted = trade.isAccepted(i);
      return {
        name: trade.actor(i)?.name ?? "?",
        accepted,
        label: game.i18n.localize(accepted ? "TRADEX.Status.Accepted" : "TRADEX.Status.Reviewing")
      };
    });
    const mine = order.find(i => trade.sides[i].userId === game.user.id) ?? this.leftIndex;
    const committing = trade.status === "committing";
    return {
      local: trade.local,
      statuses: trade.local ? [] : statuses,
      committing,
      myAccepted: trade.isAccepted(mine),
      myIndex: mine,
      canAct: trade.status === "open",
      canComplete: trade.status === "open" && !trade.bothEmpty,
      canAccept: trade.status === "open" && !trade.bothEmpty,
      noGM: !trade.local && !game.users.activeGM,
      error: trade.error
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", this.#onChange.bind(this));
    this.element.addEventListener("input", this.#onInput.bind(this));
    this.element.addEventListener("focusin", ev => {
      if (ev.target.matches?.("input[type=number]")) ev.target.select();
    });
    this.#watchActors();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const part of ["left", "right"]) this.#applyFilter(part);
  }

  /** Keep editable panels in step with inventory changes made elsewhere. */
  #watchActors() {
    const handler = doc => {
      const actor = doc instanceof Actor ? doc : doc.parent;
      if (!(actor instanceof Actor)) return;
      if (this.trade.status !== "open") return;
      this.trade.sides.forEach((s, i) => {
        if (s.actorUuid !== actor.uuid) return;
        this.trade.reconcile(i);
        this.#debouncedRefresh(i);
      });
    };
    for (const hook of ["createItem", "updateItem", "deleteItem", "updateActor"]) {
      this.#hooks.push([hook, Hooks.on(hook, handler)]);
    }
  }

  #pending = new Set();
  #refreshTimer = null;
  #debouncedRefresh(index) {
    this.#pending.add(index);
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      const idx = [...this.#pending];
      this.#pending.clear();
      this.refresh(idx);
    }, 50);
  }

  async _onClose(options) {
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
    clearTimeout(this.#refreshTimer);
    if (this.trade.app === this) this.trade.app = null;
    // Closing the window walks away from the trade.
    if (!options?.fromTrade) this.trade.cancel();
    return super._onClose?.(options);
  }

  /* -------------------------------------------- */
  /*  Editing                                     */
  /* -------------------------------------------- */

  #sideOf(el) {
    const sideEl = el.closest(".tx-side");
    return sideEl ? Number(sideEl.dataset.side) : null;
  }

  #setItem(index, itemId, qty) {
    const item = this.trade.actor(index)?.items.get(itemId);
    if (!item) return;
    const wasOffered = !!this.trade.sides[index].offer.items[itemId];
    if (!this.trade.setItem(index, item, qty)) {
      this.#syncRow(index, itemId);
      return;
    }
    // Offering or withdrawing a container locks/unlocks its contents: redraw the panel.
    const toggled = wasOffered !== !!this.trade.sides[index].offer.items[itemId];
    if (item.type === "container" && toggled) this.refresh([index]);
    else {
      this.#syncRow(index, itemId);
      this.#syncTotal(index);
      this.render({ parts: ["footer"] });
    }
  }

  /** Update one row in place (keeps focus in the panel). */
  #syncRow(index, itemId) {
    const row = this.element.querySelector(`.tx-side[data-side="${index}"] .tx-item[data-item-id="${itemId}"]`);
    if (!row) return;
    const qty = this.trade.sides[index].offer.items[itemId]?.qty ?? 0;
    row.classList.toggle("offered", qty > 0);
    const input = row.querySelector(".tx-qty-input");
    if (input) input.value = qty;
  }

  #syncTotal(index) {
    const el = this.element.querySelector(`.tx-side[data-side="${index}"] .tx-side-total`);
    if (el) el.textContent = offerSummary(this.trade.sides[index].offer);
  }

  #onChange(event) {
    const el = event.target;
    const index = this.#sideOf(el);
    if (index === null || !this.trade.canEdit(index)) return;

    if (el.matches(".tx-qty-input")) {
      this.#setItem(index, el.closest(".tx-item").dataset.itemId, el.value);
    }
    else if (el.matches(".tx-coin-input")) {
      const denom = el.dataset.denom;
      const held = Number(this.trade.actor(index)?.system.currency?.[denom]) || 0;
      this.trade.setCoin(index, denom, el.value, held);
      el.value = this.trade.sides[index].offer.currency[denom] ?? 0;
      el.closest(".tx-coin")?.classList.toggle("offered", Number(el.value) > 0);
      this.#syncTotal(index);
      this.render({ parts: ["footer"] });
    }
  }

  #onInput(event) {
    const el = event.target;
    if (!el.matches(".tx-filter")) return;
    const part = el.closest("[data-application-part]")?.dataset.applicationPart;
    if (!part) return;
    this.#filters[part] = el.value;
    this.#applyFilter(part);
  }

  #applyFilter(part) {
    const root = this.element?.querySelector(`[data-application-part="${part}"]`);
    if (!root) return;
    const term = (this.#filters[part] ?? "").trim().toLowerCase();
    for (const group of root.querySelectorAll(".tx-group")) {
      let visible = 0;
      for (const row of group.querySelectorAll(".tx-item")) {
        const show = !term || row.classList.contains("offered") || (row.dataset.search ?? "").includes(term);
        row.hidden = !show;
        if (show) visible++;
      }
      group.hidden = visible === 0;
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** −/+ buttons. Shift: all or nothing. */
  static #onStep(event, target) {
    const index = this.#sideOf(target);
    if (index === null || !this.trade.canEdit(index)) return;
    const row = target.closest(".tx-item");
    const itemId = row.dataset.itemId;
    const item = this.trade.actor(index)?.items.get(itemId);
    if (!item) return;
    const current = this.trade.sides[index].offer.items[itemId]?.qty ?? 0;
    const delta = Number(target.dataset.delta);
    const held = item.system.quantity ?? 1;
    const next = event.shiftKey ? (delta > 0 ? held : 0) : current + delta;
    this.#setItem(index, itemId, next);
  }

  static #onAccept(event, target) {
    const index = Number(target.dataset.side);
    const value = target.dataset.value === "1";
    if (value && !game.users.activeGM) {
      ui.notifications.warn("TRADEX.Error.NoGM", { localize: true });
      return;
    }
    this.trade.accept(index, value);
    this.render({ parts: ["footer"] });
  }

  /** Local trade: both actors are ours, so carry it out right here. */
  static async #onComplete() {
    const trade = this.trade;
    if (!trade.local || trade.status !== "open") return;
    trade.beginLocalCommit();
    const result = await executeTrade(trade.serialize());
    if (result.ok) {
      ui.notifications.info("TRADEX.Complete", { localize: true });
      trade.finish();
    } else trade.fail(result.error);
  }

  static #onCancel() {
    this.close();
  }

  static #onOpenItem(event, target) {
    const index = this.#sideOf(target);
    const itemId = target.closest(".tx-item")?.dataset.itemId;
    const item = index === null ? null : this.trade.actor(index)?.items.get(itemId);
    if (item?.testUserPermission(game.user, "OBSERVER")) item.sheet.render(true);
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

function typeLabel(type) {
  const plural = `TYPES.Item.${type}Pl`;
  if (game.i18n.has(plural)) return game.i18n.localize(plural);
  return game.i18n.localize(CONFIG.Item.typeLabels?.[type] ?? type);
}

function orderGroups(groups) {
  const rank = t => {
    const i = TYPE_ORDER.indexOf(t);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return groups.sort((a, b) => (rank(a.type) - rank(b.type)) || a.label.localeCompare(b.label, game.i18n.lang));
}

/** "3 items · ≈ 12.5 gp · 14 lb" for an offer. */
export function offerSummary(offer) {
  const entries = Object.values(offer.items);
  const count = entries.reduce((n, i) => n + i.qty, 0);
  const rates = CONFIG.DND5E.currencies;
  const gp = entries.reduce((sum, i) => {
    const rate = rates[i.price?.denomination]?.conversion || 1;
    return sum + ((i.price?.value || 0) * i.qty) / rate;
  }, 0) + Object.entries(offer.currency).reduce((sum, [d, v]) => sum + (v || 0) / (rates[d]?.conversion || 1), 0);
  const weight = entries.reduce((sum, i) => sum + (i.weight || 0) * i.qty, 0);
  let unit = "lb";
  try { if (game.settings.get("dnd5e", "metricWeightUnits")) unit = "kg"; } catch {}
  const round = n => Math.round(n * 100) / 100;
  return game.i18n.format("TRADEX.Summary", {
    count, value: round(gp).toLocaleString(game.i18n.lang), weight: round(weight).toLocaleString(game.i18n.lang), unit
  });
}
