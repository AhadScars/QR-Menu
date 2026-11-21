# Scanora

Multi-tenant restaurant menu platform. A super admin runs the platform, each restaurant owner manages only their own menu, and customers open a public menu by scanning a QR code. No customer account is required.

## Requirements

- Node.js 24 (uses the built-in `node:sqlite` module)

## Run

```bash
npm install
npm start
```

Open http://localhost:4000

`npm start` builds the interface, then serves the API and the site on one port. `npm test` runs the API integration test. `npm run dev` starts the API without rebuilding; use `npx vite` in another terminal if you want the frontend dev server on port 5173.

## Default super admin

| Username | Password    |
| -------- | ----------- |
| admin    | Admin@12345 |

Change this before any real deployment. Set `QR_ADMIN_USERNAME` and `QR_ADMIN_PASSWORD` before the first launch to seed a different account. The password is only created when no super admin exists yet.

## Roles

- **Super admin** signs in at `/admin/login`. Approves or rejects restaurants, activates, deactivates, blocks, assigns plans, extends validity, resets passwords, and generates one-time activation tokens.
- **Restaurant owner** registers at `/register` and signs in at `/login`. A new account is pending and cannot edit the menu until it is approved and has a valid subscription, or until the owner redeems a token.
- **Customer** opens `/menu/restaurant-slug` from the QR code. There is no login.

## Subscription plans

| Plan    | Token prefix | Validity |
| ------- | ------------ | -------- |
| Demo    | `DEMO-`      | 3 days   |
| Monthly | `MNTH-`      | 30 days  |
| Yearly  | `YEAR-`      | 365 days |

A token can be redeemed once. Redeeming it approves the restaurant, activates the account, and creates the QR code. Extra days are added to the current expiry when the subscription is still active. If it has already expired, the new period starts now. Admin extensions follow the same rule and do not require a token. Categories, dishes, photos, and the QR code are kept when a subscription expires.

Customer behavior for an expired subscription is set in Admin → Settings:

- Hide the menu
- Show a subscription-expired message
- Allow read-only viewing

## Environment

| Variable | Purpose |
| -------- | ------- |
| `PORT` | HTTP port. Default `4000`. |
| `QR_DB_PATH` | SQLite file. Default `data/qrmenu.db`. |
| `QR_UPLOADS` | Image directory. Default `uploads/`. |
| `QR_ADMIN_USERNAME` | Seeded super admin username. |
| `QR_ADMIN_PASSWORD` | Seeded super admin password. |
| `QR_BCRYPT_ROUNDS` | Password hash cost. Default `12`. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase key. |
| `SUPABASE_SECRET_KEY` | Server-only Supabase key. Never send this to the browser. |
| `SUPABASE_JWKS_URL` | Supabase Auth signing keys. |

Copy `.env.example` to `.env` and fill in the Supabase values. Menu data stays in SQLite. Each restaurant owner is also copied to Supabase Authentication, under Users, with the address `username@owners.scanora.app`. Look there to see new owners. The secret key stays on the server and is never sent to the browser.

If SQLite reports locking errors on a network drive, point `QR_DB_PATH` at a local disk.

## Security notes

Passwords are hashed with bcrypt. Sessions are random, httpOnly, SameSite cookies. Every protected API checks the role on the server. Owner queries are scoped by `restaurant_id`. Uploads are limited to 5 MB JPEG, PNG, or WebP files and checked by file signature. Login, registration, and token redemption are rate limited. Expired, blocked, invalid, and already-used tokens are rejected.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the schema, permission matrix, and API map.

## Deploy on Vercel

The site and the API deploy together. `app.js` is the Express entry Vercel runs. `npm run build` writes the React app into `public/` and copies it to `server/site/`, which the server ships with the function. `/` and pages such as `/login` and `/menu/your-slug` are served from that build. `/api` and `/uploads` stay on the API.

1. Push this project to GitHub.
2. In Vercel, import the repository. Set the Framework Preset to **Express**. Set the Build Command to `npm run build`. Leave the Output Directory override **off**. Do not set it to `public` or `dist`. An output directory makes Vercel look for the server inside the built website and the API will not deploy. Do not leave the preset on Vite.
3. Leave the Node.js version on **24.x**. `package.json` already requests it. The server needs the built-in `node:sqlite` module.
4. Add these environment variables. Do not set `QR_DB_PATH`, `QR_DATA_DIR`, or `QR_UPLOADS`. Vercel can only write to `/tmp`.
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_JWKS_URL`
   - `QR_ADMIN_USERNAME`
   - `QR_ADMIN_PASSWORD`
5. Deploy. Open the Vercel URL.

Vercel does not keep a disk. The SQLite database and uploaded photos live in `/tmp` and are cleared when Vercel replaces the running instance. New restaurants and menu edits can disappear. Set `QR_ADMIN_PASSWORD` before the first deploy so the seeded admin is not left on the default password. Keep using `npm start` on your own computer when the menu data needs to stay.

