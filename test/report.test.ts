import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReport } from "../src/report/data.ts";
import { renderReport } from "../src/report/html.ts";
import { getScenario } from "../src/drivers/fake/scenarios/index.ts";
import { simulatedClimb } from "./helpers.ts";

describe("mohs report", () => {
  it("turns a climb log into the plan, the decisions and the phases, and a page that carries them", async () => {
    const climb = simulatedClimb(getScenario("share-link"));
    await climb.run();
    const data = buildReport(climb.session.dir);

    assert.equal(data.climb.state, "done");
    assert.deepEqual(
      data.plan.routes.map((r) => `${r.id}:${r.hardness}:${r.state}`),
      ["A:diamond:summited", "B:quartz:summited", "C:fluorite:summited"],
    );
    assert.deepEqual(data.delivery?.merged.toSorted(), ["A", "B", "C"], "three routes, one delivery");
    assert.equal(data.delivery?.merged[0], "C", "the fluorite route needs no rigging, so it reaches the delivery first");
    const titles = data.decisions.map((d) => d.title);
    assert.ok(titles.some((t) => /^Plano: 3 route\(s\), hardness diamond$/.test(t)));
    assert.ok(titles.includes("Line assinada"));
    assert.ok(
      titles.some((t) => /^bolts-A assinado$/.test(t)),
      "diamond bolts signature is a human decision",
    );
    assert.ok(titles.some((t) => /^Fall na route B/.test(t)));
    assert.deepEqual(
      data.phases.map((p) => p.name),
      ["Survey", "Scout", "Line", "Assinatura", "Routes", "Entrega", "Descent"],
    );

    const html = renderReport(data, { annex: "<h2>Sobre o teste</h2>" });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>Climb [^<]+<\/title>/);
    assert.match(html, /<section class="annex"><h2>Sobre o teste<\/h2><\/section>/);
    assert.doesNotMatch(renderReport(data, { fragment: true }), /<html|<body/);
    // O JSON embutido não pode fechar o <script> antes da hora.
    const embedded = /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    assert.equal(JSON.parse(embedded).climb.id, data.climb.id);
  });
});
