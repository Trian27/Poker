# Poker Learning Section Research and Recommendations

Date: February 28, 2026
Scope: research + implementation status + next steps

## 1. Executive summary

The learning feature is no longer only research. The baseline is now implemented:

1. Session-based learning history (join -> leave) exists.
2. Per-hand action timelines are recorded for replay.
3. Learning Hub UI exists and supports replay + coach recommendations.
4. A baseline coach (heuristic) is live for preflop/postflop decision guidance.

The next major step is upgrading bot/coach quality using the strongest practical open-source option, with safe rollout controls.

## 2. What has been implemented

### 2.1 Data model and migration

Implemented:

1. `table_sessions` model/table to track user table sessions from join to leave.
2. `session_hands` model/table to map sessions to completed hand history rows.
3. Migration:
   - `poker-api/migrations/011_learning_sessions.sql`

### 2.2 Session lifecycle wiring

Implemented in API join/unseat flows:

1. On join:
   - stale active sessions for same user/table are closed
   - a new active session is created
2. On idempotent rejoin:
   - active session is created if missing
3. On unseat/leave:
   - active session is closed (`left_at` set)

### 2.3 Hand history linking

Implemented in `POST /_internal/history/record`:

1. Completed hand is persisted as before.
2. Participants are resolved from `hand_data.players`.
3. Each participant’s active session is linked via `session_hands`.

### 2.4 Learning endpoints

Implemented endpoints:

1. `GET /api/learning/sessions`
2. `GET /api/learning/sessions/{session_id}/hands`
3. `POST /api/learning/coach/recommend`

Coach behavior currently uses baseline heuristics (strength + pressure + sizing guidance) and returns top actions with rationales/tags.

### 2.5 Game engine action timeline

Implemented in game engine hand history output:

1. Ordered per-action timeline (`action_log`) with:
   - stage, actor, action, source (`player|timeout|forced`)
   - pot/current-bet before/after
   - stack/bet before/after
   - to-call, min-raise, players-in-hand snapshots
   - elapsed hand time
2. Forced blind events are included.
3. Timeline persists through Redis serialization.

### 2.6 Learning Hub UI

Implemented in frontend:

1. Learning route/page (`/learning`)
2. Session list + session hand list
3. Hand action timeline display
4. Analyze button that calls coach endpoint and renders ranked recommendations
5. Learning entry points in app navigation/dashboard

## 3. Validation completed

Executed successfully:

1. Python compile checks for updated API modules.
2. `npm run build` for `GameImplementation`.
3. `npm run build` for `poker-ui`.
4. Agent API integration test path passes (with known Jest open-handle warning pattern in this repo).
5. Schema migration helper confirms migration applied.

## 4. Open-source poker AI findings (updated)

### 4.1 Pluribus availability

Pluribus is not available as a turnkey open-source code+weights package suitable for direct self-hosting.

### 4.2 Best open-source candidates

1. **Cepheus / CFR+**:
   - strongest formal validation among open releases
   - but variant is heads-up limit hold'em (mismatch with no-limit product tables)
2. **DecisionHoldem**:
   - open-source no-limit heads-up candidate with published benchmark claims
   - better directional fit for no-limit than Cepheus
   - caveats: heads-up focus, external data assets, AGPL license constraints

## 5. Next steps

### Phase C0: DecisionHoldem feasibility spike

1. Build/run locally end-to-end for one decision state.
2. Verify runtime latency and reliability.
3. Document required model/data artifacts and pin versions/checksums.

### Phase C1: Engine abstraction in `poker-agent-api`

1. Add engine adapter interface.
2. Add engines:
   - `heuristic` (current behavior wrapped)
   - `decisionholdem` (new adapter)
3. Add config flags:
   - `BOT_ENGINE`
   - `BOT_DECISION_TIMEOUT_MS`
   - `BOT_FALLBACK_ON_ERROR`

### Phase C2: Adapter hardening + legality guardrails

1. Normalize game-state translation (street, pot, stacks, to-call, legal sizes).
2. Add strict action sanitizer before calling game server.
3. Keep game server as final legality authority.

### Phase C3: Controlled rollout

1. Enable only on bot-enabled heads-up tables initially.
2. Add metrics: latency, fallback rate, invalid-action rate.
3. Feature-flagged rollback path.

## 6. Risks and controls

1. Variant mismatch (heads-up engine vs multi-player tables)
   - Control: launch bot engine only on heads-up tables first.
2. AGPL obligations
   - Control: legal/compliance review before production distribution.
3. External artifact dependency
   - Control: internal mirror + checksums + reproducible build notes.
4. Runtime instability
   - Control: timeout + fallback to heuristic engine.

## 7. Recommended rollout order (current)

1. Keep current Phase A/B baseline live.
2. Implement Phase C0/C1 engine integration with fallback.
3. Harden via C2 and integration tests.
4. Roll out in staged gates via C3.

## 8. Sources reviewed

Primary sources:

- Pluribus (Science 2019): https://pubmed.ncbi.nlm.nih.gov/31296650/
- CMU Pluribus announcement: https://www.cs.cmu.edu/news/2019/carnegie-mellon-and-facebook-ai-beat-professionals-six-player-poker
- Libratus (Science 2018): https://pubmed.ncbi.nlm.nih.gov/29249696/
- DeepStack (Science 2017): https://pubmed.ncbi.nlm.nih.gov/28254783/
- Heads-up limit hold'em solved page: https://webdocs.cs.ualberta.ca/~games/poker/15science.html
- CFR+ open-source reference: https://poker.cs.ualberta.ca/cfr_plus.html
- ReBeL paper: https://arxiv.org/abs/2007.13544
- Student of Games paper: https://arxiv.org/abs/2112.03178
- OpenSpiel official repo: https://github.com/google-deepmind/open_spiel
- DecisionHoldem repo: https://github.com/AI-Decision/DecisionHoldem
- DecisionHoldem paper: https://arxiv.org/abs/2201.11580

