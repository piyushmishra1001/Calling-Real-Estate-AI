# LeadPilot AI

Multi-tenant real estate lead-conversion platform: CRM, project knowledge base, campaigns, site-visit tracking, and an AI calling assistant (Riya). Next.js 16, TypeScript, Supabase (Postgres, Auth, RLS), Vercel.

North-star metric: **cost per attended site visit.**

## Status: what is real and what is not

| Area | Status |
|---|---|
| Multi-tenant schema, RLS, roles, suspension, kill switch, usage gate | Built. 64 database tests pass against a real Postgres engine (PGlite). |
| Auth: invitation-only onboarding, password recovery, role guards | Built and type-checked. **Not yet run against a live Supabase project.** |
| CRM: leads, CSV import, history, opt-outs, callbacks | Built. UI not yet exercised end to end with real data. |
| Projects, assignment, versioned knowledge base with approval | Built. KB facts are **typed in by a person**; automatic extraction from brochures is **not built**. |
| Campaigns | Built up to queueing. **No calls are placed**: there is no telephony adapter. |
| Site visits | Built. Confirmation is **human only** (no calendar integration). |
| Riya conversation engine | Built and unit-tested with in-memory doubles (rules-based, no LLM). |
| Voice worker (Pipecat + Sarvam STT/TTS + LLM, `voice-worker/`) and the signed `/api/voice/events` endpoint | **Built and unit-tested; no real call has been made.** See `voice-worker/README.md`. |
| Exotel/Plivo outbound call placement, calendar, WhatsApp | **Not implemented.** Nothing is "integrated" until an end-to-end call succeeds. |
| Voice cost target ($0.02/min) | **Not measured.** The accounting code exists; the target is not claimed until 100+ real calls. |
| Deployment | Not deployed from this repo. |

## Setup

1. Create a Supabase project. In Authentication settings: **disable public signups**, and set the invite and recovery email templates to link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` and `...&type=recovery`.
2. Run the SQL in `supabase/migrations/` in order (`0001` to `0005`).
3. Copy `.env.example` to `.env.local` and fill it in. The service-role key is a secret: server-only.
4. Create the first Super Admin from your own machine:
   `npx tsx scripts/create-super-admin.ts you@example.com 'a-long-password'`
5. `npm install && npm run dev`

## Commands

`npm test` (all tests) · `npm run test:db` · `npm run typecheck` · `npm run lint` · `npm run build`

## Security model

- Every partner-owned row has `org_id` and RLS; the app uses the signed-in user's client so Postgres enforces access.
- The service-role client is used only for what users must not write directly (call records, audit logs, invitations) and is guarded by `server-only`.
- The Super Admin controls partners, projects, limits and the kill switch but has **no direct read access** to leads or calls; they get aggregates via `platform_stats()`.
- Opt-outs are recorded in the database and flip the lead to do-not-contact by trigger.
- A visit cannot be `confirmed` without a scheduled slot and a confirmation source (database constraint).
- Only an `approved` knowledge-base version is readable by partners or usable by Riya.

## Before any real calling

Legal and telecom review (TRAI/DND), a telephony adapter verified end to end, explicit authorisation for paid calls, and the 100-call cost benchmark described in the product brief.
