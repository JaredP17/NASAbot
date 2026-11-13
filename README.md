 # NASAbot

NASAbot is a [MeBots](https://mebots.io/) callback hosted on Cloudflare Workers. It responds to user messages that start with `nasa` by posting NASA's Astronomy Picture of the Day and its media URL to the group that sent the message.

## Deploy

Run these commands from the project directory in Bash or Git Bash.

1. Install Node.js, then run `npm install`.
2. Create or use a Cloudflare account on the Workers **Free** plan, then sign in with `npx wrangler login --device`.
3. Deploy the Worker with `npm run deploy`. Wrangler prints its `workers.dev` URL.
4. Generate a long random callback secret, then save it as a Worker secret:

   ```bash
   secret=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
   printf '%s' "$secret" | npx wrangler secret put CALLBACK_SECRET
   ```

   Keep `$secret` private and use it in the next step from the same shell session.

5. In the bot's MeBots edit page, set its callback URL to `https://<worker-url>/receive?secret=<secret>`, replacing both placeholders. Run `printf '%s\n' "$secret"` to display the generated value if needed. Keep this entire URL private: anyone who knows it can send callbacks, and URL logs may contain it. MeBots adds the group-specific `bot_id` to each callback. A direct GroupMe bot callback does not include that field.
6. Send a message starting with `nasa` in the bot's group. Check `https://<worker-url>/health` for a basic health check.

The Worker uses NASA's public APOD endpoint, which does not require an API key. Image entries link to the full-size image; video entries link to the APOD article.

Run `npm test` for local tests and `npm run dev` to run the Worker locally.

Cloudflare Workers Free includes up to 100,000 requests per day. Requests over the free limit fail instead of switching to paid usage. The `workers.dev` URL is intended for personal or hobby projects; no custom domain is needed. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

Deploying this Worker does not remove any existing AWS resources. If you have an old AWS deployment, review and remove its resources separately to avoid ongoing charges.
