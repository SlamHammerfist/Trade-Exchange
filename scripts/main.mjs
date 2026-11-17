import { MODULE_ID, TEMPLATES } from "./constants.mjs";
import { Trade, canTrade } from "./trade.mjs";
import { TradeApp } from "./app.mjs";
import { openTradeFor, registerSocket, startTrade } from "./session.mjs";

/* -------------------------------------------------------------------------- */
/*  Init                                                                       */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "hideElectrum", {
    name: "TRADEX.Settings.HideElectrum.Name",
    hint: "TRADEX.Settings.HideElectrum.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

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

  game.modules.get(MODULE_ID).api = {
    /** Pick a partner for this actor, then trade. */
    open: openTradeFor,
    /** Trade between two specific actors (invites the partner's player if needed). */
    trade: startTrade,
    /** Open trades on this client. */
    get trades() { return Trade.all; },
    Trade,
    TradeApp
  };
});

Hooks.once("ready", () => {
  registerSocket();
});

/* -------------------------------------------------------------------------- */
/*  Sheet button (next to the coins on the inventory tab)                      */
/* -------------------------------------------------------------------------- */

Hooks.on("renderBaseActorSheet", (sheet, html) => {
  if (!game.settings.get(MODULE_ID, "sheetButton")) return;
  const actor = sheet.actor;
  if (!actor?.isOwner || !canTrade(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? sheet.element;
  for (const section of root?.querySelectorAll("section.currency") ?? []) {
    if (section.querySelector(".tx-open")) continue;
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
    section.prepend(button);
    sortCurrencyButtons(section);
  }
});

/**
 * Put every button in the coin row (dnd5e's own and any module's) in
 * alphabetical order by name, ahead of the coin values. Each module that adds a
 * button does the same, so the result doesn't depend on which one ran last.
 */
function sortCurrencyButtons(section) {
  const name = b => b.getAttribute("aria-label") ?? b.textContent.trim();
  const buttons = [...section.querySelectorAll(":scope > button")]
    .sort((a, b) => name(a).localeCompare(name(b), game.i18n.lang));
  const anchor = section.querySelector(":scope > :not(button)");
  for (const button of buttons) section.insertBefore(button, anchor);
}
