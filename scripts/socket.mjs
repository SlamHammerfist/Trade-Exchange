import { SOCKET } from "./constants.mjs";

/**
 * Thin addressed-message layer over the module socket.
 * Every message names its recipients (`to`, user ids) and its sender (`from`).
 * Messages addressed to this user are also delivered locally, so callers never
 * need to special-case "the other side is me".
 */

const handlers = new Map();

export function on(type, fn) {
  handlers.set(type, fn);
}

export function send(type, to, data = {}) {
  const recipients = [...new Set(Array.isArray(to) ? to : [to])].filter(Boolean);
  if (!recipients.length) return;
  const msg = { ...data, type, to: recipients, from: game.user.id };
  if (recipients.some(id => id !== game.user.id)) game.socket.emit(SOCKET, msg);
  if (recipients.includes(game.user.id)) queueMicrotask(() => dispatch(msg));
}

function dispatch(msg) {
  try {
    const result = handlers.get(msg.type)?.(msg);
    if (result instanceof Promise) result.catch(err => console.error(`${SOCKET} | ${msg.type}`, err));
  } catch (err) {
    console.error(`${SOCKET} | ${msg.type}`, err);
  }
}

export function listen() {
  game.socket.on(SOCKET, msg => {
    if (!Array.isArray(msg?.to) || !msg.to.includes(game.user.id)) return;
    dispatch(msg);
  });
}
