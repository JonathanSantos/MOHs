import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockersOf, planWindows } from "../src/basecamp/windows.ts";
import { gradeEvidence } from "../src/domain/evidence.ts";
import { findLeaks } from "../src/guards/leak.ts";
import { builtInCovers, builtInSealCommand, countTestCases } from "../src/runner/seal-runners.ts";
import { countScenarios } from "../src/domain/line.ts";
import { croquiIssues, renderCroqui, type Croqui } from "../src/domain/croqui.ts";
import { reviewDiff } from "../src/pack/review-diff.ts";
import { isTestPath } from "../src/util/paths.ts";
import { bestMatch, literalPrefixLength, matchGlob } from "../src/util/glob.ts";
import { formatO2, parseO2 } from "../src/util/o2.ts";

describe("glob", () => {
  it("matches ** at any depth, including the root", () => {
    assert.ok(matchGlob("App.tsx", "**/*.tsx"));
    assert.ok(matchGlob("web/src/features/App.tsx", "**/*.tsx"));
    assert.ok(!matchGlob("web/src/App.ts", "**/*.tsx"));
  });

  it("keeps * inside a single folder", () => {
    assert.ok(matchGlob("web/App.tsx", "web/*.tsx"));
    assert.ok(!matchGlob("web/src/App.tsx", "web/*.tsx"));
  });

  it("supports groups and folders in the middle", () => {
    assert.ok(matchGlob("server/src/routes/share.ts", "**/{server,api}/**"));
    assert.ok(matchGlob("web/api/x.ts", "**/{server,api}/**"));
    assert.ok(!matchGlob("web/src/x.ts", "**/{server,api}/**"));
    assert.ok(matchGlob("a/server/b/c.ts", "**/server/**/*.ts"));
  });

  it("treats Windows separators and ./ like POSIX paths", () => {
    assert.ok(matchGlob(".\\web\\src\\App.tsx", "web/src/*.tsx"));
    assert.ok(matchGlob("./web/src/App.tsx", "web\\src\\*.tsx"));
  });

  it("ranks globs by their literal prefix", () => {
    assert.equal(literalPrefixLength("web/src/**/*.tsx"), 8);
    assert.equal(literalPrefixLength("**/*.tsx"), 0);
    assert.equal(bestMatch(["web/src/App.tsx"], ["**/*.tsx", "web/src/**/*.tsx"])?.glob, "web/src/**/*.tsx");
  });
});

describe("O₂", () => {
  it("parses and formats token amounts", () => {
    assert.equal(parseO2("8k"), 8_000);
    assert.equal(parseO2("1.2M"), 1_200_000);
    assert.equal(parseO2("1,5k"), 1_500);
    assert.equal(parseO2(300), 300);
    assert.throws(() => parseO2("lots"));
    assert.equal(formatO2(1_200_000), "1,2M");
    assert.equal(formatO2(1_660_000), "1,66M");
    assert.equal(formatO2(10_000_000), "10M");
    assert.equal(formatO2(38_000), "38k");
  });
});

describe("leak guard", () => {
  const sealed = "test('@rapido exporta com zoom 200% mantendo a largura lógica', async ({ page }) => { expect(png.width).toBe(1440) })";

  it("catches text copied from the sealed tests", () => {
    assert.ok(findLeaks("veja: exporta com zoom 200% mantendo a largura lógica", sealed).length > 0);
  });

  it("lets a behavioural description through", () => {
    assert.deepEqual(findLeaks("Ao exportar com zoom 200%, a imagem deve ter 1440 px de largura. Veio com 2880 px.", sealed), []);
  });
});

