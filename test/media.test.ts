/**
 * Media analysis tests. No Claude client and no network: the extraction
 * transport is injected, so these exercise the MIME branching and the way
 * normalize() folds extracted text into the claim package.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CheckFile } from '../src/lib/types';
import { partitionMedia, isAnalyzable, analyzeMedia } from '../src/lib/pipeline/media';
import { normalize } from '../src/lib/pipeline/normalize';

const img = (name = 'a.png', data = 'AAAA'): CheckFile => ({ name, type: 'image/png', size: 10, data });
const pdf = (name = 'd.pdf', data = 'BBBB'): CheckFile => ({ name, type: 'application/pdf', size: 20, data });
const video = (name = 'v.mp4'): CheckFile => ({ name, type: 'video/mp4', size: 999 });
const imgNoData = (name = 'b.png'): CheckFile => ({ name, type: 'image/png', size: 10 });

describe('partitionMedia', () => {
  it('routes image/pdf with bytes to analyzable, everything else to unprocessed', () => {
    const { analyzable, unprocessed } = partitionMedia([img(), pdf(), video(), imgNoData()]);
    expect(analyzable.map((f) => f.name)).toEqual(['a.png', 'd.pdf']);
    expect(unprocessed.map((f) => f.name)).toEqual(['v.mp4', 'b.png']); // video + image-without-bytes
  });

  it('treats an image without bytes as not analyzable', () => {
    expect(isAnalyzable(imgNoData())).toBe(false);
    expect(isAnalyzable(img())).toBe(true);
  });
});

describe('analyzeMedia', () => {
  it('calls the transport only with analyzable files', async () => {
    const extract = vi.fn(async (files: { name: string }[]) => files.map((f) => ({ name: f.name, text: `read ${f.name}` })));
    const result = await analyzeMedia([img(), video()], extract);

    expect(extract).toHaveBeenCalledOnce();
    expect(extract.mock.calls[0][0].map((f) => f.name)).toEqual(['a.png']);
    expect(result.extracts).toEqual([{ name: 'a.png', text: 'read a.png' }]);
    expect(result.unprocessed.map((f) => f.name)).toEqual(['v.mp4']);
  });

  it('does not call the transport when nothing is analyzable', async () => {
    const extract = vi.fn();
    const result = await analyzeMedia([video(), imgNoData()], extract);
    expect(extract).not.toHaveBeenCalled();
    expect(result.extracts).toEqual([]);
    expect(result.unprocessed).toHaveLength(2);
  });
});

describe('normalize with media', () => {
  const analyzeMediaStub = async (files: CheckFile[]) => {
    const { analyzable, unprocessed } = partitionMedia(files);
    return { extracts: analyzable.map((f) => ({ name: f.name, text: `Claim from ${f.name}` })), unprocessed };
  };

  it('folds extracted image/pdf text into combinedText', async () => {
    const input = await normalize({ text: 'See attached.', files: [img(), pdf()] }, { analyzeMedia: analyzeMediaStub });

    expect(input.combinedText).toContain('See attached.');
    expect(input.combinedText).toContain('[Content of attached file a.png]');
    expect(input.combinedText).toContain('Claim from a.png');
    expect(input.combinedText).toContain('Claim from d.pdf');
    expect(input.hasUnprocessedMedia).toBe(false);
    expect(input.detectedTypes).toContain('image');
  });

  it('flags audio/video as unprocessed while still reading the image', async () => {
    const input = await normalize({ files: [img(), video()] }, { analyzeMedia: analyzeMediaStub });

    expect(input.combinedText).toContain('Claim from a.png');
    expect(input.hasUnprocessedMedia).toBe(true);
    expect(input.combinedText).toContain('[Attached, not yet analysed: v.mp4]');
    expect(input.notes.some((n) => /not analysed/.test(n))).toBe(true);
  });

  it('without an analyzer, all media stays unprocessed (back-compat)', async () => {
    const input = await normalize({ files: [img(), video()] });
    expect(input.hasUnprocessedMedia).toBe(true);
    expect(input.combinedText).toContain('[Attached, not yet analysed: a.png, v.mp4]');
  });

  it('a media-only submission of an unsupported type has no readable text', async () => {
    const input = await normalize({ files: [video()] }, { analyzeMedia: analyzeMediaStub });
    // Only the placeholder — the pipeline routes this to TYPE 4.
    expect(input.combinedText.replace(/\[Attached[^\]]*\]/g, '').trim()).toBe('');
  });
});
