// One-time helper that authorizes the booking app against a Google account and
// prints a refresh token for GOOGLE_REFRESH_TOKEN.
//
// Usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google:auth
//
// The OAuth client must be of type "Desktop app" in Google Cloud Console.
import { createServer } from "node:http";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const scope = "https://www.googleapis.com/auth/calendar.events";

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (!code && !error) {
    response.writeHead(404).end();
    return;
  }

  if (error) {
    response.end(`Authorization failed: ${error}. You can close this tab.`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    return;
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenResponse.json();

  if (!tokenResponse.ok || !tokens.refresh_token) {
    response.end("Token exchange failed. Check the terminal.");
    console.error("Token exchange failed:", tokens);
    server.close();
    return;
  }

  response.end("Authorized. You can close this tab and return to the terminal.");
  console.log("\nAdd this to your environment (Vercel + .env.local):\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  server.close();
});

let redirectUri = "";

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
  }).toString();

  console.log("Open this URL and sign in with the account that owns the booking calendar:\n");
  console.log(authUrl.toString());
});