describe("windows", () => {
  it("puts routes without shared files together and opens a new window on conflict", () => {
    const windows = planWindows([
      { id: "A", files: ["server/a.ts"] },
      { id: "B", files: ["web/b.tsx"] },
      { id: "C", files: ["server/a.ts", "server/c.ts"] },
    ]);
    assert.deepEqual(
      windows.map((w) => w.map((r) => r.id)),
      [["A", "B"], ["C"]],
    );
  });

  it("puts a route after the ones it depends on, even without shared files and listed first", () => {
    const windows = planWindows([
      { id: "B", files: ["src/server.js"], after: ["A"] },
      { id: "A", files: ["src/tasks.js"] },
      { id: "C", files: ["README.md"] },
      { id: "D", files: ["docs/api.md"], after: ["B"] },
    ]);
    assert.deepEqual(
      windows.map((w) => w.map((r) => r.id)),
      [["A", "C"], ["B"], ["D"]],
    );
  });

  it("makes a route wait only for its dependencies and for earlier routes that share its files", () => {
    const routes = [
      { id: "A", files: ["src/tasks.js"] },
      { id: "B", files: ["src/server.js"], after: ["A"] },
      { id: "C", files: ["README.md"] },
      { id: "D", files: ["README.md", "docs/api.md"] },
    ];
    const windows = planWindows(routes);
    const blockers = Object.fromEntries(routes.map((route) => [route.id, blockersOf(route, windows)]));
    assert.deepEqual(blockers, { A: [], B: ["A"], C: [], D: ["C"] }, "B does not wait for C, nor D for A");
  });

  it("treats a folder ending in / as conflicting with what is inside it", () => {
    const windows = planWindows([
      { id: "A", files: ["web/src/"] },
      { id: "B", files: ["web/src/App.tsx"] },
    ]);
    assert.equal(windows.length, 2);
  });
});

