# Cloudflare Workers deployment

This deployment uses Cloudflare Workers Static Assets and a Worker-backed OpenAI chat endpoint. It does not use Cloudflare Containers.

Cloudflare dashboard settings:
- Root directory: `/cloudflare`
- Build command: leave empty
- Install command: `yarn install --immutable`
- Deploy command: `yarn deploy`
- Version command: `yarn run version`

Use the pinned Yarn version in `package.json`. The committed lockfile fixes the Wrangler and runtime dependency versions used by builds.

After reconnecting the Git integration, a new push to `main` should create a build. Check the Cloudflare Builds tab for the new commit; reconnecting alone may not build an existing commit.

The Cloudflare build command should remain empty: this directory has no `build` script and Wrangler bundles the Worker during deployment.

For a repository-root Deploy Hook, install in `cloudflare` and invoke its Wrangler binary with the root config:

```sh
cd cloudflare
yarn install --immutable
yarn exec wrangler deploy --config ../wrangler.jsonc
```

Set `APP_ACCESS_TOKEN` and `OPENAI_API_KEY` as Worker secrets using `yarn exec wrangler secret put NAME` or the Cloudflare dashboard. Never commit their values. The app token authenticates browser chat requests; the provider key remains on the server. OpenAI usage has its own billing.

Validate without publishing using `yarn exec wrangler deploy --dry-run`. Run locally with `yarn dev`; put local secrets in the ignored `cloudflare/.dev.vars` file. Check `GET /api/health`, load `/`, and send an authenticated `POST /api/chat` with a string `message` and optional user/assistant `history`.

The `CHAT_RATE_LIMITER` binding allows ten authenticated chat requests per minute per Cloudflare location, shared by this app. This is a local rate limit, not a global billing cap. Missing or unavailable rate-limit bindings fail closed. Provider failures return a generic JSON error, and requests time out after 30 seconds.

Both Wrangler configs retain the historical `v1` Durable Object migration and its exported class for deployment compatibility. Check the deployed migration history before changing or deleting them.

Worker and browser regression tests run with the repository's `npm test` suite. They mock provider calls and do not require secrets.

This deployment does not run Claude Code, Codex, shell commands, hooks, or a persistent agent runtime on the server. Those capabilities require a container/VM or a Workers-native execution backend.
