import type { PlannedRoute } from "../../domain/plan.ts";
import type { SurveyResult } from "../../survey/survey.ts";
import type {
  AnchorResult,
  AnchorVerify,
  Delivery,
  ExecResult,
  IntegrationMerge,
  Runner,
  RouteWorkspace,
  SendResult,
} from "../../crew/types.ts";
import { Scripted } from "./scripted.ts";

const DURATION_MS = { survey: 700, anchor: 500, sealRed: 400, send: 1_400 } as const;
const DEFAULT_CHECKS = ["typecheck", "lint", "testes do climber"];

/** Simulated command runner: anchors and sends pass or fail as the scenario scripts them. */
export class FakeRunner extends Scripted implements Runner {
  private commits = 0;

  async survey(): Promise<SurveyResult> {
    await this.wait(DURATION_MS.survey);
    return { kind: this.scenario.kind, ...this.scenario.survey };
  }

  async prepare(): Promise<RouteWorkspace> {
    return { path: "(simulado)" };
  }

  async prepareSeal(): Promise<RouteWorkspace> {
    return { path: "(simulado)" };
  }

  async diff(): Promise<string> {
    return "";
  }

  async head(route: PlannedRoute): Promise<string> {
    return fakeCommit(`${route.id}:head:${this.commits}`);
  }

  async finish(): Promise<Delivery> {
    return {};
  }

  async anchor(
    route: PlannedRoute,
    pitch: number,
    attempt: number,
    commands: readonly string[],
    verify?: AnchorVerify,
  ): Promise<AnchorResult> {
    await this.wait(DURATION_MS.anchor);
    const failuresBeforePass = this.routeOf(route.id).pitches[pitch - 1]?.anchorFails ?? 0;
    const checks = commands.length ? [...commands] : DEFAULT_CHECKS;
    if (attempt <= failuresBeforePass) return { ok: false, checks, output: `${checks.at(-1)}: 1 teste falhou` };
    const problem = await verify?.((command) => this.exec(route, command));
    if (problem) return { ok: false, checks, output: problem };
    return { ok: true, checks, commit: fakeCommit(`${route.id}:${pitch}:${++this.commits}`) };
  }

  async integrate(route: PlannedRoute): Promise<IntegrationMerge> {
    await this.wait(DURATION_MS.anchor);
    return { ok: true, commit: fakeCommit(`merge:${route.id}`) };
  }

  async deliveryWorkspace(): Promise<RouteWorkspace> {
    return { path: "(simulado)" };
  }

  async anchorDelivery(): Promise<AnchorResult> {
    return { ok: true, checks: DEFAULT_CHECKS };
  }

  async sendDelivery(): Promise<SendResult> {
    await this.wait(DURATION_MS.send);
    const total = this.scenario.routes.reduce((sum, route) => sum + (route.seal?.unit ?? 0) + (route.seal?.e2e ?? 0), 0);
    return { ok: true, total, failures: [] };
  }

  async finishDelivery(): Promise<Delivery> {
    return {};
  }

  async exec(_route: PlannedRoute, _command: string): Promise<ExecResult> {
    return { code: 0, output: "" };
  }

  async sealRed() {
    await this.wait(DURATION_MS.sealRed);
    return { allRed: true, passing: [] };
  }

  async send(route: PlannedRoute, attempt: number): Promise<SendResult> {
    await this.wait(DURATION_MS.send);
    const scripted = this.routeOf(route.id);
    const failures = (scripted.sendFails?.[attempt - 1] ?? []).map(({ test, scenario, expected, actual }) => ({
      test,
      output: `${scenario}: esperado ${expected}, obtido ${actual}`,
    }));
    return { ok: failures.length === 0, total: (scripted.seal?.unit ?? 0) + (scripted.seal?.e2e ?? 0), failures };
  }
}

/** Short, stable, git-looking hash (FNV-1a) so simulated commits read like real ones. */
function fakeCommit(seed: string): string {
  let hash = 0x811c9dc5;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}
