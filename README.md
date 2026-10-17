<p align="center"><img src="web/public/icon.svg" width="120" alt="Daytime Ninja raccoon"></p>

<h1 align="center">Daytime Ninja</h1>

<p align="center">A self-hosted, tablet-first family chore tracker. Chores, points, goals and rewards, run by a very tidy raccoon.</p>

Daytime Ninja is the sibling of [Nighttime Ninja](https://github.com/Spacegoose02/Nighttime-Ninja) (the kitchen manager) and shares its setup, sign-in and look.

## What it does

- **Homes with parents and kids.** Parents have accounts; kids get a profile with a **raccoon avatar**, a color and an optional **4-digit PIN**.
- **Family tablet.** Pair a tablet to your home and it shows every kid's raccoon. Kids tap theirs (plus their PIN) to see their day. It signs itself out after a few idle minutes, and it can never approve anything.
- **Chores** with an icon, points, and a schedule: **every day**, **specific weekdays**, or **just once**, assigned to one or more kids.
- **Done → review → points.** Kids tap a chore when it's done; it waits for a parent. Parents **approve** (or send it back with a note) from the review queue. Every approval writes one row to an **append-only points ledger**, so balances are always explainable. Mistakes are undone with a reversing entry, never by editing history.
- **Goals and rewards** per kid (“Ice cream trip, 20 points”). Kids watch the progress bar fill; parents tap **Redeem** to hand over the reward and spend the points.
- **Your own currency.** Points are called **Shinies ✨** by default; rename them and pick an icon per home (Acorns 🌰, Stars ⭐, Bucks 🪙…).
- **Kid kanban board**: To do → Doing → Waiting for a grown-up → Done, with big buttons, plus goal progress, recent points and a weekly agenda. **Parent view**: review queue, per-kid summary (points this week, chores done, level, streak), a week grid and a points history.
- **Bonus chores** kids can opt into for extra points: open to everyone or to chosen kids, for every kid or first-come (one per day).
- **Quick rewards** a parent hands out in one tap (“🤝 Helped someone +3”), and **penalties** with a reason, which kids see worded gently. Balances stop at zero unless you allow negatives in Settings.
- **Reward votes**: parents suggest rewards, kids vote on the tablet (counts stay hidden until a parent picks), parents choose the winner.
- **Raccoon levels** (Kit → Scout → Sneak → Shadow → Ninja → Master Ninja → Legend) from lifetime points and redeemed goals. Levels unlock 6 extra raccoon avatars kids can pick themselves.
- **Badges and streaks**: 16 achievements for firsts, totals and streaks (days in a row with every chore done).
- **Stats with charts**: points per week compared across kids, points per day, chores done vs due by week, which chores get done, and level / streak / trend tiles. Every chart has a table view.
- **Therapy section per kid** (parents only): appointments (doctor, speech, feeding, OT, PT and more), development / speech / feeding / doctor goals with progress notes and a progress chart. You can choose to show a kid their own goals and next appointments; notes always stay private.
- **Honey-do board**: a kanban for the parents' own to-dos and goals, with assignees and due dates.
- **21 themes**, from Sunny and Dino to Space and Volcano, plus two high-contrast ones. Pick one for the home, and each kid can have their own on their board.
- **Strong sign-in** carried over from Nighttime Ninja: passwords (scrypt), **two-factor codes** with recovery codes, **passkeys**, **Google** (OIDC), invite-only sign-up, rate limiting, signed-in device list, **pairing codes**, and name-only quick sign-in that only works on your home network.
- **Home Assistant**: a token-based summary endpoint with each kid's points and chores left today.
- **Runs everywhere**: Docker (with an Unraid template) and any browser. Android and Windows apps are planned (same approach as Nighttime Ninja).

## Quick start with Docker

```bash
docker run -d --name daytime-ninja -p 8080:8080 -v ./data:/data ghcr.io/spacegoose02/daytime-ninja:latest
```

Open http://localhost:8080. The first person to sign up becomes the server admin. Then:

1. Create your home, add your kids (**Kids → Add a kid**) and some chores (**Chores → New chore**).
2. Set up the family tablet: in **Settings → Family tablets** tap **Get a tablet code**, then on the tablet open the site, choose **I have a pairing code** and type it. (Or tap **Make this device the family tablet** on the tablet itself.)
3. Kids tap their raccoon and get going. Parents approve from **Home**. A parent can also sign in on the tablet with the small **🔒 Parents** button; signing out returns it to the kids' screen.

Or with Compose: copy `.env.example` to `.env`, adjust it, and run `docker compose up -d`.

### Unraid

In the Docker tab choose **Add Container** and set **Template** to this URL, or drop the file into `/boot/config/plugins/dockerMan/templates-user/`:

```
https://raw.githubusercontent.com/Spacegoose02/Daytime-Ninja/main/unraid/daytime-ninja.xml
```

## Settings

All settings are environment variables. See [.env.example](.env.example).

| Variable | What it does |
| --- | --- |
| `PUBLIC_URL` | The address people use, e.g. `https://chores.example.com`. Needed for Google sign-in and passkeys. |
| `DATA_DIR` | Where the SQLite database lives (`/data` in Docker). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Turn on Google sign-in. See [docs/google-sign-in.md](docs/google-sign-in.md). |
| `SIGNUP_MODE` | `invite` (default, needs a home join code), `open`, or `closed`. Admins can change it in Settings. |
| `LOCAL_LOGIN` | Name-only quick sign-in for parents: `lan` (home network only), `off`, or `anywhere`. |
| `TRUST_PROXY` | Reverse proxies allowed to set X-Forwarded headers. Defaults to loopback and private networks. |
| `SESSION_SECRET` | Optional. Generated and saved in the data folder if empty. |
| `TZ` | Fallback time zone for new homes. Each home stores its own (set from the browser, changeable in Settings), so “today” flips at your midnight. |

## How points work

- A chore's **instances** are created per kid per due day, up to today. Future days are shown as *planned* and aren't stored, so editing a chore changes them automatically. Days nobody opened the app are filled in, so missed chores still show.
- Status goes **to do → waiting → done** (or **try again** with a parent's note). A parent ticking a chore off directly counts straight away.
- `points_ledger` is append-only: SQLite triggers refuse updates and deletes. A kid's balance is the sum of their rows; “points this week” counts everything earned in the week (spending on rewards doesn't reduce it).
- Goals measure against the balance. Redeeming writes a negative `redeem` row for the goal's points.
- Penalties are `adjust` rows with a negative amount and a reason. By default they stop at zero: a penalty takes what's there and refuses when the balance is empty. Undoing an approval can still dip below zero, because it corrects a mistake rather than punishing.
- Levels use lifetime earnings (chores and bonuses, minus undone approvals) plus 20 per redeemed goal, so spending and penalties never lower a kid's level.
- A streak day is one where every regular chore due was approved (today, “waiting for a grown-up” counts too). Days with nothing due don't break a streak, and bonus chores never count against it.

## Putting it on the internet

1. Put it behind a reverse proxy with HTTPS (Nginx Proxy Manager, SWAG, Caddy, Traefik or a Cloudflare Tunnel) and set `PUBLIC_URL` to the https address. Passkeys and Google sign-in need this.
2. Keep `SIGNUP_MODE=invite` so only people with one of your homes' join codes can make accounts.
3. Parents should set a password and turn on two-factor or add a passkey in **Settings → Sign-in and security**. Quick sign-in keeps working at home but is refused from the internet. (The app tells home from internet by IP address, so always go through the reverse proxy. If you forward a port straight to the container, set `LOCAL_LOGIN=off`.)
4. Family tablets use a long random device token, not a password. Unpair a lost tablet in **Settings → Family tablets**. Kid PINs are rate limited.

## Home Assistant

Create a token in **Settings → Home Assistant and automations**, then add a REST sensor:

```yaml
rest:
  - resource: http://YOUR-SERVER:8080/api/homes/YOUR-HOME-ID/ha/summary
    headers:
      Authorization: Bearer dnk_...
    scan_interval: 300
    sensor:
      - name: Chores waiting for review
        value_template: "{{ value_json.waiting_for_review }}"
      - name: Ava points
        value_template: "{{ (value_json.kids | selectattr('name', 'eq', 'Ava') | first).balance }}"
```

Tokens can read but never change anything.

## Development

Requires Node.js 24 or newer.

```bash
npm install
npm run dev:server   # API on http://localhost:8080
npm run dev:web      # app on http://localhost:5173 (proxies /api)
npm test
npm run typecheck
```

| Folder | What's in it |
| --- | --- |
| `server/` | Fastify API using Node's built-in SQLite. TypeScript runs directly on Node 24, no build step. |
| `server/src/chores.ts` | The core loop: schedules → instances → review → ledger → goals. |
| `web/` | React + Vite app: parent screens and the family tablet screens. |
| `shared/` | Schedules, date math in the home's time zone, avatars, icons. Used by both. |
| `unraid/` | Unraid Community Applications template. |

The layout matches Nighttime Ninja on purpose, so its `apps/launcher`, `apps/desktop` (Electron) and Capacitor Android setup can be copied over when the native apps are added.

## Privacy

Everything stays on your server. Nothing is sent anywhere unless you turn on Google sign-in.

## License

MIT
