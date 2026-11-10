# Runbook: change the portfolio content

This runbook is for the owner. It covers the portfolio in `projects/portfolio/`. Run each command from the folder `projects/portfolio/` unless a step says otherwise.

## Preview

1. Run `npm run dev:web`.
2. Open the local address that the command prints.
3. Check the page. Stop the server with Ctrl+C.

## Edit content

1. Open `content/portfolio.json`.
2. Change the values. Keep the JSON shape.
3. Run `npm run dev:web` and check the page.

The build reads `content/portfolio.json` only. There is no resume file in the repo. Do not add one.

When a value is wrong, the build fails. The error names the JSON path and the rule that the value breaks. Fix the value and run the build again.

A phone number belongs in `contact.phone` only. The build rejects a phone-like string in any other field. Do not add a phone number to the text of an article, a role, or a bullet.

## Refresh feeds

The feeds are in `content/feeds.json`. The Medium articles and the GitHub repositories come from this file.

To refresh the feeds now, run `npm run fetch-feeds`. The script writes `content/feeds.json` only when the items change.

The workflow `.github/workflows/portfolio-feeds.yml` also refreshes the feeds each week. It starts from `main` and opens a pull request from the branch `feeds/weekly` when `content/feeds.json` changes. A second run updates the same pull request. Checks do not start on a pull request that GitHub Actions opens, so close and reopen it. Review the pull request. Merge it to publish the new items.

If a feed fails, the pull request still has the feed that worked, and the job ends red. GitHub sends you an email.

To test a failing feed, run the workflow by hand and set the input `handle` to a Medium handle that does not exist. The script reads it from the variable `FEEDS_MEDIUM_HANDLE`. Leave the input empty for a normal run.

## Deploy

Run `npm run deploy:cloudflare` to deploy the site. This command is added in a later change. It is not in `package.json` yet.

Agents do not deploy. Only the owner runs the deploy command.

A merge to `main` also starts the deploy workflow. The workflow runs the smoke test after the deploy.

## Smoke

Run the smoke test against the live site:

```sh
SMOKE_BASE_URL=https://portfolio.vprprudhvi.dev npm run smoke
```

The test passes when the page shows the headline, the experience section, the Writing and Open source sections with items, and the security headers.

## Roll back

To roll back a deploy, follow [rollback.md](rollback.md). Do not use this runbook for a rollback.

## Chat flag

The chat is off in version 1. Keep `FLAG_PORTFOLIO_CHAT` unset or set it to `false`. Only version 2 of the chat uses this flag.
