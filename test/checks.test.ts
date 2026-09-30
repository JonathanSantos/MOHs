import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { agentClimb, mohs, useMohsBin, workDir } from "./agent-helpers.ts";
import { gitProject } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

// Uma URL file:// e não um caminho: no Windows, um import de "D:\…" não é aceito pelo carregador ESM.
const MOHS_API = new URL("../src/index.ts", import.meta.url).href;
const ANCHOR = 'node -e "process.exit(0)"';

const PLAN = {
  reason: "troca pequena",
  routes: [
    {
      id: "A",
      name: "Saudação curta",
      hardness: "fluorite",
      files: ["src/greet.js"],
      tags: [],
      pitches: [{ title: "Trocar", files: ["src/greet.js"] }],
    },
  ],
};

/** A project with one check at each moment: the anchor forbids console.log, the summit wants a CHANGELOG line. */
function project(): string {
  const check = (body: string) => `import { defineCheck } from ${JSON.stringify(MOHS_API)};\nexport default defineCheck(${body});\n`;
  return gitProject({
    "package.json": '{ "type": "module" }\n',
    "src/greet.js": 'export const greet = () => "olá";\n',
    "CHANGELOG.md": "# Mudanças\n",
    ".gitignore": ".mohs/climbs/\n",
    ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n`,
    ".mohs/checks/sem-console.ts": check(`{
  name: "sem-console",
  at: "anchor",
  when: { files: ["src/**"] },
  async run({ exec }) {
    const { code } = await exec("git grep -q console.log -- src");
    return code === 0 ? { ok: false, message: "tire o console.log de src/" } : { ok: true };
  },
}`),
    ".mohs/checks/changelog.ts": check(`{
  name: "changelog",
  at: "summit",
  async run({ exec }) {
    const { output } = await exec("git diff HEAD~1 --name-only");
    return output.includes("CHANGELOG.md") ? { ok: true } : { ok: false, severity: "high", message: "registre a mudança no CHANGELOG.md" };
  },
}`),
  });
}

describe("TypeScript checks", () => {
  useMohsBin();

  it("fail an anchor before the commit, and block a fluorite summit until the fix", async (t) => {
    const root = project();
    const climb = agentClimb(root, t, "20260929-2300-chck");
    const running = climb.run();
    const answer = join(tempProject(), "plan.json");
    writeFileSync(answer, JSON.stringify(PLAN));
    await mohs(root, "next");
    await mohs(root, "call", "plan", "--file", answer);
    await mohs(root, "next");
    await mohs(root, "call", "line", "# Line\n\nQUANDO alguém chama greet() ENTÃO recebe oi.\n");
    await mohs(root, "sign");
    const pitch = await mohs(root, "next");
    const workspace = workDir(pitch.out);

    writeFileSync(join(workspace, "src/greet.js"), 'export const greet = () => { console.log("oi"); return "oi"; };\n');
    const retry = await mohs(root, "call", "safe", "greet() devolve oi");
    assert.match(retry.out, /tentativa 2/);
    assert.match(retry.out, /check sem-console falhou: tire o console\.log de src\//);

    writeFileSync(join(workspace, "src/greet.js"), 'export const greet = () => "oi";\n');
    const fix = await mohs(root, "call", "safe", "sem console.log");
    assert.match(fix.out, /Correção dos achados da inspection · Saudação curta/);
    assert.match(fix.out, /high · check:changelog: registre a mudança no CHANGELOG\.md/);

    writeFileSync(join(workspace, "CHANGELOG.md"), "# Mudanças\n\n- greet() devolve oi\n");
    const done = await mohs(root, "call", "safe", "changelog atualizado");
    assert.match(done.out, /Climb concluído/);

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    const reports = readEvents(climb.logFile).filter((e) => e.type === "inspection.report");
    assert.equal(reports.length, 2, "one round blocked, one clean");
  });

  it("stop the climb before any work when a check file is broken", async (t) => {
    const root = project();
    writeFileSync(join(root, ".mohs/checks/quebrado.ts"), "export default { nome: 'errado' };\n");
    const view = await agentClimb(root, t, "20260929-2300-brkn").run();
    assert.equal(view.state, "aborted");
    const aborted = view.timeline.at(-1)?.text ?? "";
    assert.match(aborted, /corrija os checks do projeto.*quebrado\.ts: exporte um check feito com defineCheck/);
  });
});
