// Server auth timing is opt-in for a local/development function only. Both
// guards must be present, so deployed production functions emit no stage logs.
const ENABLED = Deno.env.get("MUTHOY_ENVIRONMENT") === "development"
  && Deno.env.get("MUTHOY_AUTH_TIMING") === "1";

const CORRELATION_ID = /^[a-f0-9]{32}$/;

export interface ServerAuthTiming {
  mark(stage: string, outcome?: "ok" | "error"): void;
  measure<T>(stage: string, operation: () => Promise<T>): Promise<T>;
}

export function createServerAuthTiming(body: Record<string, unknown>): ServerAuthTiming | undefined {
  const correlationId = body._timingId;
  if (!ENABLED || typeof correlationId !== "string" || !CORRELATION_ID.test(correlationId)) {
    return undefined;
  }

  const startedAt = performance.now();
  let lastAt = startedAt;

  const write = (stage: string, durationMs: number, outcome: "ok" | "error") => {
    if (!ENABLED) return;
    const current = performance.now();
    console.info("[auth:timing]", {
      correlationId,
      stage,
      durationMs: Math.round(durationMs),
      totalMs: Math.round(current - startedAt),
      outcome,
    });
    lastAt = current;
  };

  return {
    mark(stage, outcome = "ok") {
      const current = performance.now();
      write(stage, current - lastAt, outcome);
    },
    async measure(stage, operation) {
      const stageStartedAt = performance.now();
      try {
        const result = await operation();
        write(stage, performance.now() - stageStartedAt, "ok");
        return result;
      } catch (error) {
        write(stage, performance.now() - stageStartedAt, "error");
        throw error;
      }
    },
  };
}

