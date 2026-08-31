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
