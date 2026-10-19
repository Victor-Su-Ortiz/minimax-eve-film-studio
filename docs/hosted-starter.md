# Hosted starter: one trusted operator

The local app works with SQLite, local media, FFmpeg and eve's local runtime. This document is a deployment plan, not an implemented deployment. Setting `DATABASE_URL` alone will not make the app use Neon. Local-only request and storage checks intentionally reject Vercel today.

## Minimum Vercel setup

| Part | Purpose | Change needed |
| --- | --- | --- |
| Next.js + eve on Vercel | UI, agent sessions, durable H3 waits | Configure production eve authentication and environment variables. |
| Neon Postgres | Campaign documents, media metadata, render operations and export receipts | Replace synchronous local SQLite access with an asynchronous transactional store. Use a dedicated test branch/project and row locking or version checks to preserve concurrent-edit and duplicate-render protection. |
| Private Vercel Blob | Uploaded references, H3 takes, extracted frames and final exports | Replace filesystem paths with object IDs; authorize media reads/uploads and stream or sign downloads. |
| Vercel Sandbox media worker | FFmpeg/ffprobe extraction, normalization and MP4 assembly | Package the binaries, stage authorized files, run fixed commands and persist the outputs to Blob before reporting success. Have eve workflow steps track processing jobs. |
| Shared-password access | One trusted operator, like eve's chat starter | Protect the UI, studio APIs and eve session routes with the same signed-session policy. Keep secrets on the server. |
| MiniMax text + video credentials | Actual model calls | Confirm the configured text model and H3 entitlement with the deployment's keys. TwitterAPI.io is optional when users supply a reference. |

Neon stores structured project state; video bytes belong in object storage. Keep the current local adapter for people running the template on their own machines. A hosted starter can keep one shared studio for trusted users; independent user accounts and project isolation are a separate product scope.

For the first hosted test, use a supplied video/upload so social-platform retrieval is not a prerequisite. Add server-enforced render/concurrency limits, job-level logs, bounded retries and an explicit recovery path for uncertain H3 submissions. Do not automatically resubmit a paid render when its status is unknown or when only the export failed.

## Verification before sharing a hosted URL

1. A password is required for the UI, API mutations, media and eve streams.
2. Refreshing or closing the browser during H3 generation preserves the saved task and resumes progress without a second submission.
3. An export failure can be retried using existing takes.
4. Media and campaign state survive deployment/restart; a final MP4 plays and downloads.
5. A second render request cannot bypass the per-studio budget or duplicate a running job.

## References

- [eve chat starter and optional production modes](https://eve.dev/templates/eve-chat-template)
- [eve deployment](https://eve.dev/docs/guides/deployment/vercel)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
