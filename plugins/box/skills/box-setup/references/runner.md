# Self-hosted GitHub Actions runner

The box skills deploy with `runs-on: self-hosted`. The runner lives on the box,
so a deploy is a local `docker build` and `docker compose up`. No registry, no
SSH key in GitHub, no inbound port.

## Risks first

- **The runner user is in the `docker` group. That is root on the box.** Any
  workflow that runs on it can do anything.
- **Public repo: never let a `pull_request` workflow reach this runner.** A
  fork's pull request could run its code on your box. GitHub recommends
  self-hosted runners for private repos only. If the repo is public, make sure
  every workflow with `runs-on: self-hosted` triggers only on `push` to your
  branches and on `workflow_dispatch`.
- **One runner runs one job at a time.** A repo's `ci.yml` and its deploy wait
  for each other. Give each deploy its own `concurrency.group`.

## Scope: repo or organization

On a personal account a runner belongs to one repo. Each repo that deploys
needs its own runner (one directory each on the box). A free GitHub
organization lets one runner serve all its repos. Pick one before you register.

## Register (repo scope)

On your Mac, get a registration token. It expires after one hour.

```bash
REPO=owner/myapp
LABEL=$(cfg | jq -r '.box.runnerLabel // "box"')     # cfg() as in SKILL.md
TOKEN=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)
URL=$(gh api repos/actions/runner/releases/latest \
  --jq '.assets[] | select(.name | test("actions-runner-linux-x64-[0-9.]+\\.tar\\.gz$")) | .browser_download_url')
```

On the box, as the admin user (not root):

```bash
printf '%s' "$TOKEN" | ssh user@host "
  set -e
  mkdir -p ~/actions-runner-myapp && cd ~/actions-runner-myapp
  curl -fsSL -o runner.tgz '$URL' && tar xzf runner.tgz && rm runner.tgz
  ./config.sh --unattended --url https://github.com/$REPO --token \"\$(cat)\" \
    --name \$(hostname)-myapp --labels $LABEL --replace
  sudo ./svc.sh install \$USER && sudo ./svc.sh start"
```

For an organization, use `orgs/<org>/actions/runners/registration-token` and
`--url https://github.com/<org>`.

## Use it

```yaml
runs-on: [self-hosted, box]      # box = your box.runnerLabel
```

GitHub reads the workflow file, not the onebox config. When a skill copies a
workflow template, it writes the value of `box.runnerLabel` into `runs-on`.

The runner checks the repo out under `~/actions-runner-*/_work/`. That copy is
**disposable**: the next run replaces it. Never fix a deploy by editing files
there. Commit to the repo.

## Check

```bash
gh api "repos/$REPO/actions/runners" --jq '.runners[] | "\(.name) \(.status) \(.busy)"'
ssh user@host 'systemctl list-units "actions.runner.*" --no-legend'
```
