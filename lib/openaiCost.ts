/**
 * Precios de OpenAI en USD por millón de tokens. Fuente: pricing público
 * de OpenAI. Si cambiás OPENAI_MODEL, agregá su precio acá — si el modelo
 * no está en la tabla, el costo de esa fila se calcula como $0 (mejor
 * subestimar a que la cuenta reviente por un modelo no contemplado).
 */
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
};

/**
 * Gasto en USD ya hecho en la cuenta de OpenAI ANTES de que se empezara a
 * guardar prompt_tokens/completion_tokens por pregunta (no hay forma de
 * reconstruir ese gasto pregunta por pregunta a posteriori). Es una
 * constante fija tomada a mano del dashboard de OpenAI (captura de
 * "Monthly spend" de la key "app-ure", 19 ago 2026) — no se actualiza
 * sola. El costo que se ve en /admin es esta base + lo trackeado desde
 * TRACKING_STARTED_AT en adelante.
 */
export const HISTORICAL_COST_USD_BASELINE = 0.29;
export const TRACKING_STARTED_AT = '2026-08-19';

export function estimateCostUsd(
  model: string,
  promptTokens: number | null,
  completionTokens: number | null
): number {
  if (promptTokens == null || completionTokens == null) return 0;
  const pricing = PRICING_PER_MILLION_TOKENS[model];
  if (!pricing) return 0;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}
