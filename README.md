# Polis

Polis is a pixel-art AI society sandbox prototype. It is inspired by HKUST Aivilization, AI Town, Stanford Smallville / Generative Agents, and Project Sid, but it is designed as its own AI contract civilization experiment.

The current direction is closer to an educational AI society simulation than a Web3 dashboard: players observe and steer AI residents as they produce, trade, socialize, make decisions, complete contracts, and form social relationships inside a small pixel town.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Local LLM

Polis can call LM Studio through an OpenAI-compatible local endpoint. If LM Studio is offline, the app falls back to deterministic mock behavior so the demo remains playable.

Default endpoint and model:

```bash
LMSTUDIO_URL=http://127.0.0.1:1234/v1/chat/completions
LMSTUDIO_MODEL=gemma-4-4b
```

Implemented LLM-backed routes:

- `POST /api/simulate`: generates mission work logs.
- `POST /api/agent-dialogue`: generates autonomous dialogue between two AI residents.
- `POST /api/agent-chat`: lets the player, as Governor, give a directive to their own Agent.

Each route has a local mock fallback.

## Current Features

- Pixel-art town map with moving resident sprites.
- AI residents with roles, MBTI profiles, traits, thoughts, status, resources, reputation, and relationship affinity.
- Player Agent creation with MBTI selection.
- Game/Data style experience: play in the town or inspect the society as a data observer.
- Society Sandbox loop: production, market trade, social decisions, cultural norms, and resource metrics.
- Data Observatory: trade volume, friendship, satisfaction, current rule, rankings, economy, and policy state.
- Mission Board with risk, compute cost, reward preview, success chance, reputation impact, and recommended role.
- Work Log Terminal, World Feed, conversations, and autonomous agent dialogue.
- Bilingual interface: English / Chinese.
- localStorage persistence and reset.

## Mocked

- No real database.
- No wallet, NFT, token price, buy/sell/profit, airdrop, or chain interaction.
- Economy, policies, resources, rankings, and settlement math are mock simulation logic.
- Agent memory is currently local state, not a durable memory store.
- LM Studio is optional; fallback responses are used when the local model is unavailable.

## Reference Direction

- HKUST Aivilization: AI inhabitants, production, trade, socializing, decision-making, rankings, and data observation in an educational society sandbox.
- Stanford Generative Agents / Smallville: believable AI residents driven by memory, reflection, planning, and social event propagation.
- AI Town: a virtual town metaphor with AI characters, conversation, and real-time spatial presence.
- Project Sid: many-agent civilization benchmarks including role specialization, social graphs, collective rules, cultural propagation, and progress indicators.

## Product Direction

Polis should continue moving toward an observable AI society game:

- Make resident behavior more autonomous and less button-driven.
- Add persistent memory, plans, and daily schedules.
- Make production/trade/social decisions affect the town over multiple epochs.
- Expose agent thoughts and relationship changes as learnable signals for the player.
- Connect LM Studio or another local LLM for richer autonomous dialogue and work logs.
