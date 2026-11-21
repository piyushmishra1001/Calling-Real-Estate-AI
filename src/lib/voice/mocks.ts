import type { CalendarProvider, SpeechToTextProvider, TextToSpeechProvider } from "./providers";

/** In-memory test doubles. They prove our orchestration logic, NOT any vendor integration. */
export class MockStt implements SpeechToTextProvider {
  readonly name = "mock-stt";
  calls = 0;
  constructor(private readonly secondsPerUtterance = 4) {}
  async transcribe(audio: Uint8Array) {
    this.calls++;
    return { text: new TextDecoder().decode(audio), billedSeconds: this.secondsPerUtterance };
  }
}

export class MockTts implements TextToSpeechProvider {
  readonly name = "mock-tts";
  spoken: string[] = [];
  async synthesize(text: string) {
    this.spoken.push(text);
    return { audio: new TextEncoder().encode(text), characters: text.length };
  }
}

export class MockCalendar implements CalendarProvider {
  readonly name = "mock-calendar";
  reservations: { projectId: string; leadId: string; startsAt: string }[] = [];
  constructor(private readonly accept = true) {}
  async availableSlots() {
    return [];
  }
  async reserve(req: { projectId: string; leadId: string; startsAt: string }) {
    if (!this.accept) return { ok: false as const, reason: "slot_taken" };
    this.reservations.push(req);
    return { ok: true as const, confirmationId: `conf_${this.reservations.length}` };
  }
}

export const say = (text: string) => new TextEncoder().encode(text);
