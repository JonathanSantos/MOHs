import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import { FileDesk } from "../src/basecamp/desk.ts";
import { getScenario } from "../src/drivers/fake/scenarios/index.ts";
import { startLookout } from "../src/lookout/server.ts";
import { load, simulatedClimb, tempProject } from "./helpers.ts";

/** Test-side view of server messages: loose on purpose, assertions check the shape. */
type Message = { type: string; [key: string]: any };

function connect(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ws: WebSocket; next: (pred: (m: Message) => boolean) => Promise<Message> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const inbox: Message[] = [];
    const waiters: { pred: (m: Message) => boolean; done: (m: Message) => void }[] = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Message;
      const i = waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) waiters.splice(i, 1)[0].done(msg);
      else inbox.push(msg);
    });
    const next = (pred: (m: Message) => boolean) =>
      new Promise<Message>((done) => {
        const i = inbox.findIndex(pred);
        if (i >= 0) done(inbox.splice(i, 1)[0]);
        else waiters.push({ pred, done });
      });
    ws.once("open", () => resolve({ ws, next }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

describe("Lookout", () => {
  it("requires the session key and checks the origin", async (t) => {
    const lookout = await startLookout({ mohsDir: load(tempProject()).mohsDir, port: 0, key: "chave-de-teste" });
    t.after(() => lookout.close());
    const base = `http://127.0.0.1:${lookout.port}`;

    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    const state = await (await fetch(`${base}/api/state?key=chave-de-teste`)).json();
    assert.deepEqual(state.climbs, []);
    assert.equal((await fetch(`${base}/`)).status, 200);

    await assert.rejects(connect(`ws://127.0.0.1:${lookout.port}/ws?key=errada`), /401/);
    await assert.rejects(connect(`ws://127.0.0.1:${lookout.port}/ws?key=chave-de-teste`, { origin: "https://evil.example" }), /401/);
    const ok = await connect(`ws://127.0.0.1:${lookout.port}/ws?key=chave-de-teste`, { origin: `http://localhost:${lookout.port}` });
    const hello = await ok.next((m) => m.type === "hello");
    assert.deepEqual(hello.climbs, []);
    ok.ws.close();
  });

  it("streams the climb live, and a signature from the browser releases the Basecamp", { timeout: 20_000 }, async (t) => {
    const root = tempProject({ ".mohs/mohs.yaml": 'extends: ["mohs:react"]\n' });
    const lookout = await startLookout({ mohsDir: load(root).mohsDir, port: 0, key: "k", pollMs: 20 });
    t.after(() => lookout.close());
    const client = await connect(`ws://127.0.0.1:${lookout.port}/ws?key=k`);
    t.after(() => client.ws.close());
    await client.next((m) => m.type === "hello");

    const climb = simulatedClimb(getScenario("quick-fix"), { root, desk: new FileDesk({ pollMs: 20 }) });
    const running = climb.run();

    const drafted = await client.next((m) => m.type === "event" && m.event.type === "line.drafted");
    assert.equal(drafted.view.state, "awaiting_signature");

    client.ws.send(JSON.stringify({ cmd: "sign", climb: climb.id, hash: "stale-hash-000" }));
    assert.match((await client.next((m) => m.type === "error")).message, /line mudou/);

    client.ws.send(JSON.stringify({ cmd: "sign", climb: climb.id, hash: drafted.view.line.hash }));
    await client.next((m) => m.type === "ack" && m.cmd === "sign");

    const done = await client.next((m) => m.type === "event" && m.event.type === "climb.done");
    assert.equal(done.view.routes[0].state, "summited");
    assert.equal(done.view.line.signedBy, "lookout");
    assert.equal((await running).state, "done");
  });
});
