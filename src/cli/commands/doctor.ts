import { loadChecks } from "../../checks/run.ts";
import { loadConfig } from "../../config/load.ts";
import { defineCommand } from "../command.ts";
import { printDoctorReport } from "../reports/doctor.ts";
import { adoptHint, testPlanLines } from "../reports/test-plan.ts";
import { detectProject } from "../scaffold/detect.ts";
import { ink, print } from "../terminal.ts";

export const doctorCommand = defineCommand({
  name: "doctor",
  summary: "valida a configuração e mostra camadas, rack, brake e O₂",
  flags: {},

  async run({ projectRoot }) {
    const config = loadConfig({ projectRoot });
    // Os checks são código: carregá-los aqui mostra o erro antes de um climb parar por causa dele.
    const { problems } = await loadChecks(config.checks);
    const diagnostics = [...config.diagnostics, ...problems.map((message) => ({ level: "error" as const, message }))];
    printDoctorReport({ ...config, diagnostics });
    const { seal, sealE2e } = config.settings.commands;
    print(
      "",
      ink.bold("plano de testes"),
      ...testPlanLines(detectProject(projectRoot).tests, { seal, sealE2e }, (option) =>
        adoptHint(option, `troque commands.${option.id === "playwright" ? "seal_e2e" : "seal"} por "${option.seal}" no mohs.yaml`),
      ),
    );
    return diagnostics.some((d) => d.level === "error") ? 1 : 0;
  },
});
