import { sleep } from "../../util/runtime.ts";
import type { Scenario, ScenarioRoute } from "./scenarios/index.ts";

/** Shared base for the simulated crew and runner: scenario lookup and paced waiting. */
export abstract class Scripted {
  protected readonly scenario: Scenario;
  private readonly speed: number;

  /** `speed` divides every duration; `Infinity` means no waiting at all (tests). */
  constructor(scenario: Scenario, speed = 1) {
    this.scenario = scenario;
    this.speed = speed;
  }

  protected wait(ms: number): Promise<void> {
    return sleep(ms / this.speed);
  }

  protected routeOf(id: string): ScenarioRoute {
    const route = this.scenario.routes.find((r) => r.id === id);
    if (!route) throw new Error(`Route "${id}" is not part of scenario "${this.scenario.name}"`);
    return route;
  }
}
