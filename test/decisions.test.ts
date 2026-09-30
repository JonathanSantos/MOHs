import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkAgainst, numberDecisions, parseChoice, reviewLine, settle, signedLine } from "../src/domain/decisions.ts";
import { handleCommand } from "../src/lookout/commands.ts";
import type { ClimbHub } from "../src/lookout/hub.ts";
import { countScenarios } from "../src/domain/line.ts";
import { sha256 } from "../src/util/fs.ts";
import type { ClimbView } from "../src/view/types.ts";
import { tempProject } from "./helpers.ts";

const DECISIONS = numberDecisions([
  {
    question: "$(fn) com o DOM pronto roda quando?",
    options: [
      { choice: "no próximo tick", why: "o pedido pede o comportamento do jQuery, que adia" },
      { choice: "na hora", why: "mais simples de testar" },
    ],
  },
  {
    question: ".css() com número acrescenta px?",
    options: [
      { choice: "sim, exceto propriedades sem unidade", why: "é o que o jQuery faz" },
      { choice: "não", why: "menos código" },
      { choice: "só em width e height", why: "cobre o uso comum" },
    ],
    against: "mesmo comportamento do jQuery",
  },
]);

describe("line decisions", () => {
  it("shows every option to the human, the recommended one first, and warns when it goes against the request", () => {
    const text = reviewLine("# Line\n\nQUANDO x ENTÃO y.", DECISIONS);
    assert.match(text, /### D1 · \$\(fn\) com o DOM pronto roda quando\?\n\n- \*\*A \(recomendada\):\*\* no próximo tick/);
    assert.match(text, /- \*\*C:\*\* só em width e height/);
    assert.match(text, /⚠ A recomendada contraria o pedido: "mesmo comportamento do jQuery"/);
    assert.match(text, /mohs sign D1=B "D2=…"/);
  });

  it("settles each decision with the recommendation, another option or the human's own words", () => {
    const { settled, problems } = settle(DECISIONS, { d2: "b" });
    assert.deepEqual(problems, []);
    assert.deepEqual(
      settled.map((d) => [d.id, d.answer, d.by]),
      [
        ["D1", "no próximo tick", "recommended"],
        ["D2", "não", "option"],
      ],
    );
    assert.equal(settle(DECISIONS, { D1: "roda na hora e recebe $" }).settled[0].by, "human");
    assert.deepEqual(settle(DECISIONS, { D1: "C", D9: "A" }).problems, [
      "a line não tem a decisão D9 (tem D1, D2)",
      "D1 não tem a opção C (vai de A a B)",
    ]);
  });

  it("signs a line that keeps only what was decided", () => {
    const line = signedLine("# Line", settle(DECISIONS, { D2: "sem px nenhum" }).settled);
    assert.match(line, /- D1 · \$\(fn\) com o DOM pronto roda quando\? → no próximo tick \(recomendada\)/);
    assert.match(line, /- D2 · .* → sem px nenhum \(resposta do humano\)/);
    assert.doesNotMatch(line, /na hora|width e height/, "the other options are gone");
    assert.deepEqual(parseChoice("d2=sem px"), ["D2", "sem px"]);
    assert.equal(parseChoice("line"), null);
  });

  it("keeps a warning only when it quotes the request, whatever the accents, quotes and spaces", () => {
    const request = "Crie um mini jQuery com o mesmo  comportamento do jQuery; o arquivo principal é index.html.";
    const { decisions, dropped } = checkAgainst(
      [
        { ...DECISIONS[1], against: '"Mesmo comportamento do jQuery"' },
        { ...DECISIONS[0], against: "só um texto que pisca" },
      ],
      request,
    );
    assert.equal(decisions[0].against, '"Mesmo comportamento do jQuery"');
    assert.equal(decisions[1].against, undefined);
    assert.deepEqual(dropped, [DECISIONS[0].id]);
  });

  it("turns a decision with its situation into a scenario the belayer tests", () => {
    const [decision] = numberDecisions([
      {
        question: "Hook na condição do do/while acusa?",
        when: "um hook é chamado na condição de um do/while",
        options: [
          { choice: "a regra acusa o erro de loop", why: "a condição roda a cada volta" },
          { choice: "continua aceito", why: "é o que acontece hoje em while" },
        ],
      },
    ]);
    assert.match(reviewLine("# Line", [decision]), /QUANDO um hook é chamado na condição de um do\/while, ENTÃO:/);
    const line = signedLine("# Line", settle([decision], { D1: "B" }).settled);
    assert.match(line, /- D1 · QUANDO um hook é chamado na condição de um do\/while ENTÃO continua aceito \(escolhida pelo humano\)/);
    assert.equal(countScenarios(line), 1, "the belayer's budget counts it");
  });

  it("the Lookout signs with the human's choices, and refuses one the line does not offer", () => {
    const mohsDir = tempProject();
    const dir = join(mohsDir, "climbs", "c1");
    mkdirSync(dir, { recursive: true });
    const text = reviewLine("# Line", DECISIONS);
    writeFileSync(join(dir, "line.md"), text);
    const hub = { view: () => ({ line: { decisions: DECISIONS } }) as unknown as ClimbView } as unknown as ClimbHub;
    const send = (choices: Record<string, string>) =>
      handleCommand(JSON.stringify({ cmd: "sign", climb: "c1", hash: sha256(text), choices }), mohsDir, hub);

    assert.deepEqual(send({ D1: "C" }), { ok: false, message: "D1 não tem a opção C (vai de A a B)", cmd: "sign" });
    assert.deepEqual(send({ D1: "B", D2: "sem px" }), { ok: true, cmd: "sign" });
    const signature = JSON.parse(readFileSync(join(dir, "signature.json"), "utf8"));
    assert.deepEqual(signature.choices, { D1: "B", D2: "sem px" });
  });
});
