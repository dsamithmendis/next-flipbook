# Contributing

Thanks for helping. Please open an issue before starting large changes.

## Setup

```bash
npm install
npm run lint
npm run typecheck:all
npm test
npm run dev        # builds the package and starts the demo
```

Node 22.13 or newer (the PDF tests run the real pdfjs-dist, which requires it; the published package itself has no Node requirement).

## Ground rules

- Strict TypeScript. No `any`, no `@ts-ignore`.
- Keep the engine free of React and the DOM. Browser globals are only read inside functions, never at module load.
- Every new user-visible string goes through `FlipBookLocale`.
- Add a test for behaviour you add or fix. Engine logic is tested with the fake scheduler in `tests/helpers`.
- Every dependency needs a reason. Prefer native Web APIs.
- Public APIs get JSDoc.

## Pull requests

Keep changes focused, update `CHANGELOG.md` under *Unreleased*, and make sure these pass (CI runs them):

```bash
npm run lint
npm run typecheck:all
npm test
npm run verify:pack
npm run build:demo && npm run e2e
```

For a change to how the viewer looks, also run `npm run e2e:visual`, look at what differs, and commit new screenshots with `npm run e2e:visual:update` only if the difference is what you meant. See [docs/testing.md](docs/testing.md).

Lint rules are turned off in `eslint.config.mjs` with a reason beside them, not with inline comments. A test for a bug fix should fail on the old code before it passes on the new.

## Releasing

Maintainers: bump `version` in `packages/flipbook/package.json`, move the *Unreleased* notes to a new `## [x.y.z]` section in `CHANGELOG.md`, commit, then `git tag vx.y.z && git push origin vx.y.z`. The Release workflow checks the tag against the version and the changelog, runs the checks, and publishes with provenance. A version with a hyphen (`0.8.0-beta.1`) goes out under the `next` tag. It needs an `NPM_TOKEN` secret.
