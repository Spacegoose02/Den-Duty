# Single sign-on: OIDC and forward-auth

Besides passwords, passkeys and Google, parents can sign in with your own identity provider, either as a normal **OpenID Connect** login button or by letting your **reverse proxy** sign them in (TinyAuth, Authelia, Authentik's proxy outpost, oauth2-proxy and so on). Kids never need any of this: they tap their raccoon on the family tablet.

## OpenID Connect (TinyAuth, Authentik, Authelia, Keycloak, Pocket ID, Zitadel, Kanidm…)

The easy way is in the app: a server admin opens **Settings → Server → Single sign-on**, presses **Add a provider** and fills in:

| Field | Example | Notes |
| --- | --- | --- |
| Name on the sign-in button | `TinyAuth` | The button says “Sign in with TinyAuth”. |
| Issuer URL | `https://auth.example.com` | The address `/.well-known/openid-configuration` lives under. Pasting the whole discovery address works too. |
| Client ID / Client secret | from your provider | The secret is stored encrypted and never shown again; leave it empty to keep it. |
| Extra scopes | `groups` | Optional. `openid email profile` are always asked for. |
| Create an account for anyone who signs in with it | off | Only for a provider that just lets in people you trust. They skip the join code and “Nobody new”, and still create or join a home. |
| Show on the sign-in page | on | Off hides the button; linked accounts can still use it. |

The card shows the **redirect URL** to register at the provider: `PUBLIC_URL/api/auth/oidc/callback`, for example `https://chores.example.com/api/auth/oidc/callback`. Press **Test** after saving to check Den Duty can read the provider's settings.

### TinyAuth

1. Create the client in TinyAuth and add Den Duty's redirect URL to its trusted redirect URIs, e.g. in TinyAuth's environment:
   ```
   TINYAUTH_OIDC_CLIENTS_DEN-DUTY_CLIENTID=…
   TINYAUTH_OIDC_CLIENTS_DEN-DUTY_CLIENTSECRET=…
   TINYAUTH_OIDC_CLIENTS_DEN-DUTY_NAME=Den Duty
   TINYAUTH_OIDC_CLIENTS_DEN-DUTY_TRUSTEDREDIRECTURIS=https://chores.example.com/api/auth/oidc/callback
   ```
   TinyAuth compares the redirect URI exactly, so it must match Den Duty's `PUBLIC_URL` character for character.
2. In Den Duty, the issuer URL is TinyAuth's own address (its `APP_URL`), such as `https://auth.example.com`.

### With environment variables instead

| Variable | Example | Notes |
| --- | --- | --- |
| `OIDC_ISSUER` | `https://auth.example.com/application/o/den-duty/` | The issuer URL. |
| `OIDC_CLIENT_ID` | `den-duty` | |
| `OIDC_CLIENT_SECRET` | `…` | |
| `OIDC_NAME` | `Authentik` | The button says “Sign in with Authentik”. |
| `OIDC_SCOPES` | `openid email profile` | The default. |

Saving a provider in Settings takes over from these; removing it there falls back to them.

### Linking accounts

- **Yourself:** Settings → You → Sign-in and security → **Link TinyAuth** (the provider's name). You sign in at the provider and come back linked. Unlink there too, as long as you still have a password or passkey.
- **An admin, for someone else:** Settings → Server → People → **Link TinyAuth** on their row, then type their email or username at the provider. Their next sign-in there with that email or username opens their existing account. **Unlink** clears it.
- One provider account opens one Den Duty account.

How accounts are matched on sign-in:

- By the provider's user id (`sub`) once linked.
- Then by an admin's pending link (email or username).
- Then by a **verified** email that matches an existing Den Duty account, which then gets linked.
- Otherwise a new parent account is made, following the sign-up mode: `open`, `invite` (the person types a home's join code on the sign-in screen first, then presses the button) or `closed`, unless the provider is set to create accounts.

If the person turned on two-factor in Den Duty, they're asked for a code after the provider too. PUBLIC_URL must be the address people use, and most providers insist on https.

## Forward-auth (TinyAuth and other reverse-proxy logins)

Your proxy signs the person in and passes their username in a header. Den Duty trusts that header **only on requests that come straight from your proxy's address**.

| Variable | Default | Notes |
| --- | --- | --- |
| `FORWARD_AUTH_HEADER` | (off) | The username header. TinyAuth and Authelia use `Remote-User`. Setting this turns forward-auth on. |
| `FORWARD_AUTH_EMAIL_HEADER` | `Remote-Email` | Optional. Used to link an existing account with the same email. |
| `FORWARD_AUTH_NAME_HEADER` | `Remote-Name` | Optional. The display name for new accounts. |
| `FORWARD_AUTH_TRUSTED` | `private` | Addresses allowed to send the header: `private` (loopback, LAN and Docker networks), single IPs and IPv4 CIDRs, comma-separated, e.g. `172.18.0.0/16`. |

Example with TinyAuth and Traefik labels on the Den Duty container:

```yaml
labels:
  traefik.http.routers.chores.rule: Host(`chores.example.com`)
  traefik.http.routers.chores.middlewares: tinyauth
environment:
  FORWARD_AUTH_HEADER: Remote-User
  FORWARD_AUTH_TRUSTED: 172.18.0.0/16   # the Docker network Traefik is on
```

How it behaves:

- The header username is linked to an account the first time (or to an existing account with the same email). New people get a parent account straight away, because the proxy already decided they may come in. They still have to create a home or join one with its code.
- Only `closed` sign-up stops new accounts.
- The person is signed in on every request the proxy forwards, so **Sign out** in the app has no effect; sign out at your proxy.
- Den Duty's own two-factor isn't asked for; your proxy's login is the gate.
- **Keep the container off the internet except through the proxy.** If you publish its port directly, set `FORWARD_AUTH_TRUSTED` to your proxy's exact address.

The family tablet keeps working behind forward-auth: it signs in with its own device token, and a parent can still sign in on it with the 🔒 Parents button.
