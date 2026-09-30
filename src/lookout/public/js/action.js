import { byId, escapeHtml as esc } from "./dom.js";
import { RESCUE_LABELS } from "./format.js";

/**
 * The only place a person acts on the climb: signing (the line, diamond bolts and summits) or answering a rescue.
 * The panel is rebuilt only when the pending decision changes, so a click is never lost to a re-render.
 */
export class ActionPanel {
  #element = byId("action");
  #pending = "";
  #send;

  constructor(send) {
    this.#send = send;
  }

  reset() {
    this.#pending = "";
  }

  render(view) {
    const pending = pendingDecision(view);
    if (pending === this.#pending) return;
    this.#pending = pending;
    if (pending.startsWith("sign:line:")) this.#renderSignature(view);
    else if (pending.startsWith("sign:")) this.#renderOtherSignature(view, pendingSignature(view));
    else if (pending.startsWith("rescue:")) this.#renderRescue(view);
    else this.#element.innerHTML = "";
  }

  #renderSignature(view) {
    this.#element.innerHTML = `
      <div class="panel">
        <h2>Assine a line para o climb seguir</h2>
        <p>A assinatura vale só para este texto. Se alguém editar a line, ela precisa ser assinada de novo.</p>
        <pre>${esc(view.line.text)}</pre>
        <div class="row">
          <button class="btn" type="button" data-sign>Assinar line</button>
          <span class="hash">hash ${esc(view.line.hash.slice(0, 12))} · rascunho ${view.line.drafts}</span>
        </div>
      </div>`;
    this.#element.querySelector("[data-sign]").addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      this.#send({ cmd: "sign", climb: view.id, hash: view.line.hash });
    });
  }

  #renderOtherSignature(view, signature) {
    this.#element.innerHTML = `
      <div class="panel">
        <h2>${esc(signature.what)}: assine para o climb seguir</h2>
        <p>Revise ${esc(signature.review)}. A assinatura vale só para esta versão.</p>
        ${signature.text ? `<pre>${esc(signature.text)}</pre>` : ""}
        <div class="row">
          <button class="btn" type="button" data-sign>Assinar</button>
          <span class="hash">${esc(signature.target)} · hash ${esc(signature.hash.slice(0, 12))}</span>
        </div>
      </div>`;
    this.#element.querySelector("[data-sign]").addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      this.#send({ cmd: "sign", climb: view.id, target: signature.target, hash: signature.hash });
    });
  }

  #renderRescue(view) {
    const buttons = view.rescue.options
      .map(
        (option, i) =>
          `<button class="btn${i ? " ghost" : ""}" type="button" data-option="${esc(option)}">${esc(RESCUE_LABELS[option] ?? option)}</button>`,
      )
      .join("");
    this.#element.innerHTML = `
      <div class="panel">
        <h2>Rescue: o Basecamp precisa de você</h2>
        <p>${esc(view.rescue.reason)}</p>
        <div class="row">${buttons}</div>
      </div>`;
    for (const button of this.#element.querySelectorAll("[data-option]")) {
      button.addEventListener("click", () => {
        for (const other of this.#element.querySelectorAll("button")) other.disabled = true;
        this.#send({ cmd: "rescue", climb: view.id, option: button.dataset.option });
      });
    }
  }
}

function pendingDecision(view) {
  if (view.state === "awaiting_signature" && view.line && !view.line.signed) return `sign:line:${view.line.hash}`;
  if (view.state === "rescue" && view.rescue) return `rescue:${view.rescue.seq}`;
  const signature = pendingSignature(view);
  if (signature) return `sign:${signature.target}:${signature.hash}`;
  return "";
}

function pendingSignature(view) {
  return (view.signatures ?? []).find((signature) => !signature.signed);
}
