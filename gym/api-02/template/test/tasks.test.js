import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../src/tasks.js";

test("add cria tarefas com ids sequenciais", () => {
  const store = createStore();
  assert.equal(store.add("comprar pão").id, 1);
  assert.equal(store.add("pagar conta").id, 2);
  assert.deepEqual(store.list().map((t) => t.title), ["comprar pão", "pagar conta"]);
});

test("add recusa título vazio", () => {
  assert.throws(() => createStore().add("  "), /título vazio/);
});

test("remove apaga pelo id", () => {
  const store = createStore();
  const { id } = store.add("x");
  assert.equal(store.remove(id), true);
  assert.equal(store.remove(id), false);
  assert.deepEqual(store.list(), []);
});
