# Restore

Do one test restore after setup, and again after any change to the backup.
Restore into a scratch container, never over a live database.

## Keep these off the box

A restore from restic needs three things that are not in the backup, or are
locked inside it. Keep a copy in your password manager:

- `/etc/onebox/backup.env`: where the backup is (`RESTIC_REPOSITORY`) and the
  bucket credentials, if any.
- `/etc/onebox/restic-password`. Without it the backup cannot be read.
- For an `sftp:` repository: the backup host's user and address. A new box
  makes a new SSH key for root, and you add it on the backup host (below).

## From a local dump

A production container's superuser is its `POSTGRES_USER` (`myapp`, for
example). Often it has no `postgres` role, so `psql -U postgres` fails there.
Give the scratch container the same user, and the same commands work in both:

```bash
ls -lt /var/backups/onebox/postgres/ | head
U=$(docker exec <prod db container> printenv POSTGRES_USER)    # empty means postgres
U=${U:-postgres}
docker run -d --name restore-test -e POSTGRES_USER="$U" -e POSTGRES_DB=postgres \
  -e POSTGRES_PASSWORD=scratch postgres:<same major as prod>
# The image runs a first-start server, then restarts. Wait for the real one.
until docker logs restore-test 2>&1 | grep -q 'init process complete' \
  && docker exec restore-test pg_isready -q -U "$U" -d postgres; do sleep 1; done
gzip -dc /var/backups/onebox/postgres/<container>-<stamp>.sql.gz \
  | docker exec -i restore-test psql -U "$U" -d postgres -q
docker exec restore-test psql -U "$U" -d postgres -c '\l'
docker exec restore-test psql -U "$U" -d <db> -c 'select count(*) from <a table you know>'
docker rm -f restore-test
```

`role "myapp" already exists` is normal: the container made that role. Any
other error is not.

## From restic (disk lost, or a new box)

The order matters. The `tunnel` phase reuses `/etc/cloudflared` when it is
there. Run it before the restore, and it makes a new tunnel, and every DNS
record still points at the old one.

1. On the new box, run `base`, `ssh-lockdown` and `docker` as usual. Not
   `proxy` or `tunnel` yet.
2. Put back `/etc/onebox/backup.env` and `/etc/onebox/restic-password` (mode
   600) from your password manager. Then run the `backup` phase. It installs
   `onebox-backup` and keeps your `backup.env`.
3. For an `sftp:` repository, give root a key and add it on the backup host:

   ```bash
   sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519
   sudo cat /root/.ssh/id_ed25519.pub     # add to the backup user's authorized_keys
   sudo ssh <user>@<backup-host> true     # accept the host key once
   ```

4. List and restore:

   ```bash
   sudo onebox-backup --list
   sudo sh -c 'set -a; . /etc/onebox/backup.env; set +a; restic restore latest --target /restore'
   ```

5. Put the files back, before the next phases:

   ```bash
   sudo cp -a /restore/etc/cloudflared /etc/
   sudo cp -a /restore/srv/apps/. /srv/apps/          # your box.appsDir
   ```

6. Run `proxy`. It keeps the restored `traefik/.env`, so it needs no token.
   Then `tunnel`. It finds the restored config and runs the same tunnel, so
   DNS does not change.
7. Load each dump from `/restore/var/backups/onebox/postgres/`, before its app
   starts: start only the database (`docker compose up -d <db service>`), wait
   as above, and load it as above, into that container. There,
   `database "myapp" already exists` is normal too: the container made it
   empty, and the dump fills it. Then start the app.
8. `box-setup.sh check`. Then open each hostname.

## Restore to a real database

Stop the app first, so it cannot write during the restore. Restore into an
empty database. Start the app. Compare row counts on a few tables with the
numbers from the test restore.
