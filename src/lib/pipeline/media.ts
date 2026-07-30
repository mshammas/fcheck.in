/**
 * Media analysis — stage 1's handling of attached files.
 *
 * Images and PDFs are read by Claude directly (vision + document input) and
 * turned into text that normalize() folds into the claim package, so a photo of
 * a claim or a PDF is fact-checked exactly like pasted text. Audio and video
 * need transcription, which is not wired yet (a Workers AI / external-API
 * blocker), so they stay flagged as "recorded, not analysed" — the same honest
 * fallback as before.
 *
 * The MIME split is a pure function (`partitionMedia`) so it is testable without
 * a Claude client; the network call is isolated behind the injected `extract`.
 */
import type { CheckFile } from '../types';
import type { AnalyzableMedia, MediaExtract } from '../providers/anthropic';
import { extractFromMedia } from '../providers/anthropic';
import type Anthropic from '@anthropic-ai/sdk';

/** Only image and PDF bytes can be read inline today. Data must be present. */
export function isAnalyzable(file: CheckFile): boolean {
  return Boolean(file.data) && (/^image\//.test(file.type) || file.type === 'application/pdf');
}

export interface MediaPartition {
  analyzable: AnalyzableMedia[];
  unprocessed: CheckFile[];
}

/** Splits attachments into the ones we can read now and the ones we can't. */
export function partitionMedia(files: CheckFile[]): MediaPartition {
  const analyzable: AnalyzableMedia[] = [];
  const unprocessed: CheckFile[] = [];
  for (const file of files) {
    if (isAnalyzable(file)) {
      analyzable.push({ name: file.name, type: file.type, data: file.data! });
    } else {
      unprocessed.push(file);
    }
  }
  return { analyzable, unprocessed };
}

export interface MediaAnalysis {
  /** Extracted text per analysed file, to fold into combinedText. */
  extracts: MediaExtract[];
  /** Files we could not analyse — wrong type, or bytes not supplied. */
  unprocessed: CheckFile[];
}

/**
 * Analyses attachments. The `extract` transport is injectable so tests can run
 * the branching without a Claude client; production binds it to extractFromMedia.
 */
export async function analyzeMedia(
  files: CheckFile[],
  extract: (files: AnalyzableMedia[]) => Promise<MediaExtract[]>
): Promise<MediaAnalysis> {
  const { analyzable, unprocessed } = partitionMedia(files);
  if (analyzable.length === 0) return { extracts: [], unprocessed };
  const extracts = await extract(analyzable);
  return { extracts, unprocessed };
}

/** Binds analyzeMedia to the real Claude transport. */
export function mediaAnalyzer(client: Anthropic): (files: CheckFile[]) => Promise<MediaAnalysis> {
  return (files) => analyzeMedia(files, (m) => extractFromMedia(client, m));
}
