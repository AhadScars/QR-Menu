# Architecture

Scanora is a single Node.js process. Express serves a JSON API and the built React app. SQLite (`node:sqlite`) stores every tenant. There is no separate customer account table.

## Permission matrix

| Capability | Super admin | Restaurant owner | Customer |
| ---------- | ----------- | ---------------- | -------- |
| Platform stats, restaurants, tokens, audit, settings | Yes | No | No |
| Own restaurant profile | No | Yes, unless blocked or rejected | No |
| Create, edit, delete categories and dishes | No | Yes, only when approved, active, not blocked, and subscription is unexpired | No |
| View own categories and dishes after expiry | No | Yes. Data is not deleted. | No |
| Redeem an activation token | No | Yes, unless the restaurant is blocked | No |
| Public menu | No | Preview only | Yes, for the scanned restaurant |

Server middleware enforces this on every request. The interface hides actions, but that is not the security boundary.

An owner session loads one restaurant. Category, dish, profile, and QR queries all include `restaurant_id = session restaurant`. A guessed id from another restaurant returns 404.

## Data model

Permanent ids are UUIDs. `display_order` is a separate dense sequence (1…n) used only for presentation. Deleting a dish rewrites `display_order` and does not change any primary or foreign key.

- `users` — super admin and owner logins. Username is unique case-insensitively. Password is a bcrypt hash.
- `restaurants` — one row per owner. Holds slug, profile, `approval_status` (`pending`, `approved`, `rejected`), `account_status` (`inactive`, `active`, `deactivated`), and `is_blocked`. Block is separate from activation so unblocking restores the previous account state.
- `subscriptions` — one row per restaurant. Plan is `none`, `demo`, `monthly`, or `yearly`. Stores `activation_date` and `expiry_date`. Status is calculated from the server clock, not stored.
- `activation_tokens` — unique code, plan, `unused` / `redeemed` / `blocked`, redeemer id, restaurant name snapshot, generated and redeemed timestamps.
- `categories` — `restaurant_id`, name, description, image, `display_order`, active flag. Name is unique per restaurant.
- `dishes` — `restaurant_id`, `category_id`, name, description, prices in cents, image, `veg` or `non_veg`, availability, `display_order`.
- `qr_codes` — one row per restaurant, created on first successful activation. The image is rendered from the slug at request time, so menu edits do not need a new code.
- `audit_logs` — super admin and redemption events.
- `platform_settings` — expired-menu behavior (`hide`, `message`, `readonly`) and the expiring-soon window.
- `sessions` — random id, user, expiry.

## Authentication

1. Register creates an owner user, a pending restaurant, and an empty subscription in one transaction.
2. Login checks the portal (`admin` or `owner`), compares the password, and stores a new session id in an httpOnly cookie. The previous session id is discarded.
3. Logout deletes the session.
4. `/api/auth/me` returns the role and, for an owner, the current restaurant summary.

## Subscription flow

Menu writes require approval, `account_status = active`, `is_blocked = 0`, and `expiry_date` in the future.

Token redemption, inside a transaction:

1. Reject missing, blocked, redeemed, or already-claimed tokens.
2. Mark the token redeemed.
3. If the current expiry is in the future, add the token’s days to that expiry and keep the original activation date. Otherwise start from the current time and set a new activation date.
4. Set the plan, approve the restaurant, mark the account active, and create the QR row if needed.

Manual admin extension uses the same date rule without a token. Assigning a demo, monthly, or yearly plan applies that plan’s fixed length (3, 30, or 365 days).

Public menu decision order: unknown slug → 404; blocked, pending, rejected, inactive, or deactivated → unavailable; expired and behavior `hide` → generic unavailable; expired and behavior `message` → subscription-expired message; expired and behavior `readonly` or an active subscription → menu. Inactive categories and categories with no dishes are omitted. Unavailable dishes stay visible and are marked.

## API

- `POST /api/auth/register` `POST /api/auth/login` `POST /api/auth/logout` `POST /api/auth/password` `GET /api/auth/me`
- `GET /api/admin/stats` `GET /api/admin/restaurants` `GET /api/admin/restaurants/:id`
- `POST /api/admin/restaurants/:id/approve|reject|activate|deactivate|block|unblock|extend|assign-plan|reset-password`
- `DELETE /api/admin/restaurants/:id` with `{ "confirmName" }`
- `POST /api/admin/tokens` `GET /api/admin/tokens` `POST /api/admin/tokens/:id/block|unblock`
- `GET /api/admin/audit` `GET /api/admin/settings` `PUT /api/admin/settings`
- `GET /api/owner/dashboard|profile|subscription|categories|dishes|qr`
- `PUT /api/owner/profile`
- `POST /api/owner/redeem`
- `POST /api/owner/categories` `PUT /api/owner/categories/:id` `DELETE /api/owner/categories/:id`
- `POST /api/owner/categories/:id/transfer` `POST /api/owner/categories/reorder`
- `POST /api/owner/dishes` `PUT /api/owner/dishes/:id` `DELETE /api/owner/dishes/:id` `POST /api/owner/dishes/:id/move`
- `GET /api/owner/qr.png` `GET /api/owner/qr.pdf`
- `GET /api/public/menu/:slug`

## Interface

One React app, white and black, mobile first.

- `/` marketing
- `/register`, `/login`, `/admin/login`
- `/admin` dashboard, restaurants, tokens, audit, settings
- `/owner` overview, profile, categories, dishes, QR, subscription
- `/menu/:slug` public menu with sticky category tabs

Desktop navigation is a sidebar. Narrow screens use a drawer. Below 800px, tables become stacked cards.
