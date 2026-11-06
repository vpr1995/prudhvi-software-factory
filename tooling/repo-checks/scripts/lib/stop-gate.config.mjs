// Env access for scripts/stop-gate.mjs. Lint allows process.env only in config files.

/** @returns {{ FACTORY_STOP_GATE: string | undefined }} The env values that the gate reads. */
export function gateEnvironment() {
  return { FACTORY_STOP_GATE: process.env.FACTORY_STOP_GATE };
}
