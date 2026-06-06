import type { LitEndpoint, LitRequest, NormalizedLitRequest } from "./types";

export function normalizeLanguage(language: string | null | undefined): string {
  return (language ?? "und").trim().toLowerCase() || "und";
}

export function baseLanguage(language: string | null | undefined): string {
  return normalizeLanguage(language).split("-")[0] || "und";
}

export function normalizeSystem(system: string | null | undefined): string {
  return (system ?? "orthography").trim().toLowerCase() || "orthography";
}

export function normalizeRequest(request: LitRequest): NormalizedLitRequest {
  const from: LitEndpoint = {
    system: normalizeSystem(request.from?.system),
    language: normalizeLanguage(request.from?.language ?? request.to.language),
    ...(request.from?.script !== undefined ? { script: request.from.script } : {}),
    ...(request.from?.variant !== undefined ? { variant: request.from.variant } : {}),
  };
  const to: LitEndpoint = {
    system: normalizeSystem(request.to.system),
    language: normalizeLanguage(request.to.language ?? from.language),
    ...(request.to.script !== undefined ? { script: request.to.script } : {}),
    ...(request.to.variant !== undefined ? { variant: request.to.variant } : {}),
  };
  return {
    from,
    to,
    dictionaries: request.dictionaries ?? [],
  };
}

export function targetIs(request: NormalizedLitRequest, systems: string[]): boolean {
  return systems.includes(normalizeSystem(request.to.system));
}
