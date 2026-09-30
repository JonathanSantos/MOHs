import type { CrewDriver } from "../../crew/driver.ts";
import { FakeCrew } from "./fake-crew.ts";
import { FakeRunner } from "./fake-runner.ts";
import { SCENARIOS } from "./scenarios/index.ts";

export const DEFAULT_SCENARIO = "share-link";

/** A scripted crew and runner: the whole flow, in the terminal and in the Lookout, without any model. */
export const fakeDriver: CrewDriver = {
  name: "fake",
  summary: "equipe simulada por cenário, sem modelo nem agente",

  setup({ request, scenario: name = DEFAULT_SCENARIO, speed }) {
    const scenario = SCENARIOS[name];
    if (!scenario) return `cenário desconhecido: ${name}. Disponíveis: ${Object.keys(SCENARIOS).join(", ")}`;
    return {
      crew: new FakeCrew(scenario, speed),
      runner: new FakeRunner(scenario, speed),
      request: request || scenario.request,
      scenario: scenario.name,
      banner: `cenário ${scenario.name} (equipe simulada)`,
    };
  },
};
