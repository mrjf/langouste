import type { DictionaryLookupResponse } from "./api-contracts";
import { api, apiRequest } from "./api";
import type {
  NewsSourceId,
  ReadingInteractionRequest,
  ReadingInteractionResponse,
  ReadingJobResponse,
  ReadingRequest,
  ReadingResponse,
  ReadyReadingsResponse,
  SourceListingResponse,
} from "../../types/news";

export function fetchNewsSource(source: NewsSourceId, limit = 20): Promise<SourceListingResponse> {
  return apiRequest(`/news/sources/${encodeURIComponent(source)}?limit=${limit}`);
}

export function startReadingJob(input: ReadingRequest): Promise<ReadingJobResponse> {
  return apiRequest("/news/reading-jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchReadingJob(id: string): Promise<ReadingJobResponse> {
  return apiRequest(`/news/reading-jobs/${encodeURIComponent(id)}`);
}

export function fetchReadyReadings(): Promise<ReadyReadingsResponse> {
  return apiRequest("/news/ready-readings");
}

export function fetchReadyReading(id: string): Promise<ReadingResponse> {
  return apiRequest(`/news/ready-readings/${encodeURIComponent(id)}`);
}

export function recordReadingInteraction(
  input: ReadingInteractionRequest,
): Promise<ReadingInteractionResponse> {
  return apiRequest("/news/interactions", {
    method: "POST",
    body: JSON.stringify(input),
    keepalive: true,
  });
}

export function fetchDictionary(term: string, language: string): Promise<DictionaryLookupResponse> {
  return api.lookupDictionary(term, language);
}

export async function fetchSentenceAudio(
  text: string,
  language: string,
): Promise<{
  url: string;
  audioId: string | null;
}> {
  const result = await api.fetchWorkbenchAudio(text, language);
  return { url: result.url, audioId: result.audioId };
}
