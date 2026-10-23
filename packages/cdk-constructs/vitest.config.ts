import { createVitestConfig } from '@vprprudhvi/tooling-vitest-config';

// CDK synth is CPU-heavy. Under the parallel Stop-gate verify, 5000 ms is too short (owner decision
// 2026-10-23, bl-cdk-test-load).
const CDK_SYNTH_TEST_TIMEOUT_MS = 30_000;

export default createVitestConfig({ testTimeout: CDK_SYNTH_TEST_TIMEOUT_MS });
