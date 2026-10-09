# Security

onebox is skills and guides that run commands on your machine and, over SSH,
on your server. A mistake in a skill can cost someone a secret, a server or an
app. Please report one.

## Report a problem

[Report it privately on GitHub](https://github.com/ggi3201/onebox/security/advisories/new),
or write to [geir@lokkesveen.com](mailto:geir@lokkesveen.com). Do not open a
public issue for a security problem. Say which skill or script, what you did,
and what happened. I answer as fast as I can, but I build this next to a day
job.

## What counts

- A skill or script that prints, stores or sends a secret.
- A script that changes something it did not say it would, or that runs a
  command without the user's clear yes.
- A guide that tells the user to do something unsafe, such as opening a
  database port to the internet.
- A workflow here that could leak a secret.

## What the kit promises

- Secrets are read from your secrets tool and kept in a variable. They are
  never printed, never put in a URL, and never written into a repository.
- The config holds references to secrets, not values (see
  [CONFIG.md](CONFIG.md)).
- Read-only checks stay read-only. A skill asks before it installs, deletes
  or deploys.
