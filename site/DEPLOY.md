# Deploying the site

The site (`site/`) is static. It runs on Cloudflare Pages as a Direct Upload
project named `onebox`, on `https://onebox.lokkesveen.com`. Its DNS record is a
proxied CNAME to the project's `pages.dev` name.

The guides in `../guides/` are part of the site. **A change to a guide is not
live until you deploy.** Skills fetch the guides from this site.

## Deploy by hand

```bash
cd site
npm ci && npm run build
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> \
  npx --no-install wrangler pages deploy dist --project-name onebox --branch main
```

The token needs one permission: Account, Cloudflare Pages, Edit. Read it from
your secrets tool. Never put it in the repo or in a command you share.

wrangler is pinned in `package.json` (a dev dependency), so `npm ci` installs
it before the token is in the environment. `--no-install` makes `npx` use that
copy and never fetch another. To update it: `npm install --save-dev
--save-exact wrangler@<version>` in `site/`, in its own PR.

## Check it

```bash
for p in / /guides/xcode/ /guides/xcode.md /llms.txt; do
  curl -sS -o /dev/null -w "$p %{http_code} %{content_type}\n" https://onebox.lokkesveen.com$p
done
```

Every line must be 200. The `.md` and `llms` files are `text/plain`, set in
`public/_headers`.

## Deploy on merge

`.github/workflows/deploy-site.yml` builds the site on every PR that changes
the guides, a `SKILL.md`, the plan catalog or `site/`. After a merge to `main`
it also deploys. A skill's description is on the site too, so those changes
count.

It needs two repository secrets. Without them the deploy step on `main`
fails, so a green run always means the site went live. After the deploy it
checks that a made-up path answers 404 (`site/src/pages/404.astro`).

### Set it up once

1. In Cloudflare, make a new API token (My Profile, API Tokens, Create Token,
   Create Custom Token) with one permission: **Account, Cloudflare Pages,
   Edit**. Limit it to your account. Give it a name like `onebox-pages-deploy`.
   Do not use a temporary token.
2. Copy your account ID from the Cloudflare dashboard (the right side of the
   account home page, or the number in the dashboard address).
3. Add both as repository secrets, from the repository folder:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo ggi3201/onebox
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo ggi3201/onebox
   ```

   Each command asks for the value. Paste it, and press Enter.
4. Run the workflow once to prove it: Actions, Deploy site, Run workflow, or
   `gh workflow run deploy-site.yml --repo ggi3201/onebox`.
5. Check the live site (above).

Rotate the token if it ever shows up in a log or a message.
