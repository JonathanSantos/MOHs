import type { RackItem } from "../../config/types.ts";
import type { PlannedRoute } from "../../domain/plan.ts";
import type { FixReason } from "../../domain/types.ts";
import type { Crew, DisputeVerdict, FallReport, PitchResult, SendFailure } from "../../crew/types.ts";
import type { Croqui } from "../../domain/croqui.ts";
import { Scripted } from "./scripted.ts";

/** Simulated durations (ms) and token spend per role, tuned to look plausible in the Lookout. */
const COST = {
  scout: { ms: 900, o2: 6_000 },
  line: { ms: 1_500, o2: 24_000 },
  bolts: { ms: 900, o2: 9_000 },
  seal: { ms: 1_200, o2: 30_000 },
  fix: { ms: 2_200, o2: { fall: 38_000, inspection: 52_000, integration: 30_000 } },
  fall: { ms: 600, o2: 4_000 },
  inspect: { ms: 1_800, o2: 22_000 },
  descent: { ms: 1_400, o2: 18_000 },
} as const;

/**
 * Phase 1 crew: follows a scripted scenario so the Basecamp, the state machine and
 * the Lookout can run end to end without calling any model.
 */
export class FakeCrew extends Scripted implements Crew {
  async scout() {
    await this.wait(COST.scout.ms);
    const { reason, routes, line } = this.scenario;
    return {
      o2: COST.scout.o2,
      reason,
      // Um climb só de fluorite recebe a line junto com o plano, como faria um scout de verdade.
      line: routes.every((route) => route.hardness === "fluorite") ? line : undefined,
      routes: routes.map(({ id, name, hardness, files, tags, pitches }) => ({
        id,
        name,
        hardness,
        files,
        tags,
        pitches: pitches.map(({ title, files: pitchFiles, crux }) => ({ title, files: pitchFiles, crux })),
      })),
    };
  }

  async writeLine() {
    await this.wait(COST.line.ms);
    return { o2: COST.line.o2, text: this.scenario.line, decisions: this.scenario.decisions };
  }

  async setBolts(route: PlannedRoute) {
    await this.wait(COST.bolts.ms);
    return { o2: COST.bolts.o2, text: `# Bolts · route ${route.id}\n\n${route.files.map((file) => `- ${file}`).join("\n")}\n` };
  }

  async seal(route: PlannedRoute) {
    await this.wait(COST.seal.ms);
    const { unit, e2e, code } = this.routeOf(route.id).seal ?? { unit: 1, e2e: 0, code: "" };
    return { o2: COST.seal.o2, unit, e2e, files: [{ path: `sealed/${route.id}.spec.ts`, content: code, kind: "unit" as const }] };
  }

  async climbPitch(route: PlannedRoute, pitch: number): Promise<PitchResult> {
    const { ms, o2, summary, friction, rock, watch } = this.routeOf(route.id).pitches[pitch - 1];
    await this.wait(ms);
    if (watch) return { outcome: "watch", o2, friction, ...watch };
    return { outcome: "safe", o2, summary, friction, rock };
  }

  async fix(_route: PlannedRoute, reason: FixReason) {
    await this.wait(COST.fix.ms);
    const summary = reason === "fall" ? "exportação usa a largura lógica da tela" : "achados bloqueantes corrigidos";
    return { o2: COST.fix.o2[reason], outcome: "safe" as const, summary };
  }

  async drawCroqui() {
    await this.wait(COST.scout.ms);
    const files = this.scenario.routes.flatMap((route) => route.files);
    const croqui: Croqui = {
      purpose: `Projeto do cenário ${this.scenario.name}: ${this.scenario.request}`,
      entities: files.slice(0, 3).map((file) => ({ name: file.split("/").at(-1) ?? file, where: file, what: "parte do fluxo do cenário" })),
      sensitive: [],
      pitfalls: [],
      sections: [],
    };
    return { o2: COST.scout.o2, croqui };
  }

  async judgeDispute(): Promise<DisputeVerdict> {
    await this.wait(COST.fall.ms);
    return { o2: COST.fall.o2, verdict: "uphold", reason: "a line pede exatamente esse comportamento" };
  }

  async explainFall(route: PlannedRoute, failures: readonly SendFailure[], context: { leaked?: string[] }): Promise<FallReport> {
    await this.wait(COST.fall.ms);
    const scripted = this.routeOf(route.id);
    const first = scripted.sendFails?.flat().find((failure) => failure.test === failures[0]?.test);
    if (!first) throw new Error(`Scenario "${this.scenario.name}" has no scripted failure for ${failures[0]?.test}`);
    // O primeiro rascunho do cenário copia o teste selado de propósito: o leak guard precisa pegar.
    const scenario = scripted.leakyFall && !context.leaked ? (scripted.seal?.code.slice(0, 90) ?? first.scenario) : `Ao ${first.scenario}`;
    return { o2: COST.fall.o2, scenario, expected: first.expected, actual: first.actual };
  }

  async inspect(route: PlannedRoute, inspector: RackItem, round: number) {
    await this.wait(COST.inspect.ms + inspector.name.length * 120);
    return { o2: COST.inspect.o2, findings: this.routeOf(route.id).inspections?.[round - 1]?.[inspector.name] ?? [] };
  }

  async descent() {
    await this.wait(COST.descent.ms);
    return { o2: COST.descent.o2, proposals: this.scenario.proposals };
  }
}
