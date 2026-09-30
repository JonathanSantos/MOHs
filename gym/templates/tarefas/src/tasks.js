/** Uma lista de tarefas em memória. */
export function createStore() {
  const items = [];
  let nextId = 1;

  return {
    add(title) {
      const text = String(title ?? "").trim();
      if (!text) throw new Error("título vazio");
      const task = { id: nextId++, title: text, createdAt: new Date().toISOString() };
      items.push(task);
      return task;
    },

    list() {
      return items.map((task) => ({ ...task }));
    },

    remove(id) {
      const index = items.findIndex((task) => task.id === id);
      if (index === -1) return false;
      items.splice(index, 1);
      return true;
    },
  };
}
