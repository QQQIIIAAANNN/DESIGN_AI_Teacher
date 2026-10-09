/** Unicode61-compatible CJK bigrams, matching the existing knowledge-retrieval tokens(). */
export function lawTokens(input: string): string[] {
  const lower = input.toLowerCase();
  const latin = lower.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const han = lower.match(/[\u3400-\u9fff]+/g) ?? [];
  const grams = han.flatMap((run) => run.length <= 2 ? [run] :
    Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)));
  return [...new Set([...latin, ...grams])];
}
