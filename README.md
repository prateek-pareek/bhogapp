# Bhog Coupons + Payment Collection PWA

PWA-first implementation for:
- Bhog QR coupon issuance and scan-once validation
- Pre-registration with payment-gated QR generation
- Payment collection and receipt numbering
- CSV exports for reporting
- Role-based access (`admin`, `reception`, `collector`, `scanner`)

## Run locally (PWA + MongoDB backend)

```bash
npm install
npm run dev
```

In another terminal, run backend:

```bash
cp .env.example .env
npm run dev:server
```

Backend default URL: `http://localhost:4000`

Optional frontend env override:

```bash
echo "VITE_API_BASE_URL=http://localhost:4000" > .env.local
```

WhatsApp Cloud API envs (backend `.env`):

```bash
WHATSAPP_ACCESS_TOKEN=your_meta_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_API_VERSION=v20.0
WHATSAPP_DEFAULT_COUNTRY_CODE=91
```

## Default login users

- `admin` / `admin123`
- `reception` / `reception123`
- `collector` / `collector123`
- `scanner` / `scanner123`

## Build

```bash
npm run build
```

## What is included

- **PWA shell**: `manifest.webmanifest` + `sw.js` + service worker registration
- **Bhog module**:
  - manual on-spot issuance with quantity-based unique tokens
  - scan/consume flow with duplicate scan protection
  - event-level counters (issued/scanned/remaining)
- **Pre-registration module**:
  - paid vs not-paid handling
  - pending approvals that can later issue QRs
- **Payment module**:
  - transaction capture with mode/purpose/trust/collector
  - receipt number generation
- **Reports module**:
  - CSV export for bhog and payments
- **Backend**:
  - Express + MongoDB (Mongoose)
  - JWT authentication
  - Seeded role users
  - Persistent shared state API (`GET/PUT /api/state`) for compatibility
  - Modular APIs (`/api/events`, `/api/audit-logs`)
  - Immutable server-side audit log append endpoint (`POST /api/audit-logs`)
  - Dedicated registration APIs for create/approve/reject/bulk upload
  - Dedicated coupon scan API and payment create API
  - WhatsApp Cloud API integration via backend (server-side sends)

## Notes

- Frontend keeps a local snapshot for resilience, and also syncs state to MongoDB after authenticated changes.
- Ensure MongoDB is running before starting `npm run dev:server`.
