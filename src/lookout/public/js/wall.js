import { byId, prefersReducedMotion, svg } from "./dom.js";

const TOP = 56;
const BASE = 344;
const HEIGHT = 396;
const MIN_WIDTH = 540;
const COLUMN_WIDTH = 170;
/** Easing per frame: climbing is slow and steady, a fall is fast. */
const EASE = { up: 0.07, down: 0.28 };

/**
 * The climbing wall: one vertical line per route, anchors as circles, bolts as crosses,
 * friction as rock texture and the climber as a dot that eases towards its position.
 */
export class Wall {
  #element = byId("wall");
  #signature = "";
  #routes = new Map();

  constructor() {
    requestAnimationFrame(() => this.#tick());
  }

  render(view) {
    const signature = `${view.id}|${view.routes.map((r) => `${r.id}:${r.pitches.length}:${r.hardness}`).join(",")}`;
    if (signature !== this.#signature) this.#rebuild(view, signature);

    for (const route of view.routes) {
      const drawn = this.#routes.get(route.id);
      if (!drawn) continue;
      drawn.target = yOf(drawn.pitches, route.pos);
      if (prefersReducedMotion || drawn.current === null) drawn.current = drawn.target;
      drawn.group.setAttribute("class", `route route-${route.hardness} ${stateClass(route)}`);
      route.pitches.forEach((pitch, i) => drawn.anchors[i]?.classList.toggle("done", pitch.state === "anchored"));
      this.#drawFriction(drawn, route);
    }
  }

  #rebuild(view, signature) {
    this.#signature = signature;
    this.#routes.clear();
    for (const group of this.#element.querySelectorAll("g.route")) group.remove();

    const columns = Math.max(view.routes.length, 1);
    const width = Math.max(MIN_WIDTH, columns * COLUMN_WIDTH);
    this.#element.setAttribute("viewBox", `0 0 ${width} ${HEIGHT}`);
    view.routes.forEach((route, i) => {
      const x = Math.round(((i + 0.5) * width) / columns);
      this.#routes.set(route.id, drawRoute(this.#element, route, x));
    });
  }

  #drawFriction(drawn, route) {
    const perPitch = new Map();
    for (const friction of route.friction) {
      const pitch = friction.pitch ?? route.pitches.length;
      perPitch.set(pitch, (perPitch.get(pitch) ?? 0) + 1);
    }
    const signature = [...perPitch].join(";");
    if (signature === drawn.frictionSignature) return;
    drawn.frictionSignature = signature;
    drawn.friction.replaceChildren(
      ...[...perPitch].map(([pitch, count]) => {
        const top = yOf(drawn.pitches, pitch);
        const bottom = yOf(drawn.pitches, pitch - 1);
        return svg("rect", {
          x: drawn.x + 12,
          y: top + 6,
          width: Math.min(7 * count, 42),
          height: Math.max(4, bottom - top - 12),
          class: "r-hatch",
        });
      }),
    );
  }

  #tick() {
    for (const drawn of this.#routes.values()) {
      if (drawn.current === null) continue;
      const distance = drawn.target - drawn.current;
      drawn.current = Math.abs(distance) > 0.2 ? drawn.current + distance * (distance > 0 ? EASE.down : EASE.up) : drawn.target;
      drawn.dot.setAttribute("cy", drawn.current.toFixed(1));
      drawn.rope.setAttribute("y2", drawn.current.toFixed(1));
    }
    requestAnimationFrame(() => this.#tick());
  }
}

function drawRoute(parent, route, x) {
  const pitches = route.pitches.length;
  const group = svg("g", { class: `route route-${route.hardness}` });
  group.append(svg("line", { x1: x, y1: BASE, x2: x, y2: TOP, class: "r-line" }));

  if (route.hardness !== "fluorite") {
    for (let k = 0; k < pitches; k++) group.append(boltMark(x - 13, (yOf(pitches, k) + yOf(pitches, k + 1)) / 2));
  }

  const friction = svg("g");
  const rope = svg("line", { x1: x, y1: BASE, x2: x, y2: BASE, class: "r-rope" });
  const anchors = [];
  for (let k = 1; k < pitches; k++) anchors.push(svg("circle", { cx: x, cy: yOf(pitches, k), r: 5.5, class: "r-anchor" }));
  group.append(
    friction,
    rope,
    ...anchors,
    svg("circle", { cx: x, cy: TOP, r: 8, class: "r-halo" }),
    ...topAnchor(route, x),
    ...summitFlag(x),
    tent(x),
  );

  const dot = svg("circle", { cx: x, cy: BASE, r: 7.5, class: "r-dot" });
  group.append(dot);
  parent.append(group);
  return { group, x, pitches, rope, dot, anchors, friction, frictionSignature: "", current: null, target: BASE };
}

function boltMark(x, y) {
  return svg("path", { d: `M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`, class: "r-bolt" });
}

/** Rigged routes end at a double anchor (the send); fluorite routes at a plain one. */
function topAnchor(route, x) {
  if (route.hardness === "fluorite") return [svg("circle", { cx: x, cy: TOP, r: 5.5, class: "r-anchor" })];
  return [svg("circle", { cx: x, cy: TOP, r: 8, class: "r-top-out" }), svg("circle", { cx: x, cy: TOP, r: 3.5, class: "r-top-in" })];
}

function summitFlag(x) {
  return [
    svg("line", { x1: x, y1: TOP - 12, x2: x, y2: TOP - 44, class: "r-pole" }),
    svg("path", { d: `M${x} ${TOP - 44} L${x + 20} ${TOP - 38} L${x} ${TOP - 32} Z`, class: "r-flag" }),
  ];
}

function tent(x) {
  return svg("path", { d: `M${x - 14} ${BASE + 26} L${x} ${BASE + 6} L${x + 14} ${BASE + 26} Z`, class: "r-tent" });
}

function stateClass(route) {
  if (route.label === "fall") return "falling";
  if (route.state === "blocked") return "blocked";
  if (route.state === "summited") return "summit";
  if (route.state === "abandoned") return "abandoned";
  if (route.state === "sending" && route.label === "send") return "sending";
  return "";
}

function yOf(pitches, position) {
  return BASE - (position / Math.max(pitches, 1)) * (BASE - TOP);
}
