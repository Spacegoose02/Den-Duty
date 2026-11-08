# Family calendar, snap to calendar and two-way sync

## Family events

**Calendar → ＋ Event** adds the family's own events: practices, parties, school trips. Pick who it's for (or everyone) and whether kids can see it. Kids see theirs and the whole family's on their board; the family wall shows today's and tomorrow's. They're in the ICS links too.

## Snap to calendar

**Calendar → 📸 Snap a flyer**: take a photo of a school flyer, a team schedule or an invitation, or paste an email. Claude reads the dates and you check each one (and pick which kid it's for) before anything is saved.

It needs AI turned on with your own Anthropic key (**Settings → AI ideas**). Only the picture or the text and today's date are sent, never your kids' names.

## Two-way sync

**Settings → Two-way calendar sync** links a Google, Outlook or iCloud/CalDAV calendar:

- **Bring its events in**: the calendar's events (a month back to four months ahead) show up in Den Duty. Change them in that calendar; the next sync brings the change over.
- **Send Den Duty events to it**: events you add here (typed or snapped) are created there and kept in step when you edit or delete them here.
- **It's for**: link a kid's own calendar (like their team's) so its events are marked as theirs, and only their events (and the whole family's) are sent to it.

It syncs every 15 minutes and a few seconds after you change an event. **Sync now** runs it straight away and shows any problem.

### iCloud, Nextcloud, Fastmail and other CalDAV calendars

Nothing to set up on the server. For iCloud, make an **app-specific password** at [appleid.apple.com](https://appleid.apple.com) (Sign-In and Security → App-Specific Passwords), then link with the server `https://caldav.icloud.com/`, your Apple ID email and that password. For Nextcloud use `https://YOUR_NEXTCLOUD/remote.php/dav/`. The password is stored encrypted.

### Google Calendar

Uses the same Google Cloud project as [Google sign-in](google-sign-in.md):

1. In the [Google Cloud console](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), **enable the Google Calendar API** for the project.
2. On the OAuth consent screen, add the scopes `.../auth/calendar.events` and `.../auth/calendar.calendarlist.readonly`.
3. On the OAuth client, add the redirect URI `PUBLIC_URL/api/calendar-sync/callback/google`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (if you haven't for sign-in) and restart.

### Outlook and Microsoft 365

1. In the [Azure portal](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade), **App registrations → New registration**. Supported accounts: *Accounts in any organizational directory and personal Microsoft accounts*.
2. Redirect URI (Web): `PUBLIC_URL/api/calendar-sync/callback/microsoft`.
3. **Certificates & secrets → New client secret**.
4. **API permissions → Microsoft Graph → Delegated → `Calendars.ReadWrite`** (and `offline_access`).
5. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` (and `MICROSOFT_TENANT` if you only want your organization; the default is `common`) and restart.

Both need an `https://` `PUBLIC_URL`, like Google sign-in.
