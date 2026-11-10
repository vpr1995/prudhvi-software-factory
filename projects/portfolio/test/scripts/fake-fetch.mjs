// A test-only preload for `node --import`. It replaces the global fetch with the routes in the
// `fake-fetch.json` file of the working folder, so the CLI test makes no network call. A route is a
// text (a 200 response) or an object with a status and a body.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync('fake-fetch.json', 'utf8'));

globalThis.fetch = (url) => {
  const route = table[url];
  if (route === undefined) {
    return Promise.reject(new Error(`No route for ${url} in the CLI test.`));
  }
  const { status, body } = typeof route === 'string' ? { status: 200, body: route } : route;
  return Promise.resolve(new Response(body, { status }));
};
