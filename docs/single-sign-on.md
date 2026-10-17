# Single sign-on: OIDC and forward-auth

Besides passwords, passkeys and Google, parents can sign in with your own identity provider, either as a normal **OpenID Connect** login button or by letting your **reverse proxy** sign them in (TinyAuth, Authelia, Authentik's proxy outpost, oauth2-proxy and so on). Kids never need any of this: they tap their raccoon on the family tablet.

## OpenID Connect (Authentik, Authelia, Keycloak, Pocket ID, Zitadel, Kanidm…)

1. In your provider, create an OAuth2/OIDC application (a confidential web client).
2. Set its redirect URI to `PUBLIC_URL/api/auth/oidc/callback`, for example `https://chores.example.com/api/auth/oidc/callback`.
3. Set these and restart:

| Variable | Example | Notes |
| --- | --- | --- |
| `OIDC_ISSUER` | `https://auth.example.com/application/o/daytime-ninja/` | The issuer URL; `/.well-known/openid-configuration` must be under it. |
| `OIDC_CLIENT_ID` | `daytime-ninja` | |
| `OIDC_CLIENT_SECRET` | `…` | |
| `OIDC_NAME` | `Authentik` | The button says “Sign in with Authentik”. |
| `OIDC_SCOPES` | `openid email profile` | The default. |

How accounts are matched:

- By the provider's user id (`sub`) after the first sign-in.
- On the first sign-in, by a **verified** email that matches an existing Daytime Ninja account, which then gets linked.
- Otherwise a new parent account is made, following the sign-up mode: `open`, `invite` (the person types a home's join code on the sign-in screen first, then presses the button) or `closed`.

If the person turned on two-factor in Daytime Ninja, they're asked for a code after the provider too. PUBLIC_URL must be the address people use, and most providers insist on https.

## Forward-auth (TinyAuth and other reverse-proxy logins)

Your proxy signs the person in and passes their username in a header. Daytime Ninja trusts that header **only on requests that come straight from your proxy's address**.

| Variable | Default | Notes |
| --- | --- | --- |
| `FORWARD_AUTH_HEADER` | (off) | The username header. TinyAuth and Authelia use `Remote-User`. Setting this turns forward-auth on. |
| `FORWARD_AUTH_EMAIL_HEADER` | `Remote-Email` | Optional. Used to link an existing account with the same email. |
| `FORWARD_AUTH_NAME_HEADER` | `Remote-Name` | Optional. The display name for new accounts. |
| `FORWARD_AUTH_TRUSTED` | `private` | Addresses allowed to send the header: `private` (loopback, LAN and Docker networks), single IPs and IPv4 CIDRs, comma-separated, e.g. `172.18.0.0/16`. |

Example with TinyAuth and Traefik labels on the Daytime Ninja container:

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
- Daytime Ninja's own two-factor isn't asked for; your proxy's login is the gate.
- **Keep the container off the internet except through the proxy.** If you publish its port directly, set `FORWARD_AUTH_TRUSTED` to your proxy's exact address.

The family tablet keeps working behind forward-auth: it signs in with its own device token, and a parent can still sign in on it with the 🔒 Parents button.
