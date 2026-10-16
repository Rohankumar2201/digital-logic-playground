# Contributing to Digital Logic Playground

Thanks for your interest in improving the project. Bug reports, fixes, new components and documentation improvements are all welcome.

## Ways to contribute

- **Report a bug.** Open an issue with the steps to reproduce, what you expected, what happened, your browser, and (if possible) the exported circuit `.json`.
- **Suggest a feature.** Open an issue describing the problem it solves before writing a large change, so we can agree on the approach first.
- **Send a pull request.** Small, focused changes are easiest to review.

## Development setup

Requires Node.js 18 or newer.

```bash
git clone https://github.com/<your-username>/digital-logic-playground.git
cd digital-logic-playground
npm install
npm run dev      # dev server with hot reload
npm test         # run the test suite
npm run build    # type-check and production build
```

## Workflow

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b feature/short-description
   ```
2. Make your change, adding or updating tests.
3. Run `npm test` and `npm run build`. Both must pass.
4. Commit with a clear message in the imperative mood, for example `Add 3-input AND gate` or `Fix undo after clearing all`.
5. Push your branch and open a pull request describing what changed and why.

## Project conventions

**Keep the simulator free of React.** Everything under `src/simulator/` and `src/utils/` is plain TypeScript. UI components draw state and forward events; behaviour belongs in testable functions.

**Never mutate a `Circuit`.** Return a new object. Undo and redo depend on old snapshots staying unchanged.

**Route edits through `commitEdit`.** Any change a user would expect to undo must go through `commit` in `src/simulator/edit.ts`, which validates the result, settles the simulation and records history. Use `preview` only for in-progress gestures such as dragging.

**Validate before changing state.** Imported data is untrusted. Check it before it replaces the current circuit, and reject bad input instead of silently repairing it.

**TypeScript strict mode is on.** Avoid `any` and non-null assertions unless there is no reasonable alternative.

**Match the existing style.** Small functions, short descriptive names, and comments only where the reason is not obvious from the code.

## Adding a new component

Most components take four small edits:

1. **`src/types.ts`**: add the new id to the `TypeId` union.
2. **`src/simulator/components.ts`**: register it with `gate()`, `ff()`, `block()` or `add()`, giving its pin names and an `eval` function. Sequential parts also need a `next` function.
3. **`src/simulator/components.ts`**: add it to the right group in `groups` so it appears in the sidebar.
4. **`src/tests/simulator.test.ts`**: add a test that checks every input combination (or the clocked behaviour) against the expected outputs.

The canvas, side panel, truth tables, validation and file loading read from the definition table, so they pick the new component up automatically. If it needs special drawing, adjust `src/components/Canvas.tsx`.

## Tests

Tests use [Vitest](https://vitest.dev) and live in `src/tests/`.

- Fix a bug by first writing a test that fails because of it.
- Test logic directly, not through the UI. This is why the simulator and interaction code are plain functions.
- Do not delete or weaken an existing test to make a change pass without explaining why in the pull request.

## Pull request checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes with no TypeScript errors
- [ ] New behaviour has tests
- [ ] Undo and redo still work for any new edit
- [ ] README updated if behaviour or usage changed
- [ ] The change is focused on one thing

## Code of conduct

Be respectful and constructive. Assume good intent, give specific feedback on code rather than people, and help newcomers learn. Harassment or discrimination of any kind is not acceptable.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
