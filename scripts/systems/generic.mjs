import { MODULE_ID } from "../constants.mjs";

/**
 * Everything the trade core needs to know about a game system.
 *
 * This class is also the fallback for systems with no adapter of their own:
 * items count as tradeable when they have a numeric quantity field (configurable),
 * coins are an optional list of actor fields, and there is no stacking or
 * container support. System adapters extend it and override what they know better.
 */
export class GenericAdapter {
  /** Called once at init, before the adapter is used. Register system-specific settings here. */
  static registerSettings() {
    game.settings.register(MODULE_ID, "genericQuantity", {
      name: "TRADEX.Settings.GenericQuantity.Name",
      hint: "TRADEX.Settings.GenericQuantity.Hint",
      scope: "world",
      config: true,
      type: String,
      default: "system.quantity"
    });
    game.settings.register(MODULE_ID, "genericCurrency", {
      name: "TRADEX.Settings.GenericCurrency.Name",
      hint: "TRADEX.Settings.GenericCurrency.Hint",
      scope: "world",
      config: true,
      type: String,
      default: ""
    });
  }

  /* -------------------------------------------- */
  /*  Actors and coins                            */
  /* -------------------------------------------- */

  /** Whether this actor can take part in a trade. */
  canTrade(actor) {
    return !!actor?.items;
  }

  /**
   * Coin types, in display order.
   * @returns {{key: string, label: string, abbr: string, icon?: string, rate?: number}[]}
   *   `rate` is the worth of one coin in {@link valueUnit}; omit it if unknown.
   */
  get currencies() {
    const raw = game.settings.get(MODULE_ID, "genericCurrency") ?? "";
    return raw.split(",").map(s => s.trim()).filter(Boolean).map(entry => {
      const [label, path] = entry.includes("=") ? entry.split("=").map(s => s.trim()) : [entry.split(".").pop(), entry];
      return { key: path, label, abbr: label };
    }).filter(c => c.key);
  }

  /** Name of the unit item values are summed in (e.g. "gp"), or null to hide values. */
  get valueUnit() {
    return null;
  }

  /** @returns {Record<string, number>} coins the actor holds, by currency key */
  getCurrency(actor) {
    return Object.fromEntries(this.currencies.map(c => [c.key, Number(foundry.utils.getProperty(actor, c.key)) || 0]));
  }

  /** Actor update data that sets coin totals. */
  currencyUpdate(actor, values) {
    return Object.fromEntries(Object.entries(values).map(([key, v]) => [key, v]));
  }

  /* -------------------------------------------- */
  /*  Items                                       */
  /* -------------------------------------------- */

  get quantityPath() {
    return game.settings.get(MODULE_ID, "genericQuantity") || "system.quantity";
  }

  isTradeable(item) {
    const value = foundry.utils.getProperty(item, this.quantityPath);
    return (value !== null) && (value !== undefined) && (value !== "") && Number.isFinite(Number(value));
  }

  getQuantity(item) {
    return Math.max(0, Math.floor(Number(foundry.utils.getProperty(item, this.quantityPath)) || 0));
  }

  /** Set the quantity on item source data. */
  setQuantity(data, qty) {
    foundry.utils.setProperty(data, this.quantityPath, qty);
    return data;
  }

  /** Embedded-document update that sets an item's quantity. */
  quantityUpdate(item, qty) {
    return { _id: item.id, [this.quantityPath]: qty };
  }

  /** Worth of one unit of the item in {@link valueUnit}, or null. */
  itemValue(item) {
    return null;
  }

  /** Weight of one unit, or null. */
  itemWeight(item) {
    return null;
  }

  /** Unit label for weights, or null to hide weight. */
  get weightUnit() {
    return null;
  }

  /** Grouping label for an item type. */
  typeLabel(type) {
    return game.i18n.localize(CONFIG.Item.typeLabels?.[type] ?? type);
  }

  /** Item types listed first, in this order. */
  get typeOrder() {
    return [];
  }

  /* -------------------------------------------- */
  /*  Containers                                  */
  /* -------------------------------------------- */

  /** Id of the container item holding this item, or null. */
  containerId(item) {
    return null;
  }

  isContainer(item) {
    return false;
  }

  /* -------------------------------------------- */
  /*  Moving items                                */
  /* -------------------------------------------- */

  /** Item source data cleaned up for its new owner. */
  cleanReceived(source) {
    const data = source instanceof foundry.abstract.Document ? source.toObject() : foundry.utils.deepClone(source);
    delete data._id;
    delete data.sort;
    delete data.ownership;
    return data;
  }

  /**
   * Source data for a container and everything inside it, with fresh ids and
   * container links already pointing at the new copies.
   * @returns {Promise<object[]>}
   */
  async copyWithContents(item) {
    const data = this.cleanReceived(item);
    data._id = foundry.utils.randomID();
    return [data];
  }

  /** Existing item on `actor` that a received `item` should be added to, or null. */
  findStack(actor, item, exclude) {
    return null;
  }

  /** Options passed when deleting given-away items (e.g. to take container contents along). */
  get deleteOptions() {
    return {};
  }

  /* -------------------------------------------- */
  /*  Sheet integration                           */
  /* -------------------------------------------- */

  /**
   * Inline sheet button: render hooks to listen to, and where to put the button.
   * Return null to fall back to the sheet's header menu.
   * @returns {{hooks: string[], targets: (root: HTMLElement) => HTMLElement[], sort?: boolean}|null}
   */
  get sheetButton() {
    return null;
  }
}
