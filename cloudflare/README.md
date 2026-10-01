# Cloudflare Containers deployment

This directory deploys Control-agent's existing ECC capabilities dashboard behind a Cloudflare Worker and Container.

## Requirements

- Cloudflare account with Containers access
- Docker available where Wrangler performs the deployment
- Node.js 18+

## Deploy

```bash
cd cloudflare
npm install
npx wrangler login
npm run deploy
```

The Worker routes requests to a single Cloudflare Container. The container runs the repository's existing dashboard on loopback and exposes it through an internal proxy on port 8080.
