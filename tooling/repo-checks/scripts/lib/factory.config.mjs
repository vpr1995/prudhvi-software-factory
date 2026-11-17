// Settings of scripts/factory.mjs. Lint allows process.env only in config files.
// No state command reads the environment yet. A later command reads FACTORY_RUN here.

/** Project board of the factory (design 4.5). The script finds field and option IDs by name. */
export const BOARD = { owner: 'vpr1995', number: '2', statusField: 'Status' };
