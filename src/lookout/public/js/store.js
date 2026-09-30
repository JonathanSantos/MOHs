const FINISHED = new Set(["done", "aborted"]);

/** Everything the page knows. Views arrive already projected by the server; nothing is derived here. */
export class Store {
  climbs = new Map();
  selectedId = null;
  averages = null;
  /** Follows new climbs automatically until the person picks one by hand. */
  following = true;
  /** Last event seq already shown per climb, to animate only what is new. */
  seen = new Map();

  get selected() {
    return this.climbs.get(this.selectedId) ?? null;
  }

  sorted() {
    return [...this.climbs.values()].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  }

  /** Applies a server message. Returns true when the page needs to render again. */
  apply(message) {
    if (message.type === "hello") {
      this.climbs = new Map(message.climbs.map((view) => [view.id, view]));
      this.averages = message.averages;
      for (const view of this.climbs.values()) this.seen.set(view.id, view.lastSeq);
      if (!this.climbs.has(this.selectedId)) this.selectedId = this.defaultSelection();
      return true;
    }
    if (message.type === "event") {
      this.climbs.set(message.view.id, message.view);
      this.averages = message.averages;
      if ((message.event.type === "climb.started" && this.following) || !this.selectedId) this.selectedId = message.view.id;
      return true;
    }
    return false;
  }

  choose(id) {
    this.selectedId = id;
    this.following = false;
  }

  markSeen(view) {
    this.seen.set(view.id, view.lastSeq);
  }

  lastSeen(view) {
    return this.seen.get(view.id) ?? 0;
  }

  defaultSelection() {
    const climbs = this.sorted();
    return (climbs.find((view) => !FINISHED.has(view.state)) ?? climbs[0])?.id ?? null;
  }
}
