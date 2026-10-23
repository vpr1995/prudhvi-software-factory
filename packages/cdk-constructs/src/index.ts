export {
  PLATFORM_ENVS,
  PLATFORM_PARAMETER_PATHS,
  allPlatformParameterNames,
  isPlatformEnv,
  platformParameterName,
  platformParameterNames,
} from './platform-parameters.js';
export type {
  PlatformEnv,
  PlatformParameterKey,
  PlatformParameterNames,
} from './platform-parameters.js';
export { readPlatformResources } from './platform-resources.js';
export type { PlatformResources } from './platform-resources.js';
export {
  ADOT_COLLECTOR_LAYER_ARN,
  OTEL_COLLECTOR_ENDPOINT,
  OTEL_PROPAGATORS_VALUE,
  OTEL_SAMPLER_ARG_NON_PROD,
  OTEL_SAMPLER_ARG_PROD,
  OTEL_TRACES_SAMPLER_VALUE,
  RESERVED_ENVIRONMENT_KEYS,
  TracedFunction,
} from './traced-function.js';
export type { TracedFunctionProps } from './traced-function.js';
