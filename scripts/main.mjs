import { MODULE_ID, TEMPLATES } from "./constants.mjs";
import { Trade, canTrade } from "./trade.mjs";
import { TradeApp } from "./app.mjs";
import { openTradeFor, registerSocket, startTrade } from "./session.mjs";
import { COMPANIONS, GenericAdapter, adapter, hasSystemAdapter, initAdapters, registerSystem } from "./systems/index.mjs";

/* -------------------------------------------------------------------------- */
/*  Init                                                                       */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "receipt", {
    name: "TRADEX.Settings.Receipt.Name",
    hint: "TRADEX.Settings.Receipt.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      public: "TRADEX.Settings.Receipt.Public",
      private: "TRADEX.Settings.Receipt.Private",
      off: "TRADEX.Settings.Receipt.Off"
    },
    default: "public"
  });

  game.settings.register(MODULE_ID, "sheetButton", {
    name: "TRADEX.Settings.SheetButton.Name",
    hint: "TRADEX.Settings.SheetButton.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  const load = foundry.applications.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  load(Object.values(TEMPLATES));

  const api = game.modules.get(MODULE_ID).api = {
    /** Pick a partner for this actor, then trade. */
    open: openTradeFor,
    /** Trade between two specific actors (invites the partner's player if needed). */
    trade: startTrade,
    /** Open trades on this client. */
    get trades() { return Trade.all; },
    Trade,
    TradeApp,
    /** The adapter for the current game system. */
    get adapter() { return adapter(); },
    /** Add an adapter for a game system. Call it from the `tradeExchange.ready` hook. */
    registerSystem,
    /** Base class for adapters; also the fallback for systems without one. */
    GenericAdapter
  };

  // Companion modules register their system adapters here.
  initAdapters(api);
  registerSheetButtons();
});

Hooks.once("ready", () => {
  registerSocket();
  // A system with a known companion module that isn't active falls back to the generic adapter: say so.
  const companion = COMPANIONS[game.system.id];
  if (game.user.isGM && companion && !hasSystemAdapter()) {
    ui.notifications.warn(game.i18n.format("TRADEX.CompanionMissing", { title: companion.title, system: game.system.title }), { permanent: true });
  }
});

/* -------------------------------------------------------------------------- */
/*  Sheet button                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Systems whose adapter names a spot on the sheet get an inline button there
 * (e.g. beside the coins in D&D 5e). Everything else gets a Trade entry in the sheet's
 * header controls.
 */
function registerSheetButtons() {
  const spot = adapter().sheetButton;
  if (spot) {
    for (const hook of spot.hooks) Hooks.on(hook, (sheet, html) => injectInline(sheet, html, spot));
    return;
  }

  // ApplicationV2 sheets: an entry in the header controls menu.
  Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
    if (!wantsButton(sheet.actor) || controls.some(c => c.action === "tradeExchange")) return;
    const control = { action: "tradeExchange", icon: "fa-solid fa-handshake", label: "TRADEX.SheetButton", visible: true };
    // v14 calls onClick directly; giving it an action handler too would open the picker twice.
    if ((game.release?.generation ?? 13) >= 14) control.onClick = () => openTradeFor(sheet.actor);
    else {
      sheet.options.actions ??= {};
      sheet.options.actions.tradeExchange ??= () => openTradeFor(sheet.actor);
    }
    controls.unshift(control);
  });

  // Application (v1) sheets: a header button.
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!wantsButton(sheet.actor) || buttons.some(b => b.class === "tx-open")) return;
    buttons.unshift({
      label: "TRADEX.SheetButton",
      class: "tx-open",
      icon: "fa-solid fa-handshake",
      onclick: () => openTradeFor(sheet.actor)
    });
  });
}

function wantsButton(actor) {
  return game.settings.get(MODULE_ID, "sheetButton") && !!actor?.isOwner && canTrade(actor);
}

function injectInline(sheet, html, spot) {
  const actor = sheet.actor;
  if (!wantsButton(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? sheet.element;
  if (!root) return;
  for (const target of spot.targets(root)) {
    if (target.querySelector(".tx-open")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item-action unbutton always-interactive tx-open";
    button.setAttribute("aria-label", game.i18n.localize("TRADEX.SheetButton"));
    button.innerHTML = '<i class="fa-solid fa-handshake" inert></i>';
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openTradeFor(actor);
    });
    target.prepend(button);
    if (spot.sort) sortButtons(target);
  }
}

/**
 * Put every button in the row (the system's own and any module's) in
 * alphabetical order by name, ahead of everything else. Other modules that add
 * a button there do the same, so the result doesn't depend on which ran last.
 */
function sortButtons(row) {
  const name = b => b.getAttribute("aria-label") ?? b.textContent.trim();
  const buttons = [...row.querySelectorAll(":scope > button")]
    .sort((a, b) => name(a).localeCompare(name(b), game.i18n.lang));
  const anchor = row.querySelector(":scope > :not(button)");
  for (const button of buttons) row.insertBefore(button, anchor);
}