describe("review diff", () => {
  const diff = [
    "diff --git a/src/server.js b/src/server.js",
    "index 1111111..2222222 100644",
    "--- a/src/server.js",
    "+++ b/src/server.js",
    "@@ -10,3 +10,4 @@ export function createServer(store) {",
    "   const a = 1;",
    "-  const b = 2;",
    "+  const b = 3;",
    "+  const c = 4;",
    "   return a;",
    "diff --git a/db/down.sql b/db/down.sql",
    "--- a/db/down.sql",
    "+++ b/db/down.sql",
    "@@ -1,2 +1,1 @@",
    "--- remove a coluna",
    " DROP TABLE x;",
    "diff --git a/test/server.test.js b/test/server.test.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/test/server.test.js",
    "@@ -0,0 +1,2 @@",
    '+import test from "node:test";',
    "+test();",
  ].join("\n");

  it("numbers each line as it is in the file, so findings cite file:line", () => {
    const text = reviewDiff(diff, { tests: false });
    assert.match(text, /### src\/server\.js \(alterado · \+2 −1\)/);
    assert.match(text, /^  10 {5}const a = 1;$/m);
    assert.match(text, /^ {5}- {3}const b = 2;$/m);
    assert.match(text, /^  11 \+ {3}const b = 3;$/m);
    assert.match(text, /^  13 {5}return a;$/m);
  });

  it("reads a removed line that starts with -- as content, not as a header", () => {
    assert.match(reviewDiff(diff, { tests: false }), /### db\/down\.sql \(alterado · \+0 −1\)\n.*\n {5}- -- remove a coluna/);
  });

  it("lists test files with their size unless the reviewer reads tests", () => {
    const code = reviewDiff(diff, { tests: false });
    assert.doesNotMatch(code, /node:test/);
    assert.match(code, /Testes alterados, fora deste diff .*: test\/server\.test\.js \(\+2 −0\)/);
    assert.match(reviewDiff(diff, { tests: true }), /### test\/server\.test\.js \(novo · \+2 −0\)\n.*\n {3}1 \+ import test/);
  });

  it("tells test files apart by name and folder", () => {
    for (const path of [
      "src/a.test.ts",
      "web/App.spec.tsx",
      "test/api.js",
      "pkg/__tests__/x.js",
      "e2e/login.ts",
      "tests/test_api.py",
      "x_test.go",
    ])
      assert.ok(isTestPath(path), path);
    for (const path of ["src/server.js", "src/testing-utils.ts", "README.md"]) assert.ok(!isTestPath(path), path);
  });
});

describe("evidence", () => {
  const grade = (input: Partial<Parameters<typeof gradeEvidence>[0]>) =>
    gradeEvidence({ sealed: 0, commands: [], projectTests: 0, checks: 0, ...input }).grade;

  it("grades what proved a route: sealed tests and the project's tests are the real proof", () => {
    assert.equal(grade({ sealed: 3, commands: ["npm test"], projectTests: 12 }), "forte");
    assert.equal(grade({ sealed: 3 }), "média");
    assert.equal(grade({ commands: ["npm run lint", "npm test"], projectTests: 12 }), "média");
    assert.equal(grade({ commands: ["npm run lint", "npm run typecheck"] }), "fraca");
    assert.equal(grade({}), "nenhuma");
  });

  it("does not count a test command in a project without tests", () => {
    const evidence = gradeEvidence({ sealed: 0, commands: ["npm test"], projectTests: 0, checks: 1 });
    assert.equal(evidence.grade, "fraca");
    assert.deepEqual(evidence.proofs, ["checagens sem teste (npm test)", "1 check do projeto"]);
  });
});

describe("built-in seal runners", () => {
  it("runs a sealed file by its extension and says which stacks need commands.seal", () => {
    assert.equal(builtInSealCommand("test/sealed/a.test.ts"), "node --test {file}");
    assert.equal(builtInSealCommand("tests/test_a.py"), "python3 {file}");
    assert.equal(builtInSealCommand("a_test.go"), undefined);
    assert.ok(builtInCovers(["TSX", "CSS"]));
    assert.ok(!builtInCovers(["Go"]));
  });
});

describe("seal budget", () => {
  const LINE = [
    "# Line",
    "## Cenários",
    "### A. Store",
    "- QUANDO add ENTÃO cria",
    "- QUANDO complete ENTÃO conclui",
    "### B. Servidor",
    "- QUANDO GET ENTÃO lista",
    "## Decisões",
    "- QUANDO houver dúvida ENTÃO pergunte",
  ].join("\n");

  it("counts the scenarios of a route's own section, or of the whole line without sections", () => {
    assert.equal(countScenarios(LINE, "A"), 2);
    assert.equal(countScenarios(LINE, "B"), 1, "the section ends at the next heading of the same level or above");
    assert.equal(countScenarios(LINE, "C"), 4, "no section for C: the whole line");
    assert.equal(countScenarios(LINE), 4);
  });

  it("counts test cases the way each language declares them", () => {
    const js = 'test("a", () => {});\nit("b", () => {});\ntest.each([1, 2])("c %d", () => {});\ndescribe("d", () => {});\n';
    assert.equal(countTestCases("a.test.js", js), 3);
    assert.equal(countTestCases("test_a.py", "def test_a():\n    pass\nasync def test_b():\n    pass\ndef helper():\n    pass\n"), 2);
    assert.equal(countTestCases("oi.js", "if (greet() !== 'oi') process.exit(1);\n"), 1, "a plain script is one case");
  });
});

describe("croqui", () => {
  const croqui: Croqui = {
    purpose: "Lista de tarefas pessoal, com API local.",
    entities: [
      { name: "Tarefa", where: "src/tasks.js", what: "id sequencial" },
      { name: "Rota", where: "web/routes.js", what: "uma por tela" },
    ],
    sensitive: [{ glob: "src/server.js", why: "aberto ao navegador" }],
    pitfalls: [{ text: "add devolve cópia", file: "src/tasks.js" }],
    sections: [{ title: "Persistência", text: "o arquivo é reescrito inteiro a cada save", files: ["src/tasks.js"] }],
  };

  it("gives planning roles everything and the others only what is near their files", () => {
    assert.match(renderCroqui(croqui, { full: true }), /Rota \(web\/routes\.js\)/);
    const near = renderCroqui(croqui, { full: false, files: ["src/server.js"] });
    assert.match(near, /Tarefa \(src\/tasks\.js\)/, "same folder counts as near");
    assert.doesNotMatch(near, /Rota/);
    assert.match(near, /Áreas sensíveis:\n- src\/server\.js/, "sensitive areas always go");
  });

  it("marks what may be outdated and rejects citations that do not hold", () => {
    assert.match(renderCroqui(croqui, { full: true, stale: ["src/tasks.js"] }), /pode estar desatualizado: src\/tasks\.js mudou/);
    const issues = croquiIssues(
      croqui,
      (file) => file !== "web/routes.js",
      (glob) => glob !== "src/server.js",
    );
    assert.deepEqual(issues, ["web/routes.js não existe no projeto", "a área sensível src/server.js não casa com nenhum arquivo"]);
  });
});
