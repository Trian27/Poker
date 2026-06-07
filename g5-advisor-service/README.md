# G5 Advisor Service

This service exposes the installed G5 runtime bundle as an internal HTTP advisor.

## Current Scope

The service currently supports:
- hero decision analysis on `preflop`, `flop`, `turn`, and `river`
- dynamic loading from the installed runtime bundle
- manifest-driven table-profile routing
- pure replay planning plus G5 execution against the installed runtime

The service is already wired behind the Learning Hub flow through `poker-api`.

## Runtime Requirement

The service expects the installed bundle to be mounted read-only at `/opt/g5-bundle` and copies it into writable container storage before loading G5.

The installed runtime must contain both table profiles:
- `heads_up` using `full_stats_list_hu.bin`
- `six_max` using `full_stats_list_6max.bin`

Default local startup:

```bash
docker compose up g5-advisor-service
```

The compose service runs as `linux/amd64` because the installed G5 bundle is `linux-x64`.

If the runtime is missing or initialization fails:
- the process stays alive
- `GET /health` returns `503`
- `POST /api/v1/advisor/g5/analyze-decision` returns `503`

## Endpoints

### `GET /health`

Readiness endpoint. Returns `200` only after:
- runtime copy
- manifest validation
- reflection binding
- native resolution
- warm `OpponentModeling` init for both profiles
- startup `preflop -> flop -> calculateHeroAction()` self-check for both profiles

Health also exposes per-profile readiness metadata:
- `profiles.heads_up`
- `profiles.six_max`

### `POST /api/v1/advisor/g5/analyze-decision`

Internal request shape:

```json
{
  "hero_player_id": "player_4",
  "decision_sequence": 3,
  "hand_data": {
    "community_cards": [],
    "players": [
      { "player_id": "player_1", "username": "P1", "seat_number": 1, "hole_cards": [] },
      { "player_id": "player_2", "username": "P2", "seat_number": 2, "hole_cards": [] },
      { "player_id": "player_3", "username": "P3", "seat_number": 3, "hole_cards": [] },
      {
        "player_id": "player_4",
        "username": "P4",
        "seat_number": 4,
        "hole_cards": [
          { "rank": "A", "suit": "spades" },
          { "rank": "K", "suit": "diamonds" }
        ]
      },
      { "player_id": "player_5", "username": "P5", "seat_number": 5, "hole_cards": [] },
      { "player_id": "player_6", "username": "P6", "seat_number": 6, "hole_cards": [] }
    ],
    "blinds": { "small_blind": 50, "big_blind": 100 },
    "dealer_player_id": "player_1",
    "small_blind_player_id": "player_2",
    "big_blind_player_id": "player_3",
    "starting_stacks": {
      "player_1": 10000,
      "player_2": 10000,
      "player_3": 10000,
      "player_4": 10000,
      "player_5": 10000,
      "player_6": 10000
    },
    "action_log": [
      {
        "sequence": 1,
        "stage": "preflop",
        "player_id": "player_2",
        "action": "small-blind",
        "source": "forced",
        "requested_amount": 50,
        "committed_chips": 50,
        "pot_before": 0,
        "to_call_before": 0
      },
      {
        "sequence": 2,
        "stage": "preflop",
        "player_id": "player_3",
        "action": "big-blind",
        "source": "forced",
        "requested_amount": 100,
        "committed_chips": 100,
        "pot_before": 50,
        "to_call_before": 0
      },
      {
        "sequence": 3,
        "stage": "preflop",
        "player_id": "player_4",
        "action": "raise",
        "source": "player",
        "requested_amount": 300,
        "committed_chips": 400,
        "to_call_before": 100
      }
    ]
  }
}
```

## Warnings

Possible `warnings` values:
- `ignored_opponent_hole_cards`
- `trimmed_future_board_cards`
- `multiway_postflop_fallback`
- `no_action_returned`
- `unsupported_hidden_forced_contribution`

## Action amount semantics

- `committed_chips` is the authoritative "chips added by this action" value
- for `bet`, `requested_amount` is the bet size
- for `raise`, `requested_amount` is the raise increment above the call amount, not the total chips added
- for `all-in`, `requested_amount` is usually omitted and replay derives chips from `committed_chips` / stack deltas

## Important limitations

- profile selection is based on validated seated/dealt player count, not active players:
  - `2` players => `heads_up`
  - `3..6` players => `six_max`
- `multiway_postflop_fallback` means G5 used its simplified large-multiway postflop path because `numActivePlayers() >= 5` at decision time
- heads-up postflop hands that use dealer-first action ordering are returned as `unsupported_heads_up_postflop_ordering` because the current G5 replay expects the big blind to act first and the adapter does not silently remap that spot
- the service is an infrastructure/runtime integration step, not a strategy-quality guarantee

## Learning Kill Switch

If you need to disable postflop Learning analysis without changing the advisor service, set this on the `auth-api` / `poker-api` container:

```bash
G5_ENABLE_POSTFLOP_ANALYSIS=false
```

That restores the previous `unsupported_street` behavior for non-preflop hero actions while leaving the service itself intact.
