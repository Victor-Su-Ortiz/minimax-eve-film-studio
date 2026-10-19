# MiniMax eve Film Studio

A private local production workspace that decodes a social campaign's creative structure and turns it into an original MiniMax M3.1 launch film. M3.1 develops the breakdown, treatments and shot plans; MiniMax H3 generates video; Vercel eve runs the director agent and durable render waits.

This repository contains the runnable local app. It is not a hosted multi-user service. See [the hosted starter plan](docs/hosted-starter.md) for the minimum changes needed to run it on Vercel with Neon.

Each person cloning or deploying the template supplies their own MiniMax API keys and model IDs. The template connects directly to the preconfigured MiniMax endpoints; no author-owned credentials or AI Gateway account are included or required.

## Run locally

Use Node.js 24 or newer and install FFmpeg (including ffprobe).

```sh
nvm install
nvm use
npm install
cp .env.example .env.local
npm run dev
```

Open [the studio](http://127.0.0.1:3000). The app binds to loopback. Add your own credentials and model IDs to `.env.local`, then restart. The defaults below preserve the demo's model configuration; choose IDs and keys your MiniMax account is authorized to use. Text and video keys may differ:

```dotenv
MINIMAX_TEXT_API_KEY=your_text_key
MINIMAX_TEXT_MODEL=MiniMax-M3.1-Flash-Preview
MINIMAX_VIDEO_API_KEY=your_video_key
MINIMAX_VIDEO_MODEL=MiniMax-H3
```

The preconfigured text endpoint is `https://api.minimax.io/anthropic/v1`; the video endpoint is `https://api.minimax.io` using `/v2/video_generation`. Keep these MiniMax endpoints for normal setup. `MINIMAX_TEXT_MODEL` configures the director and all three specialists. `MINIMAX_VIDEO_MODEL` configures new video submissions and must support the H3/V2 request format. The browser receives configuration status, never provider keys. A template-wide shared password is not required for local use.

## Campaign to launch film

The main page has one prompt box. Describe the campaign and the film you want, paste a source link, or attach up to 10 clips/images per message. A campaign can retain 10 source assets and 10 source links; official brand artwork is kept separately. The director selects a valid subset for each H3 shot; the provider's per-shot media and duration limits still apply. For example: “Make a cinematic 30-second MiniMax M3.1 launch film inspired by the dancing dogs trend. Start small, go unexpectedly big, and loop the ending.”

M3.1 interprets the request into a saved brief, develops a creative breakdown and visual direction cards, then waits for you to choose the initial source video. After that choice, it plans the sequence, renders all scenes, delegates frame review, selects usable takes and exports the film automatically. The output canvas shows actual tool activity, references, the proposed sequence, real rendered takes and the exported film. Keep directing in the same box: “Use the second idea,” “Make the opening quieter,” or “Change the ending.” The agent can select a direction from ordinary language. It chooses a sensible default when asked to make the film without further direction.

Reference selection is the only normal checkpoint. There are no required take approvals or separate export clicks. The director may make one corrective render per scene; the final take selection automatically assembles the branded MP4. Optional **Revise** remains available after production, and previous takes stay preserved. A failed or uncertain provider job can still require attention. Final release means the downloadable MP4, not public posting. There is no simulated progress, canned model output or generated footage shown before the provider returns it. A missing connection saves the prompt and shows setup instructions without dispatching a model request.

The agent retrieves public TikTok and X video references from full post URLs, saves the original MP4 locally and displays source cards with attribution, publication dates and reported engagement counts. TwitterAPI.io retrieves up to six candidates above 100,000 reported views across up to three pages per search. The M3.1 scout downloads each candidate without changing the campaign, receives an eight-frame timestamped contact sheet, and records a visual verdict with evidence. Only matched, curated candidates enter recommendations; unavailable, uncertain, caption-only and low-view candidates cannot qualify.

Retrieval words and the visual target are separate. The scout can search broader subjects, known creator feeds, or omit caption keywords entirely while retaining a visual target such as “a dog performing dance-like movements.” This makes generic-caption videos eligible for visual review, but it is bounded retrieval, not a visual index of all X videos. Sampled frames do not verify continuous motion or audio. The gallery shows review progress, match reasons and timestamped evidence. Search results are not a platform-wide trend ranking or proof of the original upload. TikTok extraction uses the official yt-dlp package and its normal public session, without using browser credentials. Install the project-local extractor with `npm run setup:video-import` and add `TWITTERAPI_IO_API_KEY` to `.env.local` for live X search.

Automatic imports are limited to 32 MB and two minutes. Only exact TikTok `/@creator/video/ID` and X `/creator/status/ID` links are supported; shortened links must be expanded. Private, unavailable or blocked posts show a retrieval error instead of an invented analysis. Clip references supply up to twelve timestamped still frames, including denser opening samples. Still frames do not verify continuous movement or source audio. Explanations for engagement remain hypotheses. Campaign assets are not automatically attached to H3 generation requests.

Selecting a reference must update the actual unlocked shot prompts. Each generated shot records `sourceBasis` with the current analysis ID, inspected assets, and a concrete creative adaptation; that adaptation is included in the H3 text request. Stale plans cannot start a new render. The sequence displays these source-to-shot connections and labels whether footage is an actual H3 video input or creative inspiration. “Use this reference” asks the agent to supply the selected clip as a visual input on relevant shots; H3 media limits still apply. Existing takes are preserved and marked as earlier footage when their source plan changes.

In local development, credential access reads the current project `.env.local` so Next.js and eve's workflow worker cannot disagree because of inherited empty credentials. The agent receives connection-presence flags only, never keys. API entitlement still requires a successful provider request. `npm run dev` starts eve with `--resume` before Next.js, preserving saved conversations across restarts and keeping configuration reloads from replacing the agent process. Pending workflow recovery uses eve's retained snapshots; existing H3 task IDs remain protected from duplicate submissions.

The detailed editor is preserved at [`/studio`](http://127.0.0.1:3000/studio) for manual shot controls, recovery and production history.

**9:16 social** produces portrait H3 jobs and 1080 × 1920 MP4 exports. **16:9 widescreen** produces landscape jobs and 1920 × 1080 exports. Format is saved on each render job, and export reuse is keyed by format as well as shot choices. Existing takes are preserved; footage with a different shape is fitted and padded. The title card uses the official M3.1 Flash Figma lockup over animated flower artwork.

## MiniMax film branding

The supplied [M3.1 Flash Figma kit](https://www.figma.com/design/OBZtbEFlEn8ilGAdqKpk5q?node-id=1311-7298) is bundled under `public/brand/m31-flash`, with node provenance and SHA-256 hashes in `sources.json`. `get_brand_assets` shows the director the real launch hero and registers the text-free flower image as a reusable H3 reference. The director can include it in relevant shots’ `referenceIds` for the color, lighting and sculptural motif. Brand assets do not become social-reference evidence or change the campaign revision.

New exports composite the exact white MiniMax wordmark over footage and a stationary official M3.1 Flash lockup over a gently moving flower background. There is no extra tagline. Asset fingerprints version the picture cache, so branding updates cannot reuse an old unbranded export. Original takes and previous exports remain intact; audio-only edits reuse the branded pictures. Raw H3 takes do not include these precise overlays.

## Detailed editor controls

1. Add approved launch facts to **The brief**. Upload your own source footage and visual references in **Media library**.
2. Ask M3.1 to pitch three directions. Select a treatment; M3.1 updates the shot board without generating yet.
3. Pick a generated shot and add references from the library. Ask M3.1 to render that shot. H3’s task ID and status appear in **Activity**.
4. Review the returned take and its sampled-frame review. Play it to check motion and audio. **Accept take** selects it and locks the shot.
5. Unlock only the shot you want revised, then give a note with that shot selected. Compare the new take to the accepted take and accept it when ready.
6. Assign your real opening footage with **Use footage**. Once every source/generated shot has an accepted take, **Export film** assembles the film into a downloadable 1080p MP4. The final title card uses the official M3.1 Flash Figma artwork. Download the last export from **Activity** or preview it with **Play last export**.

The initial storyboard is a human-authored treatment, clearly labelled as concept boards. It is not generated footage or a claim that M3.1 has already directed the film. There are no simulated model responses or fake generation jobs.

## What is implemented

- Prompt-first Next.js app with one text box, optional attachments, natural-language direction, actual tool activity and a visual output canvas.
- Detailed editor: brief, shot board, source library, shot inspector, takes, comparison, locking, production activity and exports.
- Campaign references, versioned creative breakdowns with timestamped evidence and hypotheses, a dancing-dogs starting brief, and portrait/widescreen delivery.
- Real eve agent with M3.1 via `@ai-sdk/anthropic`, typed tools and a resumable browser conversation.
- Three declared M3.1 subagents: trend scout, reference analyst and take reviewer, each with a narrow tool set and its own eve session. The single-input studio follows their child streams and displays actual task status, tool activity and findings. Independent scouting and source analysis can run in parallel; only the director can modify plans or request renders. No child can accept or unlock takes.
- H3 V2 submission, persisted provider task IDs and durable polling through `defineWorkflowTool`.
- Local media uploads, metadata validation, reference encoding and four-frame visual inspection.
- SQLite transactions shared by the Next.js and eve processes; media and accepted renders saved to disk.
- FFmpeg assembly with normalized video/audio, an authored title card, versioned portrait/widescreen exports and range-served playback.

## Reliability and limits

Submissions reserve a unique operation in SQLite before calling H3. Replays reuse the saved operation. An uncertain submission blocks a new job for that shot; it does not automatically submit again. If the provider accepted a job but its response was lost, recover the task ID in the MiniMax console and attach it in **Activity**. A response lost between submission and persistence cannot be made exactly-once without provider-side idempotency.

H3 reference videos and audio must each be 2–15 seconds, with total reference duration at most 15 seconds per modality. Images and clip dimensions must match the current API limits. This local build accepts files up to 32 MB, uses inline reference data and bounds the encoded request size. Use MP4 for H3 video references; MOV is supported as source footage for assembly.

Visual review sends four timestamped still frames together in one contact sheet, so the reviewer can compare every sample in a single image. Fresh inspections start a new specialist task; clarifying an existing report can reuse its task. It does not evaluate all motion, voice intelligibility, music licensing or soundtrack quality. Perform a playback/listening pass before release. Exports use straight cuts and a separate soundtrack: an explicitly selected original reference recording (once by default, loop only when requested), a local synthesized instrumental score, or silence. H3 take audio is excluded. Visual references sent to H3 are muted without modifying the original files. Audio-only revisions reuse the encoded pictures and preserve previous exports; audio checks record source provenance and duration, not a listening review.

This version is **local only**: `.studio/` holds SQLite and media; `.eve/` contains eve’s local run state. Keep those folders for continuity. `STUDIO_DATA_DIR` can point to another persistent local directory but must resolve to the same location in both processes. It must be absolute when overridden. Do not run multiple studios on the same data directory. Vercel-hosted storage is deliberately rejected until shared media/manifest storage and production authentication are configured. The eve channel also admits local development only. No deployment has been created.

Live M3.1 and H3 calls require real credentials and were not verified during the initial build. The production tests use a test-only provider fixture and real FFmpeg media; that fixture is never available as an application mode.

The current dependency audit reports a moderate, unpatched denial-of-service advisory in `sprintf-js`, inherited through the local `just-bash` sandbox package. Arbitrary agent shell tools are disabled in this application. Recheck the upstream fix before expanding execution capabilities or production deployment.

## Checks

```sh
npm run typecheck
npm test
npm run build:agent
npm run build
```

Tests cover concurrent/replayed submissions, uncertain provider responses, locked-shot protection, candidate-take preservation, real upload/frame extraction, MP4 assembly, byte-range playback and local API access. FFmpeg must be installed. Production media is not used by tests.

With the development server running and Playwright Chromium installed, `npm run test:browser` checks the initial editor’s save/reload flow, missing-key setup, shot inspection and responsive layout. It briefly edits and restores the brief; use it on the initial project, before producing real takes. `PLAYWRIGHT_EXECUTABLE_PATH` can point to an existing compatible Chromium installation.

## Sources

- [MiniMax text generation](https://platform.minimax.io/docs/guides/text-generation)
- [H3 create task](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)
- [H3 query task](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)
- [eve Next.js integration](https://eve.dev/docs/guides/frontend/nextjs)
- The exact eve and Next.js APIs are documented in their installed packages under `node_modules/eve/docs/` and `node_modules/next/dist/docs/`.
