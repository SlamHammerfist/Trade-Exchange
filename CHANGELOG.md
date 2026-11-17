# Changelog

## 3.0.0 (2026-11-17)
### Changed
- **D&D 5e support moved to its own module, [Trade Exchange for D&D 5e](https://github.com/SlamHammerfist/Trade-Exchange-DnD5e).** D&D 5e worlds need both modules; the GM is told if the companion is missing. The D&D 5e *Hide electrum* setting moved with it.
- Works in any game system. Everything system-specific goes through a system adapter, which companion modules provide.
- The offer summary shows value and weight only when the system provides them.

### Added
- Generic adapter for systems without a companion module: set the item quantity field and the actor's currency fields in the module settings. Coins are optional.
- In systems without an adapter, the Trade button is in the actor sheet's header menu.
- Companion modules register an adapter with `api.registerSystem` during the `tradeExchange.ready` hook.

### Fixed
- In a trade where you control both actors, the panels no longer show your user name under the other actor.
- Items with a quantity of 0 are no longer listed.

## 2.0.0 (2026-11-17)
Rebuilt from scratch.

### Added
- Player-to-player trades: invite another online player's actor; both sides see each other's offer live. The trade goes through when both accept, and any change to either offer clears both acceptances.
- Trades between two actors you own (or any two actors, for a GM) in a single window with both sides editable.
- Items in any quantity, containers with their contents, and coins by denomination.
- Received consumables and loot join an existing matching stack. Received items arrive unequipped and unattuned.
- Offers shrink automatically if an item is used up or coins are spent while the trade is open.
- Chat receipt for completed trades (everyone, traders and GM only, or off).
- Settings: hide electrum, receipt visibility, per-user sheet button.
- The buttons beside the coins on the inventory tab are kept in alphabetical order by name, alongside dnd5e's Manage Currency and other modules' buttons.
- Macro API: `game.modules.get("trade-exchange").api.open(actor)` and `.trade(actor, otherActor)`.
