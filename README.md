# NASAbot

A GroupMe bot that posts NASA's [Astronomy Picture of the Day](https://science.nasa.gov/apod/). Send a message starting with `nasa` and the bot replies with the day's explanation, followed by a link to the full-size image (or to the APOD article on video days).

It runs as a [Cloudflare Worker](https://developers.cloudflare.com/workers/) on your own Cloudflare account. NASA's APOD endpoint needs no API key.

## Self-hosting

You need [Node.js](https://nodejs.org/), a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, and a GroupMe account. Run the commands below in Bash (Git Bash on Windows).

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/JaredP17/NASAbot.git
   cd NASAbot
   npm install
   ```

2. Sign in to Cloudflare and deploy. Wrangler prints the Worker's URL, such as `https://nasabot.<your-subdomain>.workers.dev`.

   ```bash
   npx wrangler login
   npm run deploy
   ```

3. Generate a callback secret and save it to the Worker:

   ```bash
   secret=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
   printf '%s' "$secret" | npx wrangler secret put CALLBACK_SECRET
   echo "https://<worker-url>/receive?secret=$secret"
   ```

   Replace `<worker-url>` in the printed callback URL with your Worker's host. Keep that URL private: anyone who has it can make the bot post.

4. Connect the Worker to GroupMe using one of the options below, then send `nasa` in the group.

`https://<worker-url>/health` returns `{"status":"ok"}` when the Worker is up.

### Option A: Direct GroupMe bot

No third-party service between GroupMe and your Worker. A GroupMe bot belongs to one group, so this suits a single group.

1. Sign in at [dev.groupme.com/bots](https://dev.groupme.com/bots), create a bot in your group, and set its callback URL to the URL from step 3.
2. Save the bot's ID to the Worker:

   ```bash
   npx wrangler secret put GROUPME_BOT_ID
   ```

### Option B: MeBots

[MeBots](https://mebots.io/) lets one bot be added to any number of groups, and passes each group's `bot_id` to the Worker. Messages go through MeBots, so the bot depends on that service being up.

1. Sign in to MeBots with your GroupMe account, create a bot, and set its callback URL to the URL from step 3.
2. Add the bot to groups from its MeBots page.

## Notes

- GroupMe shows the image message as "edited" because it attaches the image preview after the link is posted. This is expected.
- The Workers Free plan allows 100,000 requests per day. Requests over that limit fail rather than being billed. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Development

```bash
npm test      # run the tests
npm run dev   # run the Worker locally
```
