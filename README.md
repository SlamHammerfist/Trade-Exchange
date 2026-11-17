# Trade Exchange

Trade items and coins between two actors in one shared window, for D&D 5e.

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

## Starting a trade

Click the **handshake** button beside the coins on an actor's inventory tab, then choose a partner:

- *Other players (online):* actors owned by another connected player. That player gets a trade
  request; the window opens for both of you when they accept.
- *Your own actors:* actors you also own. The window opens straight away.

Or from a macro:

```js
const api = game.modules.get("trade-exchange").api;
api.open(actor);              // pick a partner
api.trade(actor, otherActor); // trade with a specific actor
```

## What can be traded

- Any physical item (weapons, equipment, consumables, tools, containers, loot), in any quantity
  up to what the actor holds. Use −/+ or type a number; **Shift-click** + or − for all or none.
- **Containers go with everything inside them.** Their contents are shown indented under them.
- Coins, by denomination, up to what the actor holds. No change-making: you offer the coins you
  actually have.

Received items are unequipped and unattuned. Consumables and loot join an existing stack of the
same thing (same name, same source, same uses spent) instead of making a duplicate.

## How it's carried out

- A player can't change another player's actor, so **player-to-player trades need a GM online**.
  When both players accept, the GM's client checks that both agreed to the same offers and that
  both actors still have everything, then moves the items and coins. Nothing is needed from the GM.
- Items are added to the receiver before they are removed from the giver, so a failure part-way
  never destroys anything.
- If an item is used up or coins are spent while a trade is open, the offer shrinks to match.
- Closing the window cancels the trade for both sides. A player disconnecting cancels it too.

## Settings

- *Hide electrum* (world): leave ep out of trades.
- *Trade receipt in chat* (world): Everyone / Traders and GM only / Don't post.
- *Trade button on actor sheets* (per user).

## Requirements

Foundry VTT v13–v14, dnd5e 5.0+ (tested against dnd5e 6.1.1). No other modules needed.
