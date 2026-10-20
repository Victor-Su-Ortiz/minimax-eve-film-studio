# Campaign Studio

Turn a creative brief, reference video and brand assets into a finished film—all from one conversation. Built with Vercel eve, powered by MiniMax M3.1 Flash, with H3 generating the footage.

## What it does

An eve director coordinates three specialists: a trend scout finds references, a reference analyst studies the footage, and a take reviewer checks generated scenes. Choose your initial video, then the director plans shots, renders with H3 and exports an MP4 while progress streams into the app. Ask for revisions in the same conversation.

Works with any brand. Storyboards are written shot plans; no image generation is required.

## Get started

Clone this repo and use Node.js 24:

```sh
nvm install
nvm use
npm install
cp .env.example .env.local
```

Add your own `MINIMAX_TEXT_API_KEY` and `MINIMAX_VIDEO_API_KEY` to `.env.local`. Set `MINIMAX_TEXT_MODEL` and `MINIMAX_VIDEO_MODEL` to models your account can access; the defaults are M3.1 Flash Preview and H3. MiniMax endpoints are already configured.

```sh
npm run dev
```

Open [localhost:3000](http://127.0.0.1:3000), attach a reference video and brand assets, and describe your film. Generation uses your paid MiniMax API access.

Search is optional: configure official X (`X_API_BEARER_TOKEN`) or TwitterAPI.io (`TWITTERAPI_IO_API_KEY`), plus Exa (`EXA_API_KEY`) for broader web research. Without search keys, upload your reference video.

## Example: Deploy a Garden

[Download the four-asset kit](docs/examples/deploy-a-garden/deploy-a-garden-assets.zip), unzip it, and attach the PNGs alongside your reference video:

- [Space Bunny](docs/examples/deploy-a-garden/space-bunny-reference.png) — character and style.
- [Vercel triangle](docs/examples/deploy-a-garden/vercel-triangle.png) — deploy button.
- [MiniMax × Vercel lockup](docs/examples/deploy-a-garden/minimax-m31-flash-x-vercel.png) — transparent ending overlay.
- [Dark preview](docs/examples/deploy-a-garden/lockup-preview-dark.png) — appearance guide only.

> Make a cute 20–25-second MiniMax M3.1 Flash × Vercel launch film in 16:9. Space Bunny plants a glowing carrot on the moon, presses a triangular deploy button, and watches a colorful garden bloom. Use my attached video for inspiration and the images for character and branding. End with Bunny waving as the transparent co-brand lockup appears over moving footage—no static end card. Use a written shot plan, then H3. Reuse the reference audio if suitable, shortening the film to fit; otherwise keep H3’s native sound. After I select the reference, continue through review and final MP4 export.

[Full example and original launch reference](docs/examples/deploy-a-garden/README.md)

## More

- [Deploy on Vercel](docs/hosted-starter.md) — Neon, private Blob and protected access for a shared studio.
- [Studio guide](docs/studio-guide.md) — configuration, audio, reference imports, limits and testing.
- [eve documentation](https://eve.dev/docs)
