# Self-hosted GitHub Actions runner

The box skills deploy with `runs-on: self-hosted`. The runner lives on the box,
so a deploy is a local `docker build` and `docker compose up`. No registry, no
SSH key in GitHub, no inbound port.

## Risks first

- **Private repos only.** A runner on your box is for a private repo. GitHub
  says the same. Your own workflows' triggers do not protect a public repo: a
  pull request runs the workflow files from the pull request, so a fork can
  add its own workflow with `runs-on: [self-hosted, box]`. Once one of a
  person's pull requests is merged, GitHub runs their next ones without asking
  you.
- **The runner user is in the `docker` group. That is root on the box.** Any
  job that reaches the runner can read every `.env`, the tunnel credentials
  and the Traefik token. A separate user for the runner does not change that.
- **A public app repo gets no runner.** Deploy it by hand on the box
  (`docker compose up -d`), or from a GitHub-hosted runner over Tailscale or
  SSH. If a repo with a runner goes public, remove the runner first (below).
- **Still never add `pull_request`** to a workflow that runs on the box. Use
  `push` to your branches and `workflow_dispatch`.
- **One runner runs one job at a time.** A repo's `ci.yml` and its deploy wait
  for each other. Give each deploy its own `concurrency.group`.

## Scope: repo or organization

On a personal account a runner belongs to one repo. Each repo that deploys
needs its own runner (one directory each on the box). A free GitHub
organization lets one runner serve all its repos. Pick one before you register.

An organization's runner group must not allow public repositories. That is
the default. Check it:

```bash
gh api orgs/<org>/actions/runner-groups --jq '.runner_groups[] | "\(.name) public=\(.allows_public_repositories)"'
```

## Register (repo scope)

On your Mac, check that the repo is private. Stop if this prints `false`:

```bash
REPO=owner/myapp
gh api "repos/$REPO" --jq .private
```

Then get a registration token. It expires after one hour.

```bash
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
gh api "repos/$REPO" --jq .private          # must print true
gh api "repos/$REPO/actions/runners" --jq '.runners[] | "\(.name) \(.status) \(.busy)"'
ssh user@host 'systemctl list-units "actions.runner.*" --no-legend'
```

## Remove

Before a repo goes public, or when it stops deploying to the box. On your Mac:

```bash
TOKEN=$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)
printf '%s' "$TOKEN" | ssh user@host "
  set -e
  cd ~/actions-runner-myapp
  sudo ./svc.sh stop && sudo ./svc.sh uninstall
  ./config.sh remove --token \"\$(cat)\""
```

Then delete the folder on the box, and check that the runner list above is
empty.
