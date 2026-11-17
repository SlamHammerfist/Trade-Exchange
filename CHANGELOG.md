# Changelog

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
