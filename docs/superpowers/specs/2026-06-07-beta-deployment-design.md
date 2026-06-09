# Beta Deployment Design

## Goal

Deploy a low-cost online beta of the poker platform that:

- supports up to `~50` invited beta users total
- supports up to `~15` concurrent users and roughly `2` active tables
- keeps the Learning Hub and `g5-advisor-service` online
- allows only invited users to create accounts and play
- stays simple enough to operate without a full production platform rollout

This design is intentionally optimized for a hand-picked beta, not a public launch.

## Current Repo Context

The repo already has the core service split needed for an online beta:

- `poker-ui`: React/Vite frontend
- `poker-api`: FastAPI API for auth, wallets, communities, tables, Learning Hub, and admin flows
- `GameImplementation`: Node.js game server with Socket.IO
- `postgres-db`: primary relational datastore
- `redis-cache`: cache/runtime coordination
- `g5-advisor-service`: internal Learning Hub advisor service

Relevant current behaviors:

- the root `docker-compose.yml` already runs all major services together
- `poker-api` already applies SQL schema migrations on startup via `ensure_schema()`
- email verification and account recovery already exist via SMTP-backed code paths
- public registration is still open in production mode
- the current compose file exposes internal services publicly
- the current frontend defaults still assume localhost-style API and game-server URLs
- the current Socket.IO server allows `origin: '*'`

This means the beta does not need a new platform architecture. It needs a production-shaped deployment overlay, tighter boundaries, and an invite-only account flow.

## Requirements

### Functional Requirements

- invited testers receive an email link
- invited testers can set username and password from that link
- only invited testers can create accounts
- invited testers can log in and use gameplay normally
- Learning Hub remains available during beta
- admins can create, resend, revoke, and inspect invites

### Operational Requirements

- monthly hosting cost should stay low
- deployment should be manageable by one operator
- backups and recovery must be good enough for beta safety
- rollout should be incremental and reversible

### Security Requirements

Security can be lighter than public release, but not absent.

Required:

- HTTPS
- SSH key-only server access
- strong JWT secret
- no public exposure of Postgres, Redis, or G5
- invite-only onboarding
- basic origin restrictions for API and Socket.IO

Explicitly deferred to later release:

- public anti-abuse controls
- advanced rate limiting
- WAF/CDN hardening
- multi-region resilience
- multi-node game-server clustering

## Options Considered

### Option 1: Single `x86_64` VPS with Docker Compose

Run the entire beta stack on one self-managed VPS.

Pros:

- lowest monthly cost
- matches the current repo shape
- easiest to reason about operationally
- avoids multi-provider integration work
- sufficient for current concurrency targets

Cons:

- one box is a single point of failure
- manual ops responsibility stays with the operator
- backups and restores must be managed explicitly

### Option 2: VPS plus Managed Postgres

Move only Postgres out to a managed database while keeping app containers on a VPS.

Pros:

- cleaner database durability story
- easier database backups and restores

Cons:

- noticeably higher monthly cost
- adds provider complexity early
- limited practical benefit at this beta scale

### Option 3: Fully Managed Multi-Service Hosting

Host the app on a mix of PaaS and managed components.

Pros:

- reduced server administration

Cons:

- highest cost
- more friction for Socket.IO and internal service routing
- little value at current scale

## Chosen Approach

Use **one self-managed `x86_64` VPS with Docker Compose**.

This is the best fit because:

- current scale is small
- the repo already has Dockerfiles and a compose topology
- Learning Hub is an internal CPU/RAM workload, not a GPU hosting problem
- the operational footprint stays understandable

## Infrastructure Design

### Server Size

Recommended initial server:

- `4 vCPU`
- `16 GB RAM`
- `160+ GB SSD`

Cheaper minimum starting point:

- `2 vCPU`
- `8 GB RAM`

Recommendation:

- start with `4 vCPU / 16 GB`
- downsize later only if metrics show consistent underuse

This is intentionally conservative because the box will run:

- React static serving
- FastAPI
- Node.js Socket.IO gameplay
- Postgres
- Redis
- G5 advisor runtime

### Provider Choice

Recommended provider priority:

1. Hetzner if lowest cost is the main goal
2. DigitalOcean if you want a more familiar managed UX and accept higher monthly cost

Reasoning:

- Hetzner currently offers materially cheaper VM pricing for this class of instance
- this beta does not need hyperscaler-level networking or service integrations

### Operating System

- `Ubuntu 24.04 LTS`

### Container Strategy

Use a beta-specific compose overlay:

- keep current root `docker-compose.yml` as dev-oriented base
- add `docker-compose.beta.yml` for production-like networking, ports, env, and proxy wiring

This is preferable to rewriting the existing compose file because it preserves local development behavior while allowing the beta deploy to be locked down.

## Service Topology

### Public Entry

Only the reverse proxy is public.

