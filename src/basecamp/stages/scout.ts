import { isRigged, type PlannedRoute } from "../../domain/plan.ts";
import { maxHardness, type Hardness } from "../../domain/types.ts";
import { ClimbAborted, type ClimbSession } from "../session.ts";
import { climbLevelWork } from "./crew-errors.ts";
import type { Stage } from "./stage.ts";

/** Plans routes and pitches, and sizes the O₂ cylinder from each route's hardness. */
export const scoutStage: Stage = {
  name: "scout",
  appliesTo: () => true,

  async run(session: ClimbSession) {
    const { crew, config, journal, forcedHardness, survey } = session;
    if (session.resume?.plan) {
      session.plan = session.resume.plan;
      return;
    }
    if (forcedHardness === "talc") return planTalc(session);
    journal.record("scout.started", {}, { actor: "scout" });
    const scouted = await climbLevelWork(session, "scout", () =>
      crew.scout(session.request, survey, { observer: session.observerFor(), solo: session.solo }),
    );
    const routes = scouted.routes.map((route) => (forcedHardness ? { ...route, hardness: forcedHardness } : route));
    const forced = scouted.routes.filter((route) => forcedHardness && route.hardness !== forcedHardness);
    const hardnessBudget = config.settings.hardness;

    const hardness = maxHardness(routes.map((route) => route.hardness));
    // A line do scout vale em fluorite e, no solo, em qualquer hardness: o mesmo agente escreveria a do setter.
    const keepsLine = hardness === "fluorite" || session.solo;
    const scoutLine = keepsLine ? { line: scouted.line, decisions: scouted.line ? scouted.decisions : undefined } : {};
    const intent = scouted.intent ?? "feature";
    session.plan = { kind: survey.kind, hardness, intent, routes, ...scoutLine };
    journal.record(
      "scout.hardness",
      {
        kind: survey.kind,
        hardness: session.plan.hardness,
        intent,
        reason: scouted.reason,
        budget: routes.reduce((sum, route) => sum + hardnessBudget[route.hardness].o2, 0),
        routes: routes.map((route) => ({ ...route, budget: hardnessBudget[route.hardness].o2 })),
      },
      { actor: "scout", o2: scouted.o2 },
    );
    for (const route of forced) {
      journal.record(
        "scout.escalated",
        { from: route.hardness, to: forcedHardness!, reason: "definida pelo humano (--hardness)" },
        { actor: "human", route: route.id },
      );
    }
    assertCrewCanClimb(
      session.plan.routes.map((route) => ({ id: route.id, hardness: route.hardness })),
      crew.supportedHardness,
    );
    // Sem saber rodar um teste selado, não há seal nem send: melhor parar antes de a line ser escrita.
    const problem = session.plan.routes.some(isRigged) ? session.runner.riggingProblem?.(survey) : null;
    if (problem) throw new ClimbAborted(problem, "basecamp");
  },
};

/**
 * A talc fix (`mohs fix`) has no scout: the Basecamp plans one route with one pitch by rule, and the climber decides
 * which files to touch. What keeps it small is checked on the result (the talc bounds), not guessed up front.
 */
function planTalc(session: ClimbSession): void {
  const { journal, survey, request, config } = session;
  journal.record("scout.started", {}, { actor: "basecamp" });
  const summary = request.trim().split("\n")[0];
  const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
  const route: PlannedRoute = {
    id: "A",
    name: cut(summary, 80),
    hardness: "talc",
    files: [],
    tags: [],
    pitches: [{ title: cut(summary, 120), files: [] }],
  };
  session.plan = { kind: survey.kind, hardness: "talc", routes: [route] };
  const budget = config.settings.hardness.talc.o2;
  journal.record(
    "scout.hardness",
    {
      kind: survey.kind,
      hardness: "talc",
      reason: "correção pequena (talc): sem scout nem line; o climber decide o escopo e lista as decisões, e o humano assina no fim",
      budget,
      routes: [{ ...route, budget }],
    },
    { actor: "basecamp" },
  );
}

/** The task crew grows phase by phase; a route beyond what it can do stops the climb with a clear reason. */
function assertCrewCanClimb(routes: { id: string; hardness: Hardness }[], supported: readonly Hardness[] | undefined): void {
  if (!supported) return;
  const beyond = routes.filter((route) => !supported.includes(route.hardness));
  if (!beyond.length) return;
  const list = beyond.map((route) => `${route.id} (${route.hardness})`).join(", ");
  throw new ClimbAborted(
    `a equipe desta versão conduz só ${supported.join(", ")}; o scout pediu mais para ${list}. Divida o pedido, force com --hardness fluorite ou simule com --crew fake.`,
    "basecamp",
  );
}
