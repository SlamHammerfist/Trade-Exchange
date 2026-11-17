import { MODULE_ID, TEMPLATES } from "./constants.mjs";
import { canTrade, isInside, isTradeable } from "./trade.mjs";
import { adapter } from "./systems/index.mjs";

/**
 * Carry out a trade. Runs on a client that owns both actors: the active GM for
 * player-to-player trades, or the trading user for a local trade.
 *
 * Everything is checked against the live actors before anything moves.
 * Items are created on the receiving side first, then removed from the giver,
 * then coins are settled, so a failure part-way never destroys anything.
 *
 * @param {{actorUuid: string, userId: string, offer: object}[]} sides
 * @param {object} [options]
 * @param {boolean} [options.checkOwners]  Verify each side's user owns its actor (GM path).
 * @returns {Promise<{ok: true, lines: object[]}|{ok: false, error: string}>}
 */
export async function executeTrade(sides, { checkOwners = false } = {}) {
  const plan = await prepare(sides, { checkOwners });
  if (plan.error) return { ok: false, error: plan.error };

  const sys = adapter();
  const [a, b] = plan.sides;
  try {
    // 1. Receive. Never stack onto an item the receiver is itself giving away.
    await receive(b.actor, a.moves, new Set(b.moves.map(m => m.item.id)));
    await receive(a.actor, b.moves, new Set(a.moves.map(m => m.item.id)));
    // 2. Give.
    await give(a.actor, a.moves);
    await give(b.actor, b.moves);
    // 3. Coins.
    for (const [self, other] of [[a, b], [b, a]]) {
      const held = sys.getCurrency(self.actor);
      const next = {};
      for (const key of new Set([...Object.keys(self.coins), ...Object.keys(other.coins)])) {
        const value = (held[key] ?? 0) - (self.coins[key] ?? 0) + (other.coins[key] ?? 0);
        if (value !== (held[key] ?? 0)) next[key] = value;
      }
      if (!foundry.utils.isEmpty(next)) await self.actor.update(sys.currencyUpdate(self.actor, next));
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Trade failed part-way`, err);
    return { ok: false, error: game.i18n.format("TRADEX.Error.Execution", { message: err.message }) };
  }

  const lines = plan.sides.map((s, i) => ({
    from: s.actor.name,
    to: plan.sides[1 - i].actor.name,
    items: s.moves.map(m => ({ name: m.item.name, qty: m.qty, contents: m.contents })),
    coins: s.coins
  }));
  try {
    await postReceipt(plan.sides, lines);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not post the trade receipt`, err);
  }
  return { ok: true, lines };
}

/* -------------------------------------------- */
/*  Validation                                  */
/* -------------------------------------------- */