Open ports:

- `22` for SSH
- `80` for HTTP redirect to HTTPS
- `443` for HTTPS

### Reverse Proxy

Use **Caddy** as the default reverse proxy.

Reasons:

- simplest automatic HTTPS
- straightforward WebSocket proxying
- less operational overhead than hand-managing Nginx + certbot

Routing:

- `/` -> `react-ui`
- `/api/*` -> `auth-api`
- `/socket.io/*` -> `game-server`

### Internal Services

Private-only on Docker network:

- `postgres-db`
- `redis-cache`
- `g5-advisor-service`

Optional and disabled for beta unless needed:

- `agent-api`

### Same-Origin Application Model

The beta should use one domain such as `beta.example.com`.

Benefits:

- simpler auth behavior
- fewer CORS problems
- simpler mental model for testers
- easier proxy configuration

## Application Configuration Changes

### Frontend Base URLs

Current frontend defaults assume localhost values and build-time direct URLs.

Beta design change:

- frontend should call the API through same-origin `/api`
- frontend should connect Socket.IO through same-origin `/socket.io`
- do not depend on public raw container ports

This can be implemented either by:

- using relative paths in production builds
- or injecting same-origin production env values at build time

Preferred choice:

- production-relative URLs where possible

### API CORS and UI Origin Policy

Current API defaults allow localhost origins.

Beta design change:

- set `CORS_ORIGINS` to only the beta domain
- keep local regex allowances only for non-production development

### Socket.IO Origin Policy

Current game server allows `origin: '*'`.

Beta design change:

- restrict Socket.IO origins to the beta domain
- continue allowing WebSocket and polling transports

### Internal Port Exposure

Beta compose must not publish:

- Postgres
- Redis
- G5 advisor

Only the reverse proxy should publish host ports.

## Learning Hub Design

### Keep G5 Online

Learning Hub is in scope for beta.

The `g5-advisor-service` stays deployed as an internal service behind `poker-api`.

### Hosting Assumption

No GPU hosting is required by this repo design.

The service is:

- a .NET container
- loading a Linux `x64` runtime bundle
- operating as an internal HTTP service

Current service behavior also serializes analysis requests at the host layer. That is acceptable for the expected beta volume.

### Failure Behavior

If G5 fails or becomes unready:

- gameplay stays available
- Learning Hub returns a temporary unavailable message
- health checks flag the degraded state

This avoids coupling core gameplay uptime to Learning Hub availability.

## Invite-Only Beta Onboarding

### Registration Policy

Public self-registration is disabled in beta production.

Only users with valid invite links may create accounts.

### Invite Data Model

Add a new `beta_invites` table.

Fields:

- `id`
- `email`
- `token_hash`
- `created_at`
- `expires_at`
- `sent_at`
- `used_at`
- `revoked_at`
- `created_by_user_id`
- `redeemed_by_user_id`
- `notes` nullable

Why a dedicated table instead of reusing `email_verifications`:

- invite lifecycle is different from verification-code lifecycle
- invite tokens should be long random secrets, not 6-digit codes
- invites need admin-level tracking and revocation semantics

### Invite Token Design

- generate a high-entropy random token
- store only a hash in the database
- make invites single-use
- default expiry: `7 days`

Policy:

- only one active pending invite per email
- creating a replacement invite revokes the prior pending invite

### Invite Redemption Flow

1. Admin creates invite for email address.
2. System generates token and stores invite record.
3. System sends email with one-time link.
4. User opens link and lands on invite acceptance page.
5. User chooses username and password.
6. System validates invite and creates the account.
7. Account is created with `email_verified=true`.
8. Invite is marked used and cannot be redeemed again.

### Public Auth Changes

Backend changes:

- disable or reject public `/auth/register` in beta production mode
- add invite-validation and invite-accept endpoints

Frontend changes:

- replace public registration page with “invite required” messaging
- add invite acceptance page

Suggested new backend endpoints:

- `GET /auth/invite/{token}`
- `POST /auth/invite/{token}/accept`

Suggested admin endpoints:

- `POST /api/admin/beta-invites`
- `GET /api/admin/beta-invites`
- `POST /api/admin/beta-invites/{invite_id}/resend`
- `POST /api/admin/beta-invites/{invite_id}/revoke`

### Account Recovery

Keep the existing account recovery flow after account creation.

Reasoning:

- already implemented
- already integrated with SMTP
- enough for beta password resets

### SMTP Strategy

Use the existing SMTP-based email sending path for beta.

This is acceptable because:

- tester volume is small
- invites are hand-curated
- deliverability requirements are modest compared with public launch

### Admin UI Strategy

Expose invite management inside the existing authenticated admin web UI.

Admin actions:

- create invite
- resend invite
- revoke invite
- view invite status

Status values:

- `pending`
- `redeemed`
- `expired`
- `revoked`

