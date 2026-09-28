# Uptime alerts: know first when the box is down

Runs on: your browser (the check services), your box (the health endpoint,
the backup ping, the daily check), and your phone (the alerts).

One box is one point of failure. When the API, the database, the tunnel or the
whole box stops, your users see errors, and today you learn about it from
them. This guide sets up free checks that run **outside** the box and send an
alert to your phone: an HTTP check on the API's `/health`, a ping from the
nightly backup, and a daily ping from the box check. Set it up when the first
real user depends on the app, at the latest on launch day.

## What it costs

| Service | Free | First paid step |
|---|---|---|
| **Better Stack** Uptime (HTTP checks) | 10 monitors and heartbeats, 1 status page, checks every 3 minutes, email and Slack alerts. Labelled "free for personal projects". | Responder license: 34 USD a month, or 29 USD a month billed yearly. Adds unlimited phone call and SMS alerts, push notifications, checks every 30 seconds. |
| **healthchecks.io** (pings from jobs) | Hobbyist: 20 checks, 100 log entries per check, no card. No SMS, WhatsApp or phone calls. | Business: 20 USD a month (16 USD billed yearly), 100 checks, 50 SMS or WhatsApp and 20 phone calls a month. The 5 USD Supporter plan has the same limits as the free plan. |
| **Uptime Kuma** (self-hosted) | free, open source | the second machine it runs on |

Checked 2026-09-28 at https://betterstack.com/pricing,
https://betterstack.com/docs/uptime/check-frequency/ and
https://healthchecks.io/pricing/. If your app earns money, read Better Stack's
terms for the free plan.

Why two services: healthchecks.io only **receives** pings. It does not call
your API. Better Stack calls your API from outside. Each does one job well on
its free plan.

## Why the check must run from outside the box

- **A box cannot report its own death.** If the box is off, a check on the box
  is off too, and nothing sends the alert.
- **A home box has more ways to fail.** A power cut, a router restart, or an
  internet outage takes it offline. From inside, `localhost` still looks fine.
- **The tunnel and DNS are part of the path.** Users reach the API through
  Cloudflare, the Cloudflare Tunnel, Traefik and then the API. A check from
  outside walks the same path as your users. A check on the box skips half
  of it.

So: the checks run on someone else's servers. The box only sends pings out.
That needs no open port, which fits the tunnel setup.

## What to watch

| What fails | What notices it |
|---|---|
| The API crashed, or Postgres is down | the HTTP check on `/health` (steps 1 and 2) |
| The tunnel is down, the box is off, the home internet is down | the HTTP check on `/health` |
| The nightly backup did not run, or failed | the backup ping (step 3) |
| The disk fills up, a backup is old, a firewall rule changed | the daily `box-setup.sh check` ping (step 4) |

Do not check third-party services (your AI provider, RevenueCat) in
`/health`. Their outage would page you for something you cannot fix, and would
mark your API as down while most of it works.

## Steps

### 1. A `/health` endpoint that checks the database

[backend.md](backend.md) has a `/health` that returns 200 as long as the API
process runs. Make it also check Postgres, with a short timeout. It returns
`503` when the database does not answer, so the outside check sees a real
failure.

.NET:

```csharp
app.MapGet("/health", async (AppDb db, CancellationToken ct) =>
{
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    cts.CancelAfter(TimeSpan.FromSeconds(2));
    try
    {
        return await db.Database.CanConnectAsync(cts.Token)
            ? Results.Ok(new { ok = true })
            : Results.Json(new { ok = false }, statusCode: 503);
    }
    catch
    {
        return Results.Json(new { ok = false }, statusCode: 503);
    }
}).DisableRateLimiting();
```

Node (Express, with a `pg` pool):

```js
app.get("/health", async (_req, res) => {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 2000); });
    await Promise.race([pool.query("select 1"), timeout]);   // Prisma: prisma.$queryRaw`select 1`
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  } finally {
    clearTimeout(timer);
  }
});
```

Rules:

- No authentication, no rate limit, no details in the body. The error text
  stays in your logs, not in the answer.
- Docker's `healthcheck` and the deploy's "Wait for health" step now also wait
  for the database. That is what you want: a deploy is not healthy without it.

### 2. An HTTP check from outside (Better Stack)

1. Make an account at https://betterstack.com and open **Uptime**.
2. Create a monitor for `https://api.example.com/health`. Alert when the URL is
   not available (a status other than 2xx, or a timeout).
