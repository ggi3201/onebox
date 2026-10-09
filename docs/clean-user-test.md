# onebox: test it as a new user

For the people who maintain onebox. Run it after a big change to a skill, and
before a release.

You test onebox as if you were new. You use a second macOS user on this Mac.
Your job is to get an app idea onto the iPhone Simulator, using only onebox.
You write down every place you get stuck.

**Do not fix anything yourself.** A stuck place is what we are looking for.

## What this test covers, and what it does not

A second user is not a clean Mac. Some things are shared with the first user.

| | New user sees | What that means |
|---|---|---|
| Home folder, `~/.zshrc`, rbenv, fnm, `~/.config` | nothing (clean) | Tested for real |
| Logins: Claude, GitHub, Expo, Doppler, Apple ID in Xcode | nothing (clean) | Tested for real |
| Xcode, Docker, Tailscale, Claude app | shared, in `/Applications` | Not tested: install |
| Homebrew tools (`jq`, `gh`, `fastlane`, `doppler`) | shared, in `/opt/homebrew` | Not tested: install |
| `pod` (old, from `/usr/local/bin`), `dotnet` | shared | The old `pod` uses the old macOS Ruby. Good: this tests that trap. |

So this test cannot show what happens when a tool is missing. A real clean Mac
(or a friend's Mac) is still needed for that. This test covers everything else.

**Do not run the Homebrew installer in the new user.** `/opt/homebrew` belongs to
the first user. The installer would take it over and could break the first
user's tools.

## Part 1: the owner does this once (5 minutes)

1. System Settings → Users & Groups → Add User.
2. Type: **Administrator**. Name: `onebox-test`. Choose a password you remember.
3. Do not use Migration Assistant. Do not copy anything from your own account.
4. Log out. Log in as `onebox-test`. (Use fast user switching. Do not log out
   of your own account if you have long tasks running.)
5. Answer the setup questions. Skip Apple Intelligence, Siri and iCloud.
   You may skip the Apple ID. You do not need iCloud.

## Part 2: the new user gets started (15 minutes)

Open **Terminal** (press Cmd+Space, type `Terminal`, press Enter).

**a. Make the shared tools findable.** The shared tools exist, but the new user
has no path to them yet:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
echo 'export LANG="${LANG:-en_US.UTF-8}"' >> ~/.zshenv
```

Close Terminal and open it again.

**b. Install Claude Code.** In Terminal:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Close Terminal, open it again, then type `claude` and press Enter. Log in with
your Claude account when it asks.

**c. Log in to GitHub.** The onebox repository is public, so installing the
plugins needs no login. You need one to open issues for the stuck places. This
uses the GitHub command-line tool, `gh`. It comes from Homebrew: in
this test it is one of the shared tools from step a. On a real clean Mac you
install it yourself. First install [Homebrew](https://brew.sh) (its page shows
the install command and, at the end, two "Next steps" lines to add `brew` to
`~/.zprofile`; run them). Then run `brew install gh`. Check with `gh --version`.
If `gh` is not found after step a, that is a stuck place: write it down.

```bash
gh auth login
gh auth setup-git
```

Choose GitHub.com, HTTPS, and "Login with a web browser". Any GitHub account
works.

**d. Make an empty folder and start Claude Code in it:**

```bash
mkdir -p ~/code/my-first-app && cd ~/code/my-first-app
claude
```

**e. Install onebox.** Type these lines in Claude Code, one at a time:

```
/plugin marketplace add ggi3201/onebox
/plugin install start@onebox
```

Restart Claude Code (type `/exit`, then `claude` again). That is all you install
by hand. From here, only talk to the agent.

## Part 3: the test

Type this, in your own words if you like:

> I have an idea for an iPhone app: a warranty keeper. You share a receipt and
> the app reminds me before the warranty ends. Help me get it on the App Store.

Then follow what the agent says. Rules:

- Answer questions like a person who is new. If you do not know, say "I do not know".
- When the agent says "Continue?", say "yes".
- Do not read the guides in advance. Do not ask the owner for help unless you
  are stuck for more than 5 minutes.
- If the agent asks you to do something in a browser or in an Apple page, do it.
  When it asks for a password or a key, stop and write it down (see below).
- Stop when the app runs in the Simulator, or after 90 minutes.
- Skip any step that says `eas init`, or use a free test Expo account. Do not
  use the owner's Expo account.

## What to write down

Keep a file `notes.md`. For each stuck place, write:

```
Time:
What the agent said (copy the words):
What I did or typed:
What happened:
Did I understand it? (yes / no / half)  The word I did not know:
```

Also note:

- every time you did not know what to answer;
- every time you needed the owner;
- every time the agent did something you did not expect;
- the total time until the app ran in the Simulator.

Take a screenshot at each stuck place: Cmd+Shift+4.

## When you are done

Each stuck place becomes an issue. If you can, open them yourself with the
dogfood template (`.github/ISSUE_TEMPLATE/dogfood.md`), and add the screenshot.
Write "the app" or `myapp`, never a real name, host or account: the issues are
public. Or send `notes.md` and the screenshots to the owner.

The owner cleans up: System Settings → Users & Groups → `onebox-test` → Delete
User. Choose "Delete the home folder". That removes everything the test made.
Nothing in your own account changes.
