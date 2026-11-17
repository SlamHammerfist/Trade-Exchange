# Trade Exchange

Trade items and coins between two actors in one shared window, in any game system.

- **Player to player:** each player sees their own inventory on the left and the other player's
  offer on the right, updating live. When both press **Accept Trade**, it goes through. Any change
  to either offer clears both acceptances, so nobody can swap something out at the last second.
- **Two actors you own:** if you own both actors (say, your character and a pack mule, or a GM
  moving gear between any two actors), both sides are editable in one window and
  **Complete Trade** carries it out at once.

## Install

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/SlamHammerfist/Trade-Exchange/releases/latest/download/module.json
```

Then enable it in your world.

## Game systems

The trade window, invitations and the way trades are carried out are the same in every system.
What counts as an item, where coins live and how containers work come from a **system adapter**.

### D&D 5e

Install **[Trade Exchange for D&D 5e](https://github.com/SlamHammerfist/Trade-Exchange-DnD5e)**
alongside this module. It adds coins by denomination, physical items, containers with their
contents, stacking of received consumables and loot, and a Trade button beside the coins on the
inventory tab. Without it, a D&D 5e world falls back to the generic settings below and the GM is
told to install it.

### Any other system

Systems without a companion module use a generic adapter, set up in the module settings:

- *Item quantity field:* where an item keeps its quantity (default `system.quantity`). Only items
  with a number there can be traded, which keeps spells, features and the like out.
- *Currency fields:* each kind of coin as `name=path`, comma-separated, for example
  `gp=system.currency.gp, sp=system.currency.sp`. Leave it empty to trade items only.

There's no stacking or container support in the generic adapter, and the **Trade** entry is in the
actor sheet's header menu.

### Writing an adapter

A companion module (or a world script) adds full support for a system. Extend the generic adapter
and override what your system does differently; see `scripts/systems/generic.mjs` for every
method, and [Trade Exchange for D&D 5e](https://github.com/SlamHammerfist/Trade-Exchange-DnD5e)
for a complete example.

```js
Hooks.once("tradeExchange.ready", api => {
  api.registerSystem("my-system", class extends api.GenericAdapter {
    canTrade(actor) { return actor.type === "character"; }
    get currencies() { return [{ key: "coins", label: "Coins", abbr: "c", rate: 1 }]; }
    get valueUnit() { return "c"; }
    getCurrency(actor) { return { coins: actor.system.wealth ?? 0 }; }
    currencyUpdate(actor, values) { return { "system.wealth": values.coins }; }
  });
});
```

## Starting a trade

Click the **Trade** button on an actor's sheet, then choose a partner:

- *Other players (online):* actors owned by another connected player. That player gets a trade
  request; the window opens for both of you when they accept.
- *Your own actors:* actors you also own. The window opens straight away.

Or from a macro:

```js
const api = game.modules.get("trade-exchange").api;
api.open(actor);              // pick a partner
api.trade(actor, otherActor); // trade with a specific actor
```

Use −/+ or type a number to set quantities; **Shift-click** + or − for all or none.

## How it's carried out

- A player can't change another player's actor, so **player-to-player trades need a GM online**.
  When both players accept, the GM's client checks that both agreed to the same offers and that
  both actors still have everything, then moves the items and coins. Nothing is needed from the GM.
- Items are added to the receiver before they are removed from the giver, so a failure part-way
  never destroys anything.
- If an item is used up or coins are spent while a trade is open, the offer shrinks to match.
- Closing the window cancels the trade for both sides. A player disconnecting cancels it too.

## Settings

- *Trade receipt in chat* (world): Everyone / Traders and GM only / Don't post.
- *Trade button on actor sheets* (per user).
- Other systems: *Item quantity field* and *Currency fields* (world), described above.

## Requirements

Foundry VTT v13–v14. For D&D 5e, also [Trade Exchange for D&D 5e](https://github.com/SlamHammerfist/Trade-Exchange-DnD5e) (tested with dnd5e 6.1.1).
