import { createLogger } from '@vprprudhvi/shared-logger';

import { loadConfig } from '../src/config.js';
import type { Config } from '../src/config.js';

/** Test helper: a config with a fixed version and optional overrides. */
export function makeTestConfig(source: Readonly<Record<string, string | undefined>> = {}): Config {
  return loadConfig({ SAMPLE_FULLSTACK_API_VERSION: '9.9.9', ...source });
}

/** Test helper: a logger that collects each JSON line. */
export function makeCollectingLogger(): {
  logger: ReturnType<typeof createLogger>;
  lines: () => Record<string, unknown>[];
} {
  const raw: string[] = [];
  const logger = createLogger({
    serviceName: 'test',
    level: 'debug',
    destination: {
      write: (line: string): void => {
        raw.push(line);
      },
    },
  });
  return {
    logger,
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
