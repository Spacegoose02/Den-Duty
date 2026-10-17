# Google sign-in

Google sign-in is for parents. Kids never need an account: they tap their raccoon on a family tablet.

1. Go to the [Google Cloud console credentials page](https://console.cloud.google.com/apis/credentials) and create a project if you don't have one.
2. Set up the **OAuth consent screen**: user type **External**, app name “Daytime Ninja”, and add the parents who'll use it as test users (or publish the app).
3. **Create credentials → OAuth client ID → Web application**.
4. Under **Authorized redirect URIs** add `PUBLIC_URL/api/auth/google/callback`, for example `https://chores.example.com/api/auth/google/callback`.
5. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart.

Google only allows `https://` redirect addresses, or `http://localhost`. If you reach the server by a plain LAN address like `http://192.168.1.20:8080`, put it behind a reverse proxy with HTTPS (Nginx Proxy Manager, SWAG, Caddy, Cloudflare Tunnel or Tailscale all work), or keep using quick sign-in on your home network.

Once Google is set up, name-only quick sign-in turns off unless you set `LOCAL_LOGIN=lan`.

## Tablets

Google blocks sign-in inside embedded app browsers. On a tablet, use a **pairing code** instead: in **Settings**, tap **Pair a device** (signs the tablet in as you) or **Get a tablet code** (sets it up as the family tablet for the kids), then choose **I have a pairing code** on the tablet.
