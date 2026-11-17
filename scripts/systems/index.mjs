import { GenericAdapter } from "./generic.mjs";

/**
 * System adapters by game system id. Companion modules (e.g. Trade Exchange for
 * D&D 5e) add theirs during the `tradeExchange.ready` hook, fired at init:
 *
 *   Hooks.once("tradeExchange.ready", api => {
 *     api.registerSystem("my-system", class extends api.GenericAdapter { ... });
 *   });
 *
 * Systems without one use the generic adapter, configured in the module settings.
 */
const registry = new Map();
let active = null;

/** Companion modules known to add an adapter, by system id. */
export const COMPANIONS = {
  dnd5e: { id: "trade-exchange-dnd5e", title: "Trade Exchange for D&D 5e" }
};

export function registerSystem(systemId, AdapterClass) {
  if (active) {
    console.warn(`trade-exchange | Adapter for "${systemId}" registered too late; register it during the tradeExchange.ready hook.`);
  }
  registry.set(systemId, AdapterClass);
}

/** The adapter class for the current system. */
export function adapterClass() {
  return registry.get(game.system.id) ?? GenericAdapter;
}

/** Whether the current system has its own adapter (vs. the generic one). */
export function hasSystemAdapter() {
  return registry.has(game.system.id);
}

/** Collect adapters from companion modules and register the chosen adapter's settings. Called at init. */
export function initAdapters(api) {
  Hooks.callAll("tradeExchange.ready", api);
  adapterClass().registerSettings?.();
}

/** The adapter in use. */
export function adapter() {
  return active ??= new (adapterClass())();
}

export { GenericAdapter };
