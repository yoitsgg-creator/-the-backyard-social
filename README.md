# The Backyard Social · QR Ordering MVP

A first implementation of a café ordering system inspired by ECC's engineering workflow: plan first, validate inputs, test critical rules, review security, and verify before launch. ECC is used as a development reference; its source code is not copied into this application.

## Included in this MVP

- Mobile-first customer menu and cart.
- Table number read from QR URL, for example `/` or `/?table=4`.
- Orders saved to PostgreSQL with server-calculated totals.
- Real-time Socket.IO events for kitchen order notifications.
- Staff login with hashed passwords and short-lived JWTs.
- Admin and kitchen roles.
- Kitchen order status workflow.
- Admin menu item creation and availability toggle.
- Audit records for staff login and order status changes.
- Request validation, rate limits, Helmet headers, and environment-based secrets.
- Starter tests for order input validation.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- A terminal, such as GitHub Codespaces or a computer with Node.js installed.

## Setup

1. Create a PostgreSQL database named `backyard_social`.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to your local PostgreSQL connection string.
4. Set `JWT_SECRET` to a unique random string of at least 32 characters.
5. Change `ADMIN_PASSWORD` to a unique password of at least 12 characters.
6. Install packages:

   ```bash
   npm install
   ```

7. Create tables and starter menu:

   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   psql "$DATABASE_URL" -f db/seed.sql
   ```

8. Create the admin login:

   ```bash
   npm run create-admin
   ```

9. Start the app:

   ```bash
   npm start
   ```

10. Open `http://localhost:3000`. For table 4, open `http://localhost:3000/?table=4`.

## Quick verification

```bash
npm test
curl http://localhost:3000/api/health
```

The health endpoint should report `{"status":"ok","database":"connected"}` when PostgreSQL is reachable.

## QR codes

Each table needs its own QR code containing the public app URL plus a table query parameter, such as:

- `https://YOUR-DOMAIN/?table=1`
- `https://YOUR-DOMAIN/?table=2`
- `https://YOUR-DOMAIN/?table=3`

Do not print local `localhost` URLs on customer-facing QR cards. They only work on the machine running the app.

## Security and production checklist

This is an MVP starter, not a certified production deployment.

- Set a strong, unique `JWT_SECRET` and staff passwords in the deployment environment.
- Never commit `.env`, database credentials, payment secrets, or production tokens.
- Deploy behind HTTPS and configure a restrictive Content Security Policy before enabling it in Helmet.
- Restrict database network access and use a least-privilege database user.
- Configure encrypted automated database backups and test restoring them.
- Add CSRF protections if changing to cookie-based sessions; keep bearer tokens out of URLs and logs.
- Add monitoring, structured logs, retention rules, and an incident-response procedure.
- Validate the QR table number against a server-managed table list before launch.
- Add automated integration/E2E tests and target at least 80% meaningful coverage before production.
- Add stock deduction, tax/GST rules, discounts, receipts, and payment integration only after requirements are confirmed.
- Razorpay is intentionally not integrated in this version.

## Known MVP limitations

- The public customer status-tracking screen is not implemented yet.
- Menu editing currently supports adding items and toggling availability; edit/delete and image upload remain future work.
- QR table IDs are accepted from the URL and are not yet checked against a registered tables table.
- Test coverage currently focuses on request validation; database integration and end-to-end tests remain to be added.
- Admin users can be provisioned through the CLI; a full staff account management screen is not included.

## Project workflow

Follow the ECC pattern: plan -> test -> implement -> review -> verify -> improve. See the upstream reference at https://github.com/affaan-m/ECC.