async function prepare(sides, { checkOwners }) {
  if (!Array.isArray(sides) || sides.length !== 2) return { error: game.i18n.localize("TRADEX.Error.Invalid") };
  const sys = adapter();
  const coinKeys = new Set(sys.currencies.map(c => c.key));
  const coinLabel = key => sys.currencies.find(c => c.key === key)?.abbr ?? key;
  const out = [];

  for (const side of sides) {
    const actor = await fromUuid(side.actorUuid);
    if (!canTrade(actor)) return { error: game.i18n.localize("TRADEX.Error.ActorMissing") };
    if (checkOwners) {
      const user = game.users.get(side.userId);
      if (!user || !actor.testUserPermission(user, "OWNER")) {
        return { error: game.i18n.format("TRADEX.Error.NotOwner", { actor: actor.name }) };
      }
    }
    if (!actor.isOwner) return { error: game.i18n.format("TRADEX.Error.NotOwner", { actor: actor.name }) };

    // Items. A container takes its contents along, so drop contents offered separately.
    const moves = [];
    for (const [id, info] of Object.entries(side.offer?.items ?? {})) {
      const item = actor.items.get(id);
      const qty = Math.floor(Number(info?.qty) || 0);
      if (!isTradeable(item)) return { error: game.i18n.format("TRADEX.Error.ItemMissing", { item: info?.name ?? id, actor: actor.name }) };
      const held = sys.getQuantity(item);
      if (qty < 1 || qty > held) return { error: game.i18n.format("TRADEX.Error.NotEnoughItem", { item: item.name, actor: actor.name }) };
      moves.push({ item, qty, held });
    }
    const containers = moves.filter(m => sys.isContainer(m.item)).map(m => m.item);
    const kept = moves.filter(m => !containers.some(c => isInside(m.item, c)));
    for (const m of kept) {
      if (sys.isContainer(m.item)) m.contents = actor.items.filter(i => isInside(i, m.item)).length;
    }

    // Coins.
    const held = sys.getCurrency(actor);
    const coins = {};
    for (const [key, raw] of Object.entries(side.offer?.currency ?? {})) {
      const value = Math.floor(Number(raw) || 0);
      if (value <= 0) continue;
      if (!coinKeys.has(key)) return { error: game.i18n.localize("TRADEX.Error.Invalid") };
      if (value > (held[key] ?? 0)) {
        return { error: game.i18n.format("TRADEX.Error.NotEnoughCoin", { actor: actor.name, denom: coinLabel(key) }) };
      }
      coins[key] = value;
    }
    out.push({ actor, moves: kept, coins });
  }

  if (out[0].actor === out[1].actor) return { error: game.i18n.localize("TRADEX.Error.SameActor") };
  if (out.every(s => !s.moves.length && foundry.utils.isEmpty(s.coins))) {
    return { error: game.i18n.localize("TRADEX.Error.Empty") };
  }
  return { sides: out };
}

/* -------------------------------------------- */
/*  Moving items                                */
/* -------------------------------------------- */

async function receive(actor, moves, exclude) {
  const sys = adapter();
  const create = [];
  const stack = new Map();
  for (const { item, qty } of moves) {
    if (sys.isContainer(item)) {
      create.push(...await sys.copyWithContents(item));
      continue;
    }
    const existing = sys.findStack(actor, item, exclude);
    if (existing) {
      stack.set(existing.id, (stack.get(existing.id) ?? sys.getQuantity(existing)) + qty);
      continue;
    }
    create.push(sys.setQuantity(sys.cleanReceived(item), qty));
  }
  if (stack.size) {
    const updates = [...stack].map(([id, q]) => sys.quantityUpdate(actor.items.get(id), q));
    await actor.updateEmbeddedDocuments("Item", updates);
  }
  if (create.length) {
    await actor.createEmbeddedDocuments("Item", create, { keepId: true });
  }
}

async function give(actor, moves) {
  const sys = adapter();
  const remove = [];
  const update = [];
  for (const { item, qty, held } of moves) {
    if (qty >= held) remove.push(item.id);
    else update.push(sys.quantityUpdate(item, held - qty));
  }
  if (update.length) await actor.updateEmbeddedDocuments("Item", update);
  if (remove.length) await actor.deleteEmbeddedDocuments("Item", remove, sys.deleteOptions);
}

/* -------------------------------------------- */
/*  Receipt                                     */
/* -------------------------------------------- */

async function postReceipt(sides, lines) {
  const mode = game.settings.get(MODULE_ID, "receipt");
  if (mode === "off") return;
  const currencies = adapter().currencies;
  const coin = key => currencies.find(c => c.key === key) ?? { abbr: key };
  const context = {
    sides: lines.map((l, i) => ({
      img: sides[i].actor.img,
      from: l.from,
      to: l.to,
      items: l.items,
      coins: Object.entries(l.coins).map(([key, value]) => ({ value, label: coin(key).abbr, icon: coin(key).icon })),
      empty: !l.items.length && foundry.utils.isEmpty(l.coins)
    }))
  };
  const render = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  const content = await render(TEMPLATES.receipt, context);
  const data = { content, speaker: { alias: game.i18n.localize("TRADEX.Receipt.Speaker") } };
  if (mode === "private") {
    const users = new Set(game.users.filter(u => u.isGM).map(u => u.id));
    for (const s of sides) {
      for (const u of game.users) if (!u.isGM && s.actor.testUserPermission(u, "OWNER")) users.add(u.id);
    }
    data.whisper = [...users];
  }
  await ChatMessage.implementation.create(data);
}
