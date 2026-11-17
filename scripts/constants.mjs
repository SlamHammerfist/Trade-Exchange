export const MODULE_ID = "trade-exchange";
export const MODULE_PATH = `modules/${MODULE_ID}`;
export const SOCKET = `module.${MODULE_ID}`;

export const TEMPLATES = {
  side: `${MODULE_PATH}/templates/side.hbs`,
  footer: `${MODULE_PATH}/templates/footer.hbs`,
  receipt: `${MODULE_PATH}/templates/receipt.hbs`
};

/** How long the initiator waits for an answer to an invitation. */
export const INVITE_TIMEOUT = 120_000;

/** How long a client waits for the GM to finish a trade. */
export const COMMIT_TIMEOUT = 30_000;

/** Escape text for HTML built in code. */
export function esc(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
