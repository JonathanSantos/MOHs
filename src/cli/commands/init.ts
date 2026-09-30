import { defineCommand } from "../command.ts";
import { adoptHint, testPlanLines } from "../reports/test-plan.ts";
import { initProject } from "../scaffold/init-project.ts";
import { isTestOptionId, TEST_OPTIONS } from "../scaffold/test-plan.ts";
import { fail, ink, print } from "../terminal.ts";

export const initCommand = defineCommand({
  name: "init",
  summary: "cria .mohs/ no projeto, com comandos, guidebooks e o plano de testes detectados",
  flags: {
    force: { type: "boolean", description: "recria a configuração mesmo que ela já exista" },
    tests: {
      type: "string",
      placeholder: "opção",
      description: `como rodar os testes selados: ${Object.keys(TEST_OPTIONS).join(", ")} (padrão: o que o projeto já usa, ou o da linguagem)`,
    },
  },

  run({ projectRoot, flags }) {
    if (flags.tests !== undefined && !isTestOptionId(flags.tests)) {
      return fail(`opção de testes desconhecida: ${flags.tests}. Opções: ${Object.keys(TEST_OPTIONS).join(", ")}`);
    }
    const result = initProject(projectRoot, { force: flags.force, tests: flags.tests });
    if ("alreadyInitialized" in result) {
      print(
        `.mohs/mohs.yaml já existe. Use ${ink.rope("--force")} para recriar (e ${ink.rope("mohs doctor")} para ver o plano de testes).`,
      );
      return 1;
    }
    const { created, profile } = result;
    const orNone = (items: string[], fallback: string) => items.join(" · ") || ink.dim(fallback);
    print(`${ink.bold("MOHs init")} · ${projectRoot}`, "", ...created.map((file) => `  ${ink.ok("criado")}   ${file}`), "");
    print(
      `  guidebooks  ${orNone(profile.guidebooks, "nenhum detectado")}`,
      `  anchor      ${orNone(profile.anchor, "nenhum script detectado")}`,
      `  send        ${orNone(profile.send, "nenhum script detectado")}`,
      ...testPlanLines(profile.tests, { seal: profile.seal, sealE2e: profile.sealE2e }, (option) =>
        adoptHint(option, `rode ${ink.rope(`mohs init --force --tests ${option.id}`)}`),
      ),
    );
    const chosen = flags.tests ? TEST_OPTIONS[flags.tests] : undefined;
    if (chosen && "install" in chosen) print("", ink.warn(`Instale antes do primeiro climb: ${chosen.install}`));
    if (profile.workspaces.length) print(`  workspaces  ${profile.workspaces.join(", ")}`);
    print("", `Próximo passo: ${ink.rope("mohs doctor")}`);
    return 0;
  },
});
