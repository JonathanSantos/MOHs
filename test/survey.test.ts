import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { surveyRepository } from "../src/survey/survey.ts";
import { tempProject } from "./helpers.ts";

describe("survey", () => {
  it("calls a project with only scaffold files a first ascent", () => {
    const survey = surveyRepository(tempProject({ "README.md": "# x\n", "package.json": "{}", ".gitignore": "node_modules\n" }));
    assert.equal(survey.kind, "first_ascent");
  });

  it("maps languages, layout, scripts and dependencies of an existing project, skipping dependencies and secrets", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ scripts: { "test:quick": "vitest run" }, devDependencies: { vitest: "1" } }),
      "web/package.json": JSON.stringify({ dependencies: { react: "19" } }),
      "web/src/App.tsx": "export default () => null;\n",
      "web/src/main.tsx": "\n",
      "server/src/index.ts": "\n",
      "node_modules/react/index.js": "\n",
      ".env": "SECRET=1\n",
    });
    const survey = surveyRepository(root);
    assert.equal(survey.kind, "variation");
    assert.equal(survey.files, 5);
    assert.match(survey.summary, /Linguagens: TSX 2, TypeScript 1/);
    assert.match(survey.summary, /- web\/ \(3\)/);
    assert.match(survey.summary, /test:quick: vitest run/);
    assert.match(survey.summary, /package.json \(web\)\ndependências: react/);
    assert.doesNotMatch(survey.summary, /node_modules|\.env/);
  });
});
