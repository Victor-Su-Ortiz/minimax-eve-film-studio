# Campaign Studio

Turn a creative brief, reference video and brand assets into a finished film—all from one conversation. Built with Vercel eve, powered by MiniMax M3.1 Flash, with H3 generating the footage.

## What it does

An eve director coordinates three specialists: a trend scout finds references, a reference analyst studies the footage, and a take reviewer checks generated scenes. eve keeps the conversation and production state, manages render waits, and streams progress into the app. M3.1 Flash powers the agents; H3 creates the video; FFmpeg assembles the final MP4.

Choose your initial reference, then the director plans, renders, reviews and exports. Ask for revisions in the same conversation while preserving accepted takes. Works with any brand; assets are supplied by you. Storyboards are written shot plans, with no image-generation step.

## Get started

You need Node.js 24 and your own MiniMax API access for text and H3 video. Local mode uses SQLite and files on disk; no cloud database is needed. FFmpeg/ffprobe are bundled for supported platforms.

Clone this repository, enter its directory, then run:

```sh
nvm install
nvm use
npm install
cp .env.example .env.local
```

Edit `.env.local` before starting:

```dotenv
MINIMAX_TEXT_API_KEY=your_text_key
MINIMAX_TEXT_MODEL=MiniMax-M3.1-Flash-Preview
MINIMAX_VIDEO_API_KEY=your_video_key
MINIMAX_VIDEO_MODEL=MiniMax-H3
```

Use model IDs your account can access. Text and video keys can differ; the video model must support the H3/V2 API. MiniMax endpoints are already configured. Keys stay server-side, and generation uses your paid API access.

```sh
npm run dev
```

Open [localhost:3000](http://127.0.0.1:3000). Restart after changing configuration. Keep `.studio/` and `.eve/` to retain local media and conversations.

### Optional discovery

You can make a film from uploaded footage without any search keys.

| Service | Environment variable | Enables |
| --- | --- | --- |
| Official X API | `X_API_BEARER_TOKEN` | Recent X search and video imports; requires endpoint access and quota. |
| TwitterAPI.io | `TWITTERAPI_IO_API_KEY` | Alternative X search and video imports. |
| Exa | `EXA_API_KEY` | Broader web research; results are links, not automatically imported videos. |

`X_SEARCH_PROVIDER=auto` prefers official X when configured, otherwise TwitterAPI.io. Set `official`, `twitterapi-io`, or `none` to choose explicitly. For optional local TikTok imports, install Python 3 and run `npm run setup:video-import`.

## Make your first film

1. Attach a reference video and your logo/character images with the paperclip, or paste a supported video URL when its importer is configured. Uploads can be up to 32 MB each.
2. Describe the concept, format and any audio preferences in the single text box. A single attached video is selected automatically; choose a reference when the app offers multiple candidates.
3. Watch the shot plan, specialist activity and rendered takes appear, then download the final MP4. You can ask for changes without starting over.

Exports support 9:16 and 16:9. H3's native audio is kept by default; explicitly request reference audio if you want to reuse it. Review motion and sound in the finished film—the agents' visual checks use sampled frames. Export creates a downloadable file; it does not publish to social media.

## Example: Deploy a Garden

[Download the four-asset kit](docs/examples/deploy-a-garden/deploy-a-garden-assets.zip), unzip it, and attach the PNGs alongside your reference video:

- [Space Bunny](docs/examples/deploy-a-garden/space-bunny-reference.png) — character and style.
- [Vercel triangle](docs/examples/deploy-a-garden/vercel-triangle.png) — deploy button.
- [MiniMax × Vercel lockup](docs/examples/deploy-a-garden/minimax-m31-flash-x-vercel.png) — transparent ending overlay.
- [Dark preview](docs/examples/deploy-a-garden/lockup-preview-dark.png) — appearance guide only.

> Make a cute 20–25-second MiniMax M3.1 Flash × Vercel launch film in 16:9. Space Bunny plants a glowing carrot on the moon, presses a triangular deploy button, and watches a colorful garden bloom. Use my attached video for inspiration, space-bunny-reference.png for the character, and vercel-triangle.png for the button. End with Bunny waving as the exact transparent minimax-m31-flash-x-vercel.png appears over moving footage. lockup-preview-dark.png is an appearance guide only: never composite its opaque background into the film. No static end card or generated lettering. Use a written shot plan, then H3. Reuse the reference audio if suitable, shortening the film to fit; otherwise keep H3’s native sound. After I select the reference, continue through review and final MP4 export.

[Full example and original launch reference](docs/examples/deploy-a-garden/README.md)

## Deploy on Vercel

The hosted version needs Neon Postgres, private Vercel Blob storage, and your server-side MiniMax credentials. It is one shared studio for trusted operators; enable Vercel Authentication for all deployments. Follow the [hosted setup guide](docs/hosted-starter.md) for provisioning, environment variables, migrations and verification.

## Development and docs

```sh
npm run typecheck
npm test
npm run build:agent
npm run build
```

- [Studio guide](docs/studio-guide.md) — configuration, audio, reference imports, limits and testing.
- [Environment example](.env.example) — all supported setup options, including FFmpeg path overrides.
- [eve documentation](https://eve.dev/docs)
