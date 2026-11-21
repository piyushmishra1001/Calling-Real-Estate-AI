import type { RiyaContext } from "./context";
import { RiyaEngine, type Action, type CallOutcome } from "./riya";
import type { CalendarProvider, SpeechToTextProvider, TextToSpeechProvider } from "./providers";
import type { CallUsage } from "./cost";

export type TranscriptLine = { speaker: "riya" | "customer"; text: string };

export type CallRun = {
  transcript: TranscriptLine[];
  outcome: CallOutcome;
  actions: Action[];
  usage: CallUsage;
};

/** Average speaking rate used ONLY to estimate connected time in simulations. Real calls use carrier-reported duration. */
const CHARS_PER_SECOND = 15;

/**
 * Runs one conversation: customer audio -> STT -> engine -> TTS. Stops all provider work the moment the
 * engine ends the call (opt-out, wrong number, goodbye), so no further cost is incurred.
 * `customerTurns`: an audio buffer per customer turn, or null for silence.
 */
export async function runCall(args: {
  ctx: RiyaContext;
  ids: { leadId: string; projectId: string };
  today: string;
  stt: SpeechToTextProvider;
  tts: TextToSpeechProvider;
  calendar?: CalendarProvider;
  customerTurns: (Uint8Array | null)[];
  voice?: { voice: string; language: string };
  /** Carrier-reported connected seconds. When absent, an estimate is used and flagged by the caller. */
  carrierConnectedSeconds?: number;
}): Promise<CallRun> {
  const engine = new RiyaEngine(args.ctx, args.ids, args.today);
  const voice = args.voice ?? { voice: "riya", language: "en-IN" };
  const transcript: TranscriptLine[] = [];
  const actions: Action[] = [];
  let ttsChars = 0;
  let sttSeconds = 0;

  const speak = async (text: string) => {
    if (!text) return;
    const r = await args.tts.synthesize(text, voice);
    ttsChars += r.characters;
    transcript.push({ speaker: "riya", text });
  };

  const runActions = async (list: Action[]): Promise<string | null> => {
    let follow: string | null = null;
    for (const a of list) {
      actions.push(a);
      if (a.type === "reserve_visit" && args.calendar) {
        const startsAt = `${a.date}T${a.time}:00+05:30`;
        const res = await args.calendar.reserve({ projectId: args.ids.projectId, leadId: args.ids.leadId, startsAt });
        const next = engine.onReservationResult(res.ok ? { ok: true } : { ok: false, reason: res.reason });
        actions.push(...next.actions);
        follow = next.say;
      }
    }
    return follow;
  };

  const opening = engine.start();
  await speak(opening.say);

  for (const turn of args.customerTurns) {
    if (engine.isEnded) break; // no more processing after the call ends
    let result;
    if (turn === null) {
      result = engine.handleSilence();
    } else {
      const heard = await args.stt.transcribe(turn, { language: voice.language });
      sttSeconds += heard.billedSeconds;
      transcript.push({ speaker: "customer", text: heard.text });
      result = engine.handle(heard.text);
    }
    await speak(result.say);
    const follow = await runActions(result.actions);
    if (follow) await speak(follow);
  }

  const estimated = Math.round(sttSeconds + ttsChars / CHARS_PER_SECOND);
  const spoke = transcript.some((l) => l.speaker === "customer");
  return {
    transcript,
    outcome: engine.outcome(),
    actions,
    usage: {
      connected: spoke,
      sttBilledSeconds: sttSeconds,
      ttsCharacters: ttsChars,
      // The deterministic engine makes no LLM calls; a model-backed engine must report real token counts here.
      llmInputTokens: 0,
      llmOutputTokens: 0,
      connectedSeconds: args.carrierConnectedSeconds ?? estimated,
    },
  };
}
