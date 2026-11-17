import { INVITE_TIMEOUT, MODULE_ID, esc } from "./constants.mjs";
import { Trade, canTrade } from "./trade.mjs";
import { TradeApp } from "./app.mjs";
import { executeTrade } from "./transfer.mjs";
import * as socket from "./socket.mjs";

const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Starting a trade                            */
/* -------------------------------------------- */

/** Invitations this user sent and is waiting on. tradeId → {sides, timer, target} */
const outgoing = new Map();

/**
 * Who `actor` could trade with, split into actors this user also owns (traded
 * in one window) and actors controlled by other connected players.
 */
export function partnersFor(actor) {
  const mine = [];
  const others = [];
  for (const other of game.actors) {
    if (other === actor || !canTrade(other)) continue;
    if (other.isOwner) {
      // A GM owns everything; keep their list to player characters and player-owned actors.
      if (game.user.isGM && !(other.type === "character" || other.hasPlayerOwner)) continue;
      mine.push({ uuid: other.uuid, name: other.name });
      continue;
    }
    const user = controllerOf(other);
    if (user) others.push({ uuid: other.uuid, name: other.name, userId: user.id, userName: user.name });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
  return { mine: mine.sort(byName), others: others.sort(byName) };
}

/** The connected player who answers for `actor`: its assigned player first, then any owner. */
export function controllerOf(actor) {
  const players = game.users.filter(u => u.active && !u.isGM && u.id !== game.user.id);
  return players.find(u => u.character === actor && actor.testUserPermission(u, "OWNER"))
    ?? players.find(u => actor.testUserPermission(u, "OWNER"))
    ?? null;
}

/** Pick a partner for `actor`, then start the trade. */
export async function openTradeFor(actor) {
  if (!canTrade(actor) || !actor.isOwner) {
    ui.notifications.warn("TRADEX.Error.CannotTrade", { localize: true });
    return null;
  }
  const { mine, others } = partnersFor(actor);
  if (!mine.length && !others.length) {
    ui.notifications.warn("TRADEX.Error.NoPartners", { localize: true });
    return null;
  }

  const option = p => `<option value="${esc(p.uuid)}">${esc(p.name)}${p.userName ? ` (${esc(p.userName)})` : ""}</option>`;
  const content = `
    <p>${esc(game.i18n.format("TRADEX.Pick.Prompt", { name: actor.name }))}</p>
    <div class="form-group">
      <label>${esc(game.i18n.localize("TRADEX.Pick.Partner"))}</label>
      <div class="form-fields">
        <select name="partner" autofocus>
          ${others.length ? `<optgroup label="${esc(game.i18n.localize("TRADEX.Pick.Players"))}">${others.map(option).join("")}</optgroup>` : ""}
          ${mine.length ? `<optgroup label="${esc(game.i18n.localize("TRADEX.Pick.Mine"))}">${mine.map(option).join("")}</optgroup>` : ""}
        </select>
      </div>
    </div>`;

  const uuid = await DialogV2.prompt({
    window: { title: "TRADEX.Pick.Title", icon: "fa-solid fa-handshake" },
    classes: ["tx-dialog"],
    position: { width: 400 },
    content,
    ok: {
      label: "TRADEX.Pick.Start",
      icon: "fa-solid fa-handshake",
      callback: (event, button) => button.form.elements.partner.value
    },
    rejectClose: false
  });
  if (!uuid) return null;
  const partner = fromUuidSync(uuid);
  if (!partner) return null;
  return startTrade(actor, partner);
}

/**
 * Start a trade between two actors. If this user owns both, the window opens at
 * once; otherwise the partner's player gets an invitation.
 */
export async function startTrade(actor, partner) {
  if (!canTrade(actor) || !canTrade(partner) || actor === partner) {
    ui.notifications.warn("TRADEX.Error.CannotTrade", { localize: true });
    return null;
  }
  if (!actor.isOwner) {
    ui.notifications.warn("TRADEX.Error.CannotTrade", { localize: true });
    return null;
  }

  if (partner.isOwner) {
    const trade = new Trade({ sides: [
      { actorUuid: actor.uuid, userId: game.user.id },
      { actorUuid: partner.uuid, userId: game.user.id }
    ] });
    const app = new TradeApp(trade);
    await app.render(true);
    return trade;
  }

  const target = controllerOf(partner);
  if (!target) {
    ui.notifications.warn(game.i18n.format("TRADEX.Error.PartnerOffline", { name: partner.name }));
    return null;
  }
  const tradeId = foundry.utils.randomID();
  const sides = [
    { actorUuid: actor.uuid, userId: game.user.id },
    { actorUuid: partner.uuid, userId: target.id }
  ];
  const timer = setTimeout(() => {
    if (!outgoing.delete(tradeId)) return;
    socket.send("inviteWithdrawn", target.id, { tradeId });
    ui.notifications.warn(game.i18n.format("TRADEX.Invite.NoAnswer", { user: target.name }));
  }, INVITE_TIMEOUT);
  outgoing.set(tradeId, { sides, timer, target: target.id });
  socket.send("invite", target.id, { tradeId, sides });
  ui.notifications.info(game.i18n.format("TRADEX.Invite.Sent", { user: target.name, name: partner.name }));
  return null;
}

/* -------------------------------------------- */
/*  Socket handlers                             */
/* -------------------------------------------- */

function inviteDialogId(tradeId) {
  return `${MODULE_ID}-invite-${tradeId}`;
}

async function onInvite(msg) {
  const { tradeId, sides } = msg;
  const reply = (accepted, reason) => socket.send("inviteReply", msg.from, { tradeId, accepted, reason });
  const from = game.users.get(msg.from);
  const theirs = fromUuidSync(sides?.[0]?.actorUuid);
  const ours = fromUuidSync(sides?.[1]?.actorUuid);
  if (!from || !theirs || !ours || sides[0].userId !== msg.from || sides[1].userId !== game.user.id) return reply(false, "invalid");
  if (!ours.isOwner) return reply(false, "invalid");

  const content = `<p>${game.i18n.format("TRADEX.Invite.Body", {
    user: `<strong>${esc(from.name)}</strong>`,
    theirs: `<strong>${esc(theirs.name)}</strong>`,
    ours: `<strong>${esc(ours.name)}</strong>`
  })}</p>`;

  const accepted = await DialogV2.confirm({
    id: inviteDialogId(tradeId),
    window: { title: "TRADEX.Invite.Title", icon: "fa-solid fa-handshake" },
    classes: ["tx-dialog"],
    position: { width: 400 },
    content,
    yes: { label: "TRADEX.Invite.Accept", icon: "fa-solid fa-check" },
    no: { label: "TRADEX.Invite.Decline", icon: "fa-solid fa-xmark" },
    rejectClose: false
  });
  // The invitation may have been withdrawn while the dialog was open.
  if (withdrawn.delete(tradeId)) return;
  if (!accepted) return reply(false, "declined");

  const trade = new Trade({ id: tradeId, sides });
  reply(true);
  await new TradeApp(trade).render(true);
}

const withdrawn = new Set();

function onInviteWithdrawn(msg) {
  withdrawn.add(msg.tradeId);
  const dialog = foundry.applications.instances.get(inviteDialogId(msg.tradeId));
  if (dialog) {
    dialog.close();
    const from = game.users.get(msg.from);
    ui.notifications.info(game.i18n.format("TRADEX.Invite.Withdrawn", { user: from?.name ?? "?" }));
  }
}

async function onInviteReply(msg) {
  const pending = outgoing.get(msg.tradeId);
  if (!pending || pending.target !== msg.from) {
    // We gave up waiting; let them know if they accepted a dead invitation.
    if (msg.accepted) socket.send("cancel", msg.from, { tradeId: msg.tradeId });
    return;
  }
  clearTimeout(pending.timer);
  outgoing.delete(msg.tradeId);
  const user = game.users.get(msg.from);
  if (!msg.accepted) {
    ui.notifications.info(game.i18n.format("TRADEX.Invite.Declined", { user: user?.name ?? "?" }));
    return;
  }
  const trade = new Trade({ id: msg.tradeId, sides: pending.sides });
  await new TradeApp(trade).render(true);
}

function onUpdate(msg) {
  const trade = Trade.get(msg.tradeId);
  if (!trade || !trade.applyRemote(msg)) return;
  trade.app?.refresh([msg.side]);
}

function onCancel(msg) {
  const trade = Trade.get(msg.tradeId);
  if (!trade || !trade.participantIds.includes(msg.from)) return;
  const user = game.users.get(msg.from);
  trade.cancel({ notify: false, message: game.i18n.format("TRADEX.Cancelled", { user: user?.name ?? "?" }) });
}

function onResult(msg) {
  const trade = Trade.get(msg.tradeId);
  if (!trade || msg.from !== game.users.activeGM?.id) return;
  if (msg.ok) {
    ui.notifications.info("TRADEX.Complete", { localize: true });
    trade.finish();
  } else trade.fail(msg.error);
}

/* -------------------------------------------- */
/*  GM: carrying out player-to-player trades    */
/* -------------------------------------------- */

/** tradeId → { key, from: Set<userId>, timer } */
const commits = new Map();
const finished = new Set();

/** Stable fingerprint of what each side offers, so both players provably agreed to the same thing. */
function fingerprint(sides) {
  return JSON.stringify(sides.map(s => [
    s.actorUuid,
    s.userId,
    Object.entries(s.offer?.items ?? {}).map(([id, i]) => [id, i.qty]).sort(),
    Object.entries(s.offer?.currency ?? {}).filter(([, v]) => v > 0).sort()
  ]));
}

async function onCommit(msg) {
  if (game.users.activeGM !== game.user) return;
  const { tradeId, sides } = msg;
  if (!Array.isArray(sides) || sides.length !== 2) return;
  const users = [...new Set(sides.map(s => s.userId))];
  if (!users.includes(msg.from) || finished.has(tradeId)) return;

  const key = fingerprint(sides);
  let entry = commits.get(tradeId);
  if (!entry || entry.key !== key) {
    if (entry) clearTimeout(entry.timer);
    entry = { key, from: new Set(), timer: null };
    entry.timer = setTimeout(() => {
      if (commits.get(tradeId) !== entry) return;
      commits.delete(tradeId);
      socket.send("result", users, { tradeId, ok: false, error: game.i18n.localize("TRADEX.Error.Mismatch") });
    }, 10_000);
    commits.set(tradeId, entry);
  }
  entry.from.add(msg.from);
  if (!users.every(u => entry.from.has(u))) return;

  clearTimeout(entry.timer);
  commits.delete(tradeId);
  finished.add(tradeId);
  const result = await executeTrade(sides, { checkOwners: true });
  if (!result.ok) finished.delete(tradeId);
  socket.send("result", users, { tradeId, ok: result.ok, error: result.error });
}

/* -------------------------------------------- */

/** A player disconnecting ends their trades and any invitation waiting on them. */
function onUserConnected(user, connected) {
  if (connected) return;
  for (const trade of Trade.all) {
    if (trade.partnerUserIds.includes(user.id)) {
      trade.cancel({ notify: false, message: game.i18n.format("TRADEX.Disconnected", { user: user.name }) });
    }
  }
  for (const [tradeId, pending] of outgoing) {
    if (pending.target !== user.id) continue;
    clearTimeout(pending.timer);
    outgoing.delete(tradeId);
  }
}

export function registerSocket() {
  socket.on("invite", onInvite);
  socket.on("inviteWithdrawn", onInviteWithdrawn);
  socket.on("inviteReply", onInviteReply);
  socket.on("update", onUpdate);
  socket.on("cancel", onCancel);
  socket.on("commit", onCommit);
  socket.on("result", onResult);
  socket.listen();
  Hooks.on("userConnected", onUserConnected);
}
