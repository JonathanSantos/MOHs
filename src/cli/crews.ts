import type { CrewDriver } from "../crew/driver.ts";
import { apiDriver } from "../drivers/api/index.ts";
import { fakeDriver } from "../drivers/fake/index.ts";
import { agentDriver } from "../tasks/agent-driver.ts";

/**
 * Who can climb, by the name `--crew` takes. The CLI is the only place that knows every driver:
 * the core never imports from `drivers/`.
 */
export const CREW_DRIVERS: Readonly<Record<string, CrewDriver>> = Object.fromEntries(
  [agentDriver, apiDriver, fakeDriver].map((driver) => [driver.name, driver]),
);

export const DEFAULT_CREW = agentDriver.name;
