# KagePlay Discord Announcement Bot

This is a standalone Discord bot designed to automatically check your Anime API for new episodes, movies, or series, and post beautiful embed announcements to your Discord server, optionally pinging a specific role!

## Features
- Periodically checks the `/api/newadded` endpoint for new content.
- Remembers the last announced episode to prevent duplicate pings (stores state in `last_seen.json`).
- Posts a stylized Embed message with the Anime title, Season, Episode, and Poster image.
- Can ping a specific role (e.g., `@Anime Announcements`).

## Setup Instructions

### 1. Create a Discord Bot
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click "New Application" and give it a name.
3. Go to the "Bot" tab and click "Add Bot".
4. Copy the **Token** (keep this secret!).
5. Under "Privileged Gateway Intents", enable **Message Content Intent**.
6. Go to "OAuth2" -> "URL Generator". Select the `bot` scope and give it `Send Messages` and `Embed Links` permissions.
7. Copy the generated URL, open it in your browser, and invite the bot to your server.

### 2. Configure the Bot
1. Rename the `.env.example` file to `.env`.
2. Open `.env` and fill in your details:
   - `DISCORD_TOKEN`: Paste your bot token here.
   - `ANNOUNCEMENT_CHANNEL_ID`: Right-click your announcement channel in Discord and select "Copy Channel ID" (requires Developer Mode enabled in Discord settings).
   - `PING_ROLE_ID`: (Optional) Right-click a role in your server settings and copy its ID. Leave blank if you don't want to ping anyone.
   - `API_URL`: Replace with your deployed API URL (e.g., `https://my-anime-api.vercel.app/api/newadded`).

### 3. Install Dependencies
Run the following command in this directory:
```bash
npm install
```

### 4. Run the Bot
You can start the bot using:
```bash
npm start
```

### 5. Deployment
You can host this bot 24/7 for free using services like [Railway](https://railway.app/), [Render](https://render.com/), or [Fly.io](https://fly.io/). Simply push this folder to GitHub and link it to the hosting provider, making sure to add your `.env` variables to their environment settings.
