# Open-Source Poker Bot Plan (Phase C Candidate)

Date: February 28, 2026

## 1) Model choice

### Chosen for implementation target
- DecisionHoldem (open-source repo, heads-up no-limit Hold'em, published benchmark claims vs Slumbot/OpenStackTwo).

### Why this one
- It is the strongest open-source candidate that is close to your game type (no-limit Hold'em).
- It is materially closer to your production game than Cepheus (which is heads-up limit Hold'em).

### Important constraints
- It is heads-up only in published form.
- Repo notes that some source was still provided as compiled files.
- Requires external cluster data files (documented via Baidu Netdisk in upstream README).
- License is AGPL-3.0; treat as a legal/compliance decision before production.

## 2) Scope for first production-safe rollout

- Bot engine active only on explicitly bot-enabled tables.
- Restrict to heads-up tables for v1 bot mode.
- Use existing bot labeling in table UI so all players can see API/bot players.
- Fallback to current heuristic bot if engine inference fails or times out.

## 3) Integration architecture in this codebase

Current stack:
- Game engine/server: `GameImplementation` (Node + Socket.IO)
- Agent service: `poker-agent-api` (FastAPI)
- Main API: `poker-api`
- UI: `poker-ui`

Planned integration:
1. Add bot engine adapter layer in `poker-agent-api`.
2. Add a DecisionHoldem runner service (sidecar process) behind a local API or subprocess wrapper.
3. Convert game state from your internal shape to engine input schema.
4. Convert engine output to legal game action (`fold/check/call/bet/all-in`) with strict validation.
5. Keep game server as source of truth for action legality.

## 4) Implementation phases

### Phase C0: Spike (1-2 days)
- Pull and build DecisionHoldem locally.
- Confirm inference can return an action for one heads-up decision state.
- Record latency and failure modes.

Exit criteria:
- Deterministic local inference demo works.
- Build/run process is scripted.

### Phase C1: Service wrapper (2-3 days)
- Create `poker-agent-api/app/engines/`:
  - `base.py` interface
  - `heuristic_engine.py` (existing behavior wrapped)
  - `decisionholdem_engine.py` (new adapter)
- Add config:
  - `BOT_ENGINE=heuristic|decisionholdem`
  - `BOT_DECISION_TIMEOUT_MS`
  - `BOT_FALLBACK_ON_ERROR=true`

Exit criteria:
- `/api/v1/game/{id}/action` path can request an action from selected engine.
- Timeout/error cleanly falls back.

### Phase C2: State/action adapter hardening (2-4 days)
- Implement robust translation:
  - seat order / blinds / pot / to-call / stacks / street
  - legal actions and min-bet constraints
- Add legal-action sanitizer in agent service before submitting to game server.

Exit criteria:
- No invalid bot actions in integration tests.

### Phase C3: Controlled rollout (2-3 days)
- Enable only for heads-up bot tables.
- Add metrics:
  - inference latency
  - action error rate
  - fallback rate
- Add feature flag for instant rollback.

Exit criteria:
- Stable in staging under continuous play.

## 5) Test plan

1. Unit tests:
- adapter conversion
- legal-action sanitizer
- fallback behavior

2. Integration tests:
- bot joins table, takes turns, completes full hands
- reconnect/disconnect behavior
- timeout behavior under slow engine

3. Regression tests:
- existing human-only tables unaffected
- existing API-driven bot path still works with heuristic engine

## 6) Risks and mitigations

1. Variant mismatch (heads-up model vs multi-player tables)
- Mitigation: launch only on heads-up tables.

2. External asset dependency
- Mitigation: pin assets/checksums and keep internal artifact mirror.

3. AGPL obligations
- Mitigation: legal review before public/prod deployment.

4. Runtime instability
- Mitigation: strict timeout + fallback to heuristic engine.

## 7) Immediate next implementation steps

1. Build adapter interface in `poker-agent-api`.
2. Wire `BOT_ENGINE` toggle and fallback.
3. Add one end-to-end test for bot action flow using the selected engine path.

