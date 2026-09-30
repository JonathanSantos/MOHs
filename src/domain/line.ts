/**
 * Scenarios of a line: each QUANDO/ENTÃO the belayer turns into tests. With a route, only the section headed by it
 * ("### C. Servidor HTTP", "## Route C"), when the line has one; otherwise the whole line.
 */
export function countScenarios(line: string | undefined, routeId?: string): number {
  const text = routeId ? (routeSection(line ?? "", routeId) ?? line) : line;
  return (text?.match(/\bQUANDO\b/g) ?? []).length;
}

function routeSection(line: string, routeId: string): string | null {
  const heading = new RegExp(`^(#{2,4})\\s+(?:route\\s+)?${routeId}(?:[.:)\\s-]|$)`, "im").exec(line);
  if (!heading) return null;
  const rest = line.slice(heading.index + heading[0].length);
  const next = new RegExp(`^#{1,${heading[1].length}}\\s`, "m").exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}
