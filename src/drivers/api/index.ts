import type { CrewDriver } from "../../crew/driver.ts";
import { LocalRunner } from "../../runner/local-runner.ts";
import { TaskCrew } from "../../tasks/task-crew.ts";
import { ApiBoard } from "./api-board.ts";
import { ProviderRegistry } from "./llm/registry.ts";

/** MOHs' own agent loop calls the models by API. Every model it will use needs credentials before the climb starts. */
export const apiDriver: CrewDriver = {
  name: "api",
  summary: "o loop próprio do MOHs chama os modelos por API (Anthropic, Kimi)",

  setup({ config, climbId, request }) {
    if (!request) return 'diga o pedido: mohs climb "o que você quer" --crew api';
    const { models } = config.settings;
    const providers = new ProviderRegistry(config.settings);
    const problems = providers.checkCredentials([models.scout, models.setter, models.climber, models.crux]);
    if (problems.length) return problems.join("\n");
    return {
      crew: new TaskCrew({ config, board: new ApiBoard({ config, providers }) }),
      runner: new LocalRunner({ config, climbId }),
      request,
      banner: `equipe: loop próprio por API (climber ${models.climber} · crux ${models.crux})`,
    };
  },
};
