Fixes #

## What

<!-- What changed, in a few plain sentences. -->

## Checked

<!-- What you ran, with the key output. A skill change needs a real run. -->

- [ ] `node scripts/versions.mjs check` (a changed plugin has a new version)
- [ ] `(cd site && npm ci && npm run build)`
- [ ] `bash site/scripts/example-plan.sh` leaves `example-plan.md` unchanged, or the change is intended
- [ ] `bash scripts/plan-notes-check.sh`
- [ ] `bash scripts/features-check.sh`
- [ ] `bash scripts/plan-protect-check.sh`
- [ ] No personal values in the diff or here: `bash scripts/personal-values-check.sh` prints "ok"
