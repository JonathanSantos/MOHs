import { byId } from "./dom.js";

const RECONNECT_MS = 1500;

/** WebSocket to the Basecamp that reconnects on its own and reports its status in the top bar. */
export class Connection {
  #key;
  #onMessage;
  #socket = null;

  constructor(key, onMessage) {
    this.#key = key;
    this.#onMessage = onMessage;
  }

  open() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws?key=${encodeURIComponent(this.#key)}`);
    this.#socket = socket;
    this.#status("conectando…", "wait");
    socket.onopen = () => this.#status("ao vivo", "on");
    socket.onmessage = (event) => this.#onMessage(JSON.parse(event.data));
    socket.onclose = () => {
      if (!this.#key) return this.#status("sem chave na URL", "off");
      this.#status("reconectando…", "off");
      setTimeout(() => this.open(), RECONNECT_MS);
    };
  }

  send(message) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  #status(text, state) {
    const element = byId("conn");
    element.textContent = text;
    element.dataset.state = state;
  }
}
