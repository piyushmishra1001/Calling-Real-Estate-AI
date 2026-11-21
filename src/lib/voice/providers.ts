/**
 * Provider interfaces. Business logic depends only on these, never on a vendor SDK, so any
 * provider can be swapped without touching the CRM or campaign code.
 *
 * STATUS: only in-memory test doubles exist (see mocks.ts). No real vendor adapter is
 * implemented or verified yet; none may be called "integrated" until an end-to-end call succeeds.
 */

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audio: Uint8Array, opts: { language: string }): Promise<{ text: string; billedSeconds: number }>;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(text: string, opts: { voice: string; language: string }): Promise<{ audio: Uint8Array; characters: number }>;
}

export type LlmMessage = { role: "user" | "assistant"; content: string };

export interface LanguageModelProvider {
  readonly name: string;
  complete(req: {
    system: string;
    messages: LlmMessage[];
    maxTokens?: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export interface TelephonyProvider {
  readonly name: string;
  /** Returns only what the carrier reported. Never assume a call connected. */
  placeCall(req: { to: string; from: string; callbackUrl: string }): Promise<
    { ok: true; providerCallId: string } | { ok: false; reason: string }
  >;
  hangup(providerCallId: string): Promise<void>;
}

export type VisitSlot = { startsAt: string; label: string };

export interface CalendarProvider {
  readonly name: string;
  availableSlots(projectId: string, fromIso: string, toIso: string): Promise<VisitSlot[]>;
  /** A slot is booked only when this returns ok: true. */
  reserve(req: { projectId: string; leadId: string; startsAt: string }): Promise<
    { ok: true; confirmationId: string } | { ok: false; reason: string }
  >;
}

export interface WhatsAppProvider {
  readonly name: string;
  /** 'accepted' means the provider accepted it, not that it was delivered. Delivery arrives by webhook. */
  send(req: { to: string; templateId: string; variables: Record<string, string> }): Promise<
    { status: "accepted"; providerMessageId: string } | { status: "failed"; reason: string }
  >;
}
