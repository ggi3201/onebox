# Apple Developer Program

Runs on: your browser, or the Apple Developer app on an iPhone, iPad or Mac.

The Apple Developer Program is the paid membership you need to put an app on
TestFlight or the App Store. It also gives you App Store Connect, where you
manage apps, builds, testers and sales. Join it first: approval can take from
minutes to a few days.

## What it costs

- **99 USD per membership year.** Apple shows the price in your local
  currency during enrollment. Nonprofits, accredited schools and government
  entities can ask for a fee waiver.
- Without it you can still run your app in the simulator, and on your own
  phone with a free Apple Account for a few days at a time. You cannot use
  TestFlight or publish.

Checked 2026-09-28 at https://developer.apple.com/programs/enroll/.

## Individual or organization?

| | Individual | Organization |
|---|---|---|
| Seller name on the App Store | your legal name | the company's legal name |
| Needs a legal entity | no | yes (no DBAs, trade names or branches) |
| Needs a D-U-N-S Number | no | yes |
| Needs a public website on the company's domain | no | yes |
| Team members with roles | you only | yes |

Choose **individual** if you are one person shipping your own apps and are
happy with your name on the store. Choose **organization** if you have a
company, want its name on the store, or will work with others on the account.

Some apps must come from an organization. Apps in highly regulated fields
(banking, healthcare, gambling, crypto exchanges, air travel) or that need
sensitive user information "should be submitted by a legal entity that
provides the services, and not by an individual developer" (guideline
5.1.1(ix)).

### Do not publish a client's app on your own account

If you build an app for someone else, they enroll and publish it. Invite
yourself to their team. Reasons:

- The App Store shows the account holder as the seller. Apple's guidelines say
  apps "should be submitted by the person or legal entity that owns or has
  licensed the intellectual property" (5.2.1). Template and app-builder
  services "should not submit apps on behalf of their clients" (4.2.6).
- Revenue, tax, reviews and legal responsibility belong to the account holder.
- Moving an app to another account later is possible, but it is a formal
  transfer with conditions. It is easier to start on the right account.

## Steps

1. Make sure your Apple Account has **two-factor authentication** on, and that
   its first and last name are your **legal name**. A nickname or company name
   there delays approval.
2. **Organization only:** check that your company has a D-U-N-S Number. Apple
   uses it to verify the legal entity. Apple's enrollment page links a free
   lookup tool. Getting a new number can take days, so start early.
3. Go to https://developer.apple.com/programs/enroll/ and start the
   enrollment. You can also enroll in the Apple Developer app on an iPhone,
   iPad or Mac.
4. Confirm your legal name, address (no P.O. boxes), phone and email.
   Organizations also give the legal entity name, D-U-N-S Number, website and
   a work email on the company's domain. You must have the authority to sign
   legal agreements for the company.
5. Pay the fee. Apple reviews the enrollment and emails you when it is active.
   Organizations take longer because Apple verifies the entity.

## Where the values go

After enrollment you have a **Team ID**: a 10-character code. Find it on the
Membership details part of your account page at
https://developer.apple.com/account.

Put it in the onebox config:

```json
{ "apple": { "teamId": "ABCDE12345" } }
```

in `~/.config/onebox/config.json`. The Team ID is not a secret, but it is
personal, so do not commit it to a public repo.

## Check it works

- https://developer.apple.com/account shows your membership as active, with
  an expiry date a year out.
- https://appstoreconnect.apple.com opens and shows **Apps**.
- `eas build` (see [expo-eas.md](expo-eas.md)) can sign in and list your team.

## Common errors

- **Enrollment stuck "pending".** Usually the name on the Apple Account does
  not match your legal name, or the D-U-N-S details do not match the company
  record. Contact Apple Developer Support from the enrollment page.
- **"Your enrollment could not be completed."** Often the same name or entity
  mismatch. Fix the Apple Account name first.
- **The membership lapsed.** Apps are removed from sale and TestFlight stops
  when the membership expires. Turn on auto-renew.

## Next

1. Install Xcode: [xcode.md](xcode.md).
2. Make the Expo project fit this setup: [expo-app.md](expo-app.md).
3. Create the app record and do the one-time App Store Connect setup:
   [app-store-connect-setup.md](app-store-connect-setup.md).
4. Make an API key so tools can work without your password:
   [app-store-connect-api-key.md](app-store-connect-api-key.md).
5. Set up Expo builds: [expo-eas.md](expo-eas.md).
6. If you sell subscriptions: [revenuecat.md](revenuecat.md).

[start-here.md](start-here.md) has the full order.
