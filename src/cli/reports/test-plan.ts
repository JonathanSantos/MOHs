import { describeBuiltInSeal } from "../../runner/seal-runners.ts";
import { TEST_OPTIONS, type TestOption, type TestPlan } from "../scaffold/test-plan.ts";
import { ink } from "../terminal.ts";

export interface ConfiguredSeal {
  seal?: string;
  sealE2e?: string;
}

/**
 * The project's test plan for people: what sealed tests run with now, what is recommended for this stack and how to
 * switch. Nothing is installed here; installing a runner is a change like any other.
 */
export function testPlanLines(plan: TestPlan, configured: ConfiguredSeal, switchHint: (option: TestOption) => string): string[] {
  const label = (seal: string | undefined) =>
    Object.values(TEST_OPTIONS as Record<string, TestOption>).find((option) => option.seal === seal)?.label ?? "definido no mohs.yaml";
  const lines = [
    `  testes      ${plan.testFiles} arquivo(s) de teste no projeto · stack ${plan.stack}`,
    configured.seal
      ? `  seal        ${configured.seal} ${ink.dim(`(${label(configured.seal)})`)}`
      : plan.current
        ? `  seal        ${ink.dim(`nenhum no mohs.yaml: cada arquivo roda pela extensão (${describeBuiltInSeal()})`)}`
        : `  seal        ${ink.warn('nenhum: defina commands.seal (ex.: "go test {file}"); sem isso, quartz e diamond param')}`,
  ];
  const { recommended } = plan;
  if (recommended && recommended.seal !== configured.seal) {
    lines.push(`  recomendado ${ink.bold(recommended.label)}: ${recommended.why}. ${switchHint(recommended)}`);
  }
  const others = plan.alternatives.filter((option) => option.seal !== configured.seal);
  if (others.length) lines.push(`  outras      ${others.map((option) => `${option.label} (--tests ${option.id})`).join(" · ")}`);
  const e2e = plan.e2e?.recommended;
  if (configured.sealE2e) lines.push(`  e2e         ${configured.sealE2e}`);
  else if (e2e) lines.push(`  e2e         ${ink.dim(`recomendado ${e2e.label}: ${e2e.why}. ${switchHint(e2e)}`)}`);
  if (!plan.testFiles) {
    lines.push(
      ink.dim("  O projeto não tem testes: os testes selados do belayer serão a única prova de comportamento, e a evidência chega no máximo a média."),
    );
  }
  return lines;
}

/** How to adopt an option: install it (when the stack does not have it) and point the seal at it. */
export function adoptHint(option: TestOption, how: string): string {
  return option.install ? `Para usar: ${option.install} e ${how}.` : `Para usar: ${how}.`;
}