### Beta-Friendly Fallback

If SMTP send fails:

- keep the invite record
- return the one-time link in the admin response
- allow manual send by the operator

This keeps beta operations moving without building a more sophisticated delivery system.

## Security Posture

### Required Beta Controls

- HTTPS everywhere
- SSH key-only access
- firewall allowlist only for required ports
- strong `JWT_SECRET_KEY`
- internal-only DB, Redis, and G5 services
- beta-domain-only CORS and Socket.IO origins
- invite-only account creation

### Controls Deferred Until Public Launch

- advanced abuse throttling
- WAF/CDN bot protection
- account reputation and fraud controls
- multi-factor auth for normal users
- multi-region disaster strategy

### Admin Access

Use the existing global admin model already present in `poker-api`.

Admin bootstrap remains environment-driven for beta:

- `ADMIN_USERNAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Data and Backup Strategy

### Database

Use Docker-managed Postgres with persistent volume storage.

### Backups

Minimum required backup plan:

- nightly `pg_dump`
- weekly full VM snapshot
- retained off-box copy of database dumps

### Restore Readiness

Before broadening beta beyond the first few testers:

- perform one real restore test into a disposable environment

That matters more than elaborate backup tooling at this stage.

## Deployment Workflow

### Recommended Delivery Path

Preferred:

- build Docker images in GitHub Actions
- push images to GHCR
- deploy on the VPS with `docker compose pull` and `docker compose up -d`

Why:

- repeatable
- avoids large server-local builds
- simplifies rollback to prior image tags

Acceptable initial fallback:

- build directly on the VPS for the first deployment

### Environment Management

Use a beta-specific environment file containing:

- domain
- JWT secret
- SMTP settings
- admin bootstrap settings
- G5 service flags
- production `CORS_ORIGINS`

### Database Migration Strategy

Keep the existing startup schema mechanism.

`poker-api` already runs `ensure_schema()` at startup, so beta rollout can introduce new SQL migration files without adding Alembic first.

### Rollback Strategy

Rollback should mean:

- redeploy previous image set
- restore previous env if needed
- restore Postgres from last good dump only if schema/data corruption requires it

Normal application rollback should not immediately imply database rollback unless a migration specifically breaks compatibility.

## Observability

### Minimum Monitoring

- public uptime check for `beta.example.com`
- API health check
- G5 health check
- container restart alerts if available

### Logging

Capture and retain:

- reverse proxy logs
- `auth-api` logs
- `game-server` logs
- `g5-advisor-service` logs

Priority signals to watch during early beta:

- failed invite sends
- invite redemption failures
- auth failures
- game-server disconnect bursts
- G5 readiness transitions

## Rollout Plan

### Phase 1: Beta Infrastructure Overlay

- create `docker-compose.beta.yml`
- add reverse proxy config
- remove public exposure of internal services
- switch to production same-origin routing

### Phase 2: Invite-Only Auth

- add `beta_invites` schema
- add invite API endpoints
- add invite acceptance UI
- disable public self-registration in beta production mode

### Phase 3: Production Boundary Tightening

- restrict `CORS_ORIGINS`
- restrict Socket.IO origin policy
- finalize beta env variables
- add backup jobs

### Phase 4: Rehearsal

- deploy to beta server
- create admin account
- send and redeem a real invite
- play a two-user game
- verify Learning Hub
- test password recovery
- test invite resend and revoke

### Phase 5: Controlled Launch

- invite `3-5` testers first
- observe logs and resource usage
- expand to the rest after a short stable period

## Cost Envelope

Expected monthly beta infrastructure cost target:

- roughly `~$20-50/month` for the VM itself depending on provider and size
- plus optional snapshot/backup costs
- SMTP costs should be negligible at beta volume

This is intentionally far below a fully managed multi-service stack.

## Risks

### Single Box Failure

The entire beta depends on one server.

Mitigation:

- snapshots
- nightly DB dumps
- simple rebuild documentation

### Invite/Auth Rework Touches Public Entry Flow

Invite-only onboarding changes core authentication behavior.

Mitigation:

- keep change isolated to beta-mode registration path
- test invite acceptance, login, and recovery end-to-end before launch

### G5 Runtime Readiness

The G5 bundle must be installed and healthy for Learning Hub to work.

Mitigation:

- include G5 health in deployment checks
- allow gameplay to continue if G5 is degraded

### Production Config Drift

The repo currently carries localhost-oriented defaults.

Mitigation:

- beta-specific env file
- beta-specific compose overlay
- same-origin proxy routing

## Success Criteria

This design is successful when:

- the stack runs on one VPS with only `80/443` public
- invites can be created, emailed, redeemed, resent, and revoked
- public registration is blocked
- invited users can log in and play normally
- Learning Hub is available in beta
- backups run automatically
- the operator can redeploy and recover without bespoke manual steps
