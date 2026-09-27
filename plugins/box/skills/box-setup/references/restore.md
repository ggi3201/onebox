# Restore

Do one test restore after setup, and again after any change to the backup.
Restore into a scratch container, never over a live database.

## From a local dump

```bash
ls -lt /var/backups/onebox/postgres/ | head
docker run -d --name restore-test -e POSTGRES_PASSWORD=scratch postgres:<same major as prod>
sleep 5
gzip -dc /var/backups/onebox/postgres/<container>-<stamp>.sql.gz \
  | docker exec -i restore-test psql -U postgres -q
docker exec restore-test psql -U postgres -c '\l'
docker exec restore-test psql -U postgres -d <db> -c 'select count(*) from <a table you know>'
docker rm -f restore-test
```

`pg_dumpall` output includes roles. Errors like `role "x" already exists` are
normal in a fresh container.

## From restic (disk lost, or a new box)

1. Run `box-setup.sh` phases on the new box as usual.
2. Put back `/etc/onebox/backup.env` and `/etc/onebox/restic-password` from
   your off-box copy.
3. List and restore:

   ```bash
   sudo onebox-backup --list
   sudo sh -c 'set -a; . /etc/onebox/backup.env; restic restore latest --target /restore'
   ```

4. `/restore` now holds the dumps, the apps dir and `/etc/cloudflared`. The
   tunnel credentials in `/restore/etc/cloudflared/` let the same tunnel run on
   the new box, so DNS does not change.
5. Load each dump as above, into the real database container this time, before
   the app starts.

## Restore to a real database

Stop the app first, so it cannot write during the restore. Restore into an
empty database. Start the app. Compare row counts on a few tables with the
numbers from the test restore.
