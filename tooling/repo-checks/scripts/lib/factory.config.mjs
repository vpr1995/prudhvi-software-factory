// Settings of scripts/factory.mjs. Lint allows process.env only in config files.

/** Project board of the factory (design 4.5). The script finds field and option IDs by name. */
export const BOARD = { owner: 'vpr1995', number: '2', statusField: 'Status' };

/** @returns {boolean} True when `FACTORY_RUN=off` is set in the environment (R-4). */
export const isRunOff = () => process.env.FACTORY_RUN?.trim().toLowerCase() === 'off';