3. Keep the check every 3 minutes (the free plan's shortest).
4. Under alerts, turn on email. If you use Slack, turn on Slack too.

Alternatives with the same role: Sentry's free plan includes one uptime
monitor ([crash-reports.md](crash-reports.md)), and Uptime Kuma (below).

### 3. A dead-man's switch on the nightly backup (healthchecks.io)

A dead-man's switch alerts you when a ping does **not** arrive. The backup
from `box:box-setup` runs every night at 03:30 (box time), with up to 20
minutes of random delay. If it fails, or the timer stops, or the box is off,
no ping arrives, and healthchecks.io tells you.

1. Make an account at https://healthchecks.io. Add a check called
   `myapp-box backup`.
2. Set its schedule to **Cron** `30 3 * * *`, in the box's time zone
   (`timedatectl` on the box shows it). Set the **grace time** to 2 hours, so
   a slow off-box upload does not raise a false alarm.
3. Copy the ping URL (`https://hc-ping.com/<uuid>`). Anyone with it can send
   pings, so treat it like a password.
4. On the box, store it in a root-only file:

   ```bash
   sudo install -m 600 /dev/null /etc/onebox/healthchecks.env
   sudo nano /etc/onebox/healthchecks.env
   ```

   ```sh
   HC_BACKUP_URL=https://hc-ping.com/your-backup-uuid
   HC_CHECK_URL=https://hc-ping.com/your-check-uuid
   ```

   The second line is for step 4. Keep each line as `NAME=value` with no
   comment after the value: systemd reads this file too, and it does not
   strip a trailing comment.

   `/etc/onebox` is in the backup's `BACKUP_PATHS`, so this file is backed up
   too.
5. Add a systemd drop-in to the backup service. Do not edit
   `onebox-backup` itself: `box:box-setup` writes that file again on its next
   run.

   ```bash
   sudo systemctl edit onebox-backup.service
   ```

   ```ini
   [Service]
   EnvironmentFile=/etc/onebox/healthchecks.env
   # Runs only when the backup succeeded. "-" means a failed ping does not fail the backup.
   ExecStartPost=-/usr/bin/curl -fsS -m 10 --retry 5 -o /dev/null ${HC_BACKUP_URL}
   # Runs after every run. On a failure it reports at once, instead of after the grace time.
   ExecStopPost=/bin/sh -c '[ "$${SERVICE_RESULT}" = success ] || /usr/bin/curl -fsS -m 10 --retry 5 -o /dev/null "$${HC_BACKUP_URL}/fail"'
   ```

   `$$` passes a literal `$` to the shell, so the shell reads the variables,
   not systemd. `onebox-backup` exits with an error when a dump or the restic
   upload fails, so a partial backup counts as a failure.

### 4. A daily ping from the box check

`box-setup.sh check` is read-only. It checks SSH, the firewall, Docker,
Traefik, the tunnel replicas, the last backup and the disk, and exits non-zero
on any `FAIL`. Run it every morning and send its exit status and output to a
second healthchecks.io check. healthchecks.io treats `/0` as success and
`/1` to `/255` as failure, and keeps the posted output in its log.

1. Add a check called `myapp-box check`: schedule **Cron** `0 7 * * *` in the
   box's time zone, grace 1 hour. Put its ping URL in `HC_CHECK_URL` (step 3).
2. `box:box-setup` copied `box-setup.sh` and the merged config to `/root/` on
   the box. If they are gone, copy them again as that skill shows. Then add a
   small script:

   ```sh
   #!/bin/sh
   # /usr/local/sbin/onebox-check-ping: run the box check, report the result.
   . /etc/onebox/healthchecks.env
   out=$(bash /root/box-setup.sh check --config /root/onebox.json 2>&1); rc=$?
   printf '%s\n' "$out" | /usr/bin/curl -fsS -m 10 --retry 5 -o /dev/null --data-binary @- "$HC_CHECK_URL/$rc"
   ```

   ```bash
   sudo chmod 700 /usr/local/sbin/onebox-check-ping
   ```

3. A service and a timer for it:

   ```ini
   # /etc/systemd/system/onebox-check.service
   [Unit]
   Description=onebox daily box check
   After=docker.service

   [Service]
   Type=oneshot
   ExecStart=/usr/local/sbin/onebox-check-ping
   ```

   ```ini
   # /etc/systemd/system/onebox-check.timer
   [Unit]
   Description=onebox daily box check

   [Timer]
   OnCalendar=*-*-* 07:00
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```

   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now onebox-check.timer
   ```

This ping is also a daily "the box is alive" signal. A `WARN` line does not
fail the check. Read the output in the healthchecks.io log now and then.

### 5. Alerts on your phone

An alert that you read the next day is only a report. Make the first alert
reach your phone:

- **healthchecks.io:** add an integration under **Integrations**. Push apps
  such as ntfy, Pushover, Telegram or Signal work well for one person. The free
  plan has no SMS, WhatsApp or phone calls; those need a paid plan. Check the
  push app's own price.
- **Better Stack free plan:** email and Slack. Install the Slack app on your
  phone and allow notifications for the alerts channel. Or give the alert
  email its own notification sound in your mail app. Better Stack lists
  push notifications, SMS and phone calls with the paid Responder license.
- Send one test alert through every path, and check that the phone rings or
  shows it while locked.

Your coding agent can help once an alert arrives: "the box check failed, read
the output and tell me what to do" (see [remote-access.md](remote-access.md)).

## Uptime Kuma, the self-hosted option

Uptime Kuma is a free, open-source monitor with HTTP checks, push (heartbeat)
checks and many alert channels. It runs in Docker:

```bash
docker run -d --restart=always -p 127.0.0.1:3001:3001 -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:2
```

Bind the port to `127.0.0.1` as shown, and reach the page over Tailscale or an
SSH tunnel. A `0.0.0.0` port on a VPS is public, whatever ufw says, and
`box-setup.sh check` fails on it.

**Do not run it only on the box it watches.** When the box goes down, Uptime
Kuma goes down with it and sends nothing. Run it on a second machine in
another place: a second small VPS, or a Raspberry Pi somewhere else. A home
box and a VPS can watch each other. Keep the free outside checks (steps 2 to
4) as well, so something also notices when Uptime Kuma itself stops.

## Where the values go

| Value | Where |
|---|---|
| Ping URLs (`HC_BACKUP_URL`, `HC_CHECK_URL`) | `/etc/onebox/healthchecks.env` on the box, mode `600`; a copy in your secrets tool ([secrets.md](secrets.md)) |
| The monitored URL (`https://api.example.com/health`) | the Better Stack monitor |
| Alert destinations (email, Slack, push app) | each service's dashboard |
| Box time zone | `timedatectl` on the box; the same zone in each healthchecks.io schedule |

## Check it works

- **The health endpoint:** on staging (`box:staging-env`), stop the database
  with `docker compose stop` on its `db` service. `curl -i https://api-stg.example.com/health`
  shows `503`. Start it again: `200`.
- **The HTTP check:** add a second Better Stack monitor for the staging API,
  stop the staging API, and wait for the alert on your phone (up to a few
  check intervals). Start it again and wait for the "resolved" message. Or
  accept a few minutes of downtime on production at a quiet hour.
- **The backup ping:** `sudo systemctl start onebox-backup.service`. When it
  ends, healthchecks.io shows a new ping. `systemctl cat onebox-backup.service`
  shows your drop-in.
- **The failure path:** `curl -fsS "$HC_BACKUP_URL/fail"` from your Mac (with
  the URL from your secrets tool) must send the alert to your phone. Then run
  the backup again, so the check goes back up.
- **The box check:** `sudo systemctl start onebox-check.service`. The
  healthchecks.io log shows the output, ending with `0 fail`.

## Common errors

- **The check shows 403 but the app works.** A Cloudflare security feature,
  such as Bot Fight Mode or a WAF rule, blocks the checker. Look in
  Cloudflare's security events for the blocked request.
- **Cloudflare error 1033.** The tunnel is not connected: Cloudflare finds no
  healthy `cloudflared`. The box is off or offline, or the `cloudflared`
  units stopped. Run `box-setup.sh check`.
- **502 Bad Gateway from Cloudflare.** The tunnel is up, but `cloudflared`
  cannot reach the service in its ingress rule. Check Traefik and the API
  container.
- **404 with an empty body.** The hostname has no tunnel ingress. See
  [backend.md](backend.md), "Common errors".
- **healthchecks.io reports the backup down, but the backup ran.** The
  schedule uses another time zone than the box, or the grace time is shorter
  than the timer's random delay plus the run time.
- **No ping arrives at all.** The drop-in is not loaded (`systemctl cat
  onebox-backup.service` does not show it), or `/etc/onebox/healthchecks.env`
  has a typo. Run the service by hand and read
  `journalctl -u onebox-backup.service`.
- **`/health` is green but users see errors.** `/health` checks the API and
  the database only. Read your error reporter ([crash-reports.md](crash-reports.md)).
- **Too many alerts.** A 3-minute check sees every short restart, for
  example during a deploy. Better Stack has a confirmation period setting:
  raise it so a short restart does not alert. Deploy at quiet hours.
