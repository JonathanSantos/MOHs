// Lookout: recebe do servidor views já projetadas e só desenha. Nenhuma regra de climb mora aqui.
import { ActionPanel } from "./action.js";
import { Connection } from "./connection.js";
import { byId, toast } from "./dom.js";
import { elapsed } from "./format.js";
import {
  renderDescent,
  renderFeed,
  renderFriction,
  renderHeader,
  renderLegend,
  renderMetrics,
  renderPicker,
  renderReport,
} from "./panels.js";
import { Store } from "./store.js";
import { Wall } from "./wall.js";

const ACK_MESSAGES = { sign: "Assinado. O Basecamp segue.", rescue: "Resposta enviada ao Basecamp." };

const store = new Store();
const wall = new Wall();
const connection = new Connection(new URLSearchParams(location.search).get("key") ?? "", onMessage);
const action = new ActionPanel((command) => connection.send(command) || toast("Sem conexão com o Basecamp.", "crit"));
let renderQueued = false;

function onMessage(message) {
  if (message.type === "error") return toast(message.message, "crit");
  if (message.type === "ack") return toast(ACK_MESSAGES[message.cmd] ?? "Feito.", "ok");
  if (store.apply(message)) scheduleRender();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  renderPicker(store);
  const view = store.selected;
  byId("empty").hidden = Boolean(view);
  byId("climb").hidden = !view;
  if (!view) return;

  renderHeader(view);
  renderMetrics(view);
  action.render(view);
  wall.render(view);
  renderLegend(view, store.averages);
  renderFeed(view, store.lastSeen(view));
  renderReport(view);
  renderFriction(view);
  renderDescent(view);
  store.markSeen(view);
}

byId("climb-select").addEventListener("change", (event) => {
  store.choose(event.target.value);
  action.reset();
  render();
});

setInterval(() => {
  const view = store.selected;
  if (view && !view.endedAt) byId("m-time").textContent = elapsed(view);
}, 1000);

connection.open();
