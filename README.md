# AudioDrop — Google OAuth + ytmusicapi change

This change replaces the manual `cookies.txt` upload flow for playlist access with Google's TV/Limited-Input OAuth flow, which is the OAuth flow documented by ytmusicapi.

## Runtime flow

1. Click **Connect YouTube with Google**.
2. AudioDrop requests a Google device code.
3. The user opens Google's verification page and enters the one-time code.
4. Google shows the AudioDrop consent screen; the user clicks **Allow**.
5. AudioDrop polls Google and receives the access/refresh token.
6. `ytmusicapi.YTMusic(...).get_playlist()` resolves the authenticated playlist.
7. AudioDrop sends the resulting video URLs to yt-dlp for the actual MP3/M4A download.
8. The OAuth session is held in memory for the configured TTL (default 15 minutes) and revoked on disconnect/expiry/job completion.

## Google Cloud setup

1. Create/select a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen / Google Auth Platform branding. Set the application name to `AudioDrop` if that is what you want Google to display.
4. Add your own Google account as a test user while the app is in Testing mode.
5. Create an OAuth client with application type **TVs and Limited Input devices**. This is the client type required by the ytmusicapi OAuth setup.
6. Put the client ID and client secret into the server environment variables below.

```text
GOOGLE_YOUTUBE_CLIENT_ID=...
GOOGLE_YOUTUBE_CLIENT_SECRET=...
YOUTUBE_OAUTH_SESSION_TTL_SECONDS=900
```

No redirect URI is needed for this device-code flow.

## Important limitation

Google OAuth solves the authenticated **playlist metadata** side. It does not turn the OAuth token into a browser cookie for yt-dlp. Therefore, the implementation deliberately uses OAuth/ytmusicapi for playlist resolution and yt-dlp for the media URL download. If an individual selected video is itself private or yt-dlp requires a browser session/PO token for that media request, that individual download can still fail.
