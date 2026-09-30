import type { FallReport, SendFailure } from "../crew/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import { findLeaks } from "../guards/leak.ts";
import type { ClimbSession } from "./session.ts";

const REDACTED = "[redigido pelo leak guard]";

/**
 * The belayer turns raw failures into a FALL: scenario, expected, actual. If the message quotes the sealed tests,
 * the belayer rewrites it once; if it still leaks, the scenario is redacted before anyone who implements reads it.
 */
export async function explainFall(
  session: ClimbSession,
  route: PlannedRoute,
  failures: readonly SendFailure[],
  retrying: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<FallReport> {
  const sealedCode = session.sealedCode.get(route.id) ?? "";
  const sealed = session.sealed.get(route.id) ?? { files: [], unit: 0, e2e: 0 };
  const observer = session.observerFor({ route: route.id });
  const leaksIn = (report: FallReport) => findLeaks(`${report.scenario} ${report.expected} ${report.actual}`, sealedCode);
  const explain = (leaked?: string[]) =>
    retrying(() => session.crew.explainFall(route, failures, { notes: session.notes(route.id), sealed, leaked, observer }));

  let report = await explain();
  const leaked = leaksIn(report);
  if (leaked.length) {
    session.journal.friction("leak.blocked", `a FALL copiava trechos do seal (${leaked.length}); o belayer reescreveu`, {
      route: route.id,
    });
    report = await explain(leaked);
    if (leaksIn(report).length) report = { ...report, scenario: REDACTED };
  }
  return report;
}
