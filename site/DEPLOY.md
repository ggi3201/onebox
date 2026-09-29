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
  npx wrangler pages deploy dist --project-name onebox --branch main
```

The token needs one permission: Account, Cloudflare Pages, Edit. Read it from
your secrets tool. Never put it in the repo or in a command you share.

## Check it

```bash
for p in / /guides/xcode/ /guides/xcode.md /llms.txt; do
  curl -sS -o /dev/null -w "$p %{http_code} %{content_type}\n" https://onebox.lokkesveen.com$p
done
```

Every line must be 200. The `.md` and `llms` files are `text/plain`, set in
`public/_headers`.

## Not done yet

A GitHub Actions workflow that deploys on every merge to `main` that touches
`site/` or `guides/`. It needs a token with only the Pages permission, kept as a
repository secret. Use a new one, not a temporary token.
