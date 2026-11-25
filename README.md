# Aero Archive

Aero Archive is a single-author visual archive for games, music, and image-led notes. The public archive is read-only; posting lives behind the private console at `/#admin`.

## Run locally

1. Copy `.env.example` to `.env`.
2. Replace `ADMIN_PASSWORD` with a long, unique passphrase. Set `SESSION_SECRET` to a second long random value for any public deployment.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

Use `http://localhost:3000/#admin` to sign in and create, edit, publish, or delete posts.

Each post can include optional 1–10 scores for replayability, length, story, graphics, music, and gameplay. The console calculates the overall rating from the criteria you score.

## What is stored

- Posts are saved locally in `data/posts.json`, created automatically on first publish.
- Uploaded images are saved in `uploads/` and are served as immutable public files once published.
- The starter imagery is only sample content; replace it through the private console.

The server accepts JPEG, PNG, WebP, GIF, and AVIF images, with a 20 MB total limit per post request.

## Deploy on Cloudflare

The Cloudflare deployment is a Worker with static assets, a D1 database for posts, and an R2 bucket for uploaded images. The original Node server remains available for local-only use.

1. Run `npm install`, then `npx wrangler login` and complete the Cloudflare browser sign-in.
2. Run `npm run cf:deploy`. Wrangler provisions the configured D1 and R2 bindings on the first CLI deployment.
3. Run `npm run cf:migrate` to create the posts table and seed the sample posts.
4. Set production secrets (never add these to `wrangler.jsonc`):

   ```sh
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```

   `SESSION_SECRET` must be a second, long random value, distinct from the admin password.
5. Run `npm run cf:deploy` again. Wrangler prints the public `workers.dev` URL. Add a custom domain from the Worker’s Cloudflare dashboard when you are ready.

For local Worker development, copy `.dev.vars.example` to `.dev.vars`, supply local-only secrets, then run `npm run cf:dev`.

## Email updates

The Cloudflare deployment supports a confirmed mailing list through [Resend](https://resend.com/). Subscribers confirm by email and can unsubscribe from each announcement. A post sends an announcement the first time it is published, including when publishing a draft. Edits and later republications do not send another announcement. Existing published posts are marked as already announced by the migration.

1. Create a Resend account, verify a sending domain, and create an API key.
2. Apply the D1 migrations with `npm run cf:migrate` before deploying the updated Worker.
3. Set the Worker secrets `RESEND_API_KEY`, `MAIL_FROM` (for example `Archive <updates@example.com>` on your verified domain), and `SITE_URL` (the canonical public site URL) using `npx wrangler secret put NAME`. Configure these before publishing posts you want to announce.
4. Deploy the Worker. For local Worker testing, add the same values to `.dev.vars` and use `npx wrangler d1 migrations apply DB --local`. The standalone Node server does not send mail.

Email delivery depends on Resend's account limits. A delivery failure is reported in the posting console and Worker logs; failed notifications are not automatically retried. The mailing list is stored in D1.
