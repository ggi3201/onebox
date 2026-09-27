<!--
Paste the section below into AGENTS.md or CLAUDE.md at the repo root.
Replace each <placeholder> with the command that discover.mjs found for this repo.
Delete lines for steps this repo does not have.
-->

## Verify before you say "done"

Passing tests are not done. Run the thing and quote the output.

Run these in order after every change. Stop at the first failure and fix it.

1. Lint: `<lint command>`
2. Types: `<typecheck command>` and `dotnet build <sln> -warnaserror`
3. Unit tests: `<unit test command>` (related tests first, then all)
4. Database tests: `<api test command>` (Testcontainers; Docker must run)
5. Bundle: `npx expo export --platform ios --output-dir <tmp-dir>` after
   import, config or dependency changes
6. Device: for any change a user can see, check it in the iOS Simulator.
   - First run the preflight (the `dev:test-loop` skill,
     `scripts/preflight.mjs`). The simulator must run THIS worktree's Metro.
     Fix every FAIL before you debug.
   - Metro port for this worktree: `<port command, e.g. scripts/metro-port.sh>`.
     Pass it to `expo start --port` and `expo run:ios --port`.
   - Added or changed a native package, a config plugin, a permission or an
     entitlement? Rebuild (`<ios build command>`). A reload is not enough.
   - Take a screenshot, read it, and put its path in your report.
   - Run the `*.flow.md` files in the feature folders you touched.
7. Bug fixes start red: a test that fails for the bug, then the fix.
   If the bug came from a data shape, add a seed row with a dated comment.

Report what you ran, with the result of each step. Put anything you could not
run under "Not verified", with the reason. Never write "fixed" or "works" for
something you did not see work. Never skip, delete or loosen a test to get
green.

Do not stop a Metro server, an API or a simulator that another checkout
started. Check its project root first.
