/** Only substitute within the requested Claude family; never switch providers silently. */
export function compatibleClaudeModel(requested: string, models: string[]) {
  const family = requested.match(/^claude-(opus|sonnet|haiku)(?:-|$)/i)?.[1]?.toLowerCase();
  if (!family) return undefined;
  return models.filter((id) => id !== requested && id.toLowerCase().startsWith(`claude-${family}-`))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}
export function selectConnectedModel(requested: string, models: string[]) {
  if (!requested) return models[0];
  return models.includes(requested) ? requested : compatibleClaudeModel(requested, models);
}
