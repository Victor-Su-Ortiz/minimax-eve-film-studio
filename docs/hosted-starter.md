# Deploy your own film studio

Each installation uses its deployer's MiniMax keys and configured model IDs. Text calls go directly to `https://api.minimax.io/anthropic/v1`; video calls use `https://api.minimax.io/v2/video_generation`. No author-owned credentials, AI Gateway, or shared template password are required.

The hosted starter is one studio shared by trusted operators. It uses Neon for campaign state, private Vercel Blob for media, and packaged FFmpeg/ffprobe in Vercel functions. eve runs the agent and durable render waits. Vercel Sandbox persists eve's session workspaces and model-visible image attachments; it is not a separate FFmpeg service. Local mode retains SQLite, local media, and just-bash workspaces. A public multi-tenant service with per-user API-key entry is a separate scope.

## Provision your instance

1. Use Node 24, install dependencies, copy `.env.example` to `.env.local`, and configure your own authorized MiniMax keys/models. The normal film flow needs M3.1 text, H3 video and Image-01 storyboard access. Image generation reuses the video key unless `MINIMAX_IMAGE_API_KEY` is set. Search providers are optional. If credentials must stay exclusively in Vercel, leave them out of local files and use the dashboard configuration path below.
2. Create/link a Vercel project. Enable **Vercel Authentication for all deployments**, including production, under Deployment Protection. This uses Vercel sign-in rather than an app password. The hosted agent trusts that project boundary; do not set `STUDIO_DEPLOYMENT_PROTECTED=true` on an unprotected project.
3. Create a dedicated Neon project/database and a test branch. Put production connection URLs in `.env.deploy.local` and test-branch URLs in `.env.neon-test.local`, using `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). Obtain both from Neon; its returned URL may already be pooled. Add `STUDIO_HOST` to `.env.deploy.local` using the actual production hostname shown in Vercel's Domains settings; it may include your team slug. Use verified TLS. These files are ignored by Git and deployment uploads.
4. Create a private Blob store connected to your Vercel project:

```sh
vercel blob create-store film-studio-media --access private --region iad1 --yes
```

Ensure `BLOB_READ_WRITE_TOKEN` is available to the linked project and, if using the local setup helper, in `.env.local`. Do not overwrite your MiniMax settings when adding Blob configuration. There is no brand asset setup step. Users upload their own logos, product images and reference clips through the app.

For the setup helper, create `.env.deploy.local` with your production values:

```dotenv
DATABASE_URL=postgresql://YOUR_PRODUCTION_POOLED_CONNECTION
DATABASE_URL_UNPOOLED=postgresql://YOUR_PRODUCTION_DIRECT_CONNECTION
STUDIO_HOST=your-actual-production-hostname.vercel.app
```

Create `.env.neon-test.local` with the separate test branch's values:

```dotenv
DATABASE_URL=postgresql://YOUR_TEST_BRANCH_POOLED_CONNECTION
DATABASE_URL_UNPOOLED=postgresql://YOUR_TEST_BRANCH_DIRECT_CONNECTION
```

Replace these placeholders with the complete Neon connection strings, including their TLS parameters. `STUDIO_HOST` is a hostname without `https://` or a path. The helper requires both files even if only production is your immediate target.

## Configure and migrate

The setup helper reads the linked Vercel project, verifies its protection policy, and transfers only the supported environment variables over stdin. It never prints credential values. Production uses the production database; preview uses the isolated test branch.

```sh
node scripts/configure-vercel-env.mjs
node --env-file=.env.neon-test.local scripts/migrate.mjs
node --env-file=.env.neon-test.local --import tsx scripts/check-postgres.ts
node --env-file=.env.deploy.local scripts/migrate.mjs
```

You can also configure variables in Vercel's dashboard instead of using the helper. Hosted mode needs `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `STUDIO_STORAGE=cloud`, and `STUDIO_DEPLOYMENT_PROTECTED=true` after verifying protection, alongside your MiniMax credentials. Set `STUDIO_HOST` to your exact stable production hostname, including any team suffix. Deployment-specific hostnames are also recognized automatically. Configure Production and Preview separately, pointing Preview at the test database. Run `sql/001-studio.sql` on both databases through the Neon SQL editor if you are keeping database credentials out of local files. Provider keys can remain exclusively in Vercel's sensitive server environment variables; do not download them into local files. Redeploy after changing hosted environment variables.

Keep credentials server-side. This template does not accept visitors' API keys through a browser form. X search and uncached X URL imports use either optional `X_API_BEARER_TOKEN` (official X) or `TWITTERAPI_IO_API_KEY`. `X_SEARCH_PROVIDER=auto` prefers official X when available; pin `official` or `twitterapi-io`, or set `none` to disable X. Official recent search covers seven days. Each deployer supplies their own credentials. With no search keys, users upload references and the director skips discovery; no browser-search fallback is implied. Optional `EXA_API_KEY` enables broader public-web research; it does not verify engagement or add video importers. Public TikTok URL extraction uses yt-dlp and needs that executable plus its runtime on the host; the local setup script alone does not provision it inside a Vercel function. Direct video uploads work independently of that extractor.

## Stage, verify, and release

```sh
vercel deploy --prod --skip-domain
vercel curl /api/status --deployment <deployment-url>
vercel curl /eve/v1/health --deployment <deployment-url>
node scripts/check-hosted-agent.mjs <deployment-url>
vercel promote <deployment-url>
```

Inspect the deployment's aliases before assuming it is staged: CLI/project behavior may assign the production alias despite `--skip-domain`. For an isolated rehearsal, use a preview deployment (`vercel deploy`) against the test database. Before release, test the browser flow: attach a video, submit a brief, verify source analysis and subagent activity, generate Image-01 storyboards, render through H3, reload while waiting, and download the final MP4. A successful build alone does not verify model entitlement or video export. Watch and listen to the export; native H3 audio is the default, while source audio must be requested explicitly.

Uploads go directly to private Blob using restricted upload tokens, then the server validates metadata and registers the source. Runtime `/tmp` files are disposable caches: generated takes and finished exports are persisted to Blob before their receipts are committed. Campaign mutations use Postgres transactions and row locks; a paid render reservation is committed before submitting to H3. Uncertain provider submissions must be recovered by task ID, not automatically resubmitted.

The default hosted function duration is bounded to 300 seconds. H3 waiting uses Workflow sleeps rather than holding a function open. The starter targets short launch films; larger edits may need a separate media worker or different function resources.

## References

- [eve deployment](https://eve.dev/docs/guides/deployment/vercel)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [Vercel deployment protection](https://vercel.com/docs/deployment-protection)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
