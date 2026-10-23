import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { findPhotoProblem, isPhotoCandidate, scanPhoto } from './photo-metadata.ts';

// Tiny files with only the structure that the scanner reads. The text parts are ASCII.
const encoder = new TextEncoder();
const bytesOf = (...parts: readonly (string | readonly number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...encoder.encode(part)] : [...part])),
  );

const uint16 = (value: number): number[] => [value >> 8, value & 0xff];
const uint32 = (value: number): number[] => [0, 0, value >> 8, value & 0xff];
const uint32le = (value: number): number[] => [value & 0xff, value >> 8, 0, 0];

/** A JPEG segment: marker, length (with the 2 length bytes), payload. */
const segment = (marker: number, payload: string): (string | number[])[] => [
  [0xff, marker, ...uint16(payload.length + 2)],
  payload,
];

/** A PNG chunk: length, type, data, CRC (not checked). */
const chunk = (type: string, data: string): (string | number[])[] => [
  uint32(data.length),
  type,
  data,
  [0, 0, 0, 0],
];

/** A RIFF chunk: fourcc, little-endian size, data, padding to an even size. */
const riffChunk = (fourcc: string, data: string): (string | number[])[] => [
  fourcc,
  uint32le(data.length),
  data,
  data.length % 2 === 1 ? [0] : [],
];

const JPEG_START = [0xff, 0xd8];
const JPEG_IMAGE = [0xff, 0xda, 0, 4, 1, 2, 0xff, 0xd9];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const jpeg = (...segments: (string | number[])[][]): Uint8Array =>
  bytesOf(JPEG_START, ...segments.flat(), JPEG_IMAGE);
const png = (...chunks: (string | number[])[][]): Uint8Array =>
  bytesOf(PNG_SIGNATURE, ...chunks.flat(), ...chunk('IEND', ''));
const webp = (...chunks: (string | number[])[][]): Uint8Array =>
  bytesOf('RIFF', uint32le(0), 'WEBP', ...chunks.flat());

describe('scanPhoto', () => {
  it('finds EXIF in a JPEG APP1 segment, after other segments and fill bytes', () => {
    expect(scanPhoto(jpeg(segment(0xe0, 'JFIF\0'), segment(0xe1, 'Exif\0\0II*\0')))).toEqual({
      format: 'jpeg',
      metadata: 'EXIF',
    });
    expect(scanPhoto(jpeg([[0xff]], segment(0xe1, 'Exif\0\0MM\0*')))).toEqual({
      format: 'jpeg',
      metadata: 'EXIF',
    });
  });

  it('finds XMP and every other APP1 segment in a JPEG, and nothing in a JPEG without APP1', () => {
    expect(scanPhoto(jpeg(segment(0xe0, 'JFIF\0')))).toEqual({
      format: 'jpeg',
      metadata: undefined,
    });
    const xmp = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude="37,12.5N"/>';
    expect(scanPhoto(jpeg(segment(0xe0, 'JFIF\0'), segment(0xe1, xmp)))).toEqual({
      format: 'jpeg',
      metadata: 'XMP',
    });
    expect(scanPhoto(jpeg(segment(0xe1, 'http://ns.adobe.com/xmp/extension/\0')))).toEqual({
      format: 'jpeg',
      metadata: 'APP1',
    });
    expect(scanPhoto(jpeg([[0xff, 0xd0]], segment(0xdb, 'table')))).toEqual({
      format: 'jpeg',
      metadata: undefined,
    });
  });

  it('stops at the image data, so pixel bytes cannot look like EXIF', () => {
    const exifAfterScan = bytesOf(JPEG_START, [0xff, 0xda, 0, 2], ...segment(0xe1, 'Exif\0\0'));
    expect(scanPhoto(exifAfterScan).metadata).toBeUndefined();
    expect(scanPhoto(bytesOf(JPEG_START, [0x00, 0x01, 0x02, 0x03])).metadata).toBeUndefined();
  });

  it('finds an eXIf chunk in a PNG, and none in a PNG without it', () => {
    expect(scanPhoto(png(chunk('IHDR', '13 bytes here'), chunk('eXIf', 'II*\0')))).toEqual({
      format: 'png',
      metadata: 'EXIF',
    });
    expect(scanPhoto(png(chunk('IHDR', '13 bytes here'), chunk('IDAT', 'eXIf')))).toEqual({
      format: 'png',
      metadata: undefined,
    });
    expect(scanPhoto(bytesOf(PNG_SIGNATURE, ...chunk('IHDR', 'x'))).metadata).toBeUndefined();
  });

  it('finds XMP in a PNG iTXt, tEXt or zTXt chunk, and no XMP in other text chunks', () => {
    for (const type of ['iTXt', 'tEXt', 'zTXt']) {
      const xmp = chunk(type, 'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>');
      expect(scanPhoto(png(chunk('IHDR', '13 bytes here'), xmp))).toEqual({
        format: 'png',
        metadata: 'XMP',
      });
    }
    expect(scanPhoto(png(chunk('tEXt', 'Comment\0XML:com.adobe.xmp')))).toEqual({
      format: 'png',
      metadata: undefined,
    });
    expect(scanPhoto(png(chunk('IDAT', 'XML:com.adobe.xmp\0')))).toEqual({
      format: 'png',
      metadata: undefined,
    });
  });

  it('finds an EXIF or XMP chunk in a WebP, after an odd-sized chunk, and none without it', () => {
    expect(scanPhoto(webp(riffChunk('VP8X', 'odd'), riffChunk('EXIF', 'II*\0')))).toEqual({
      format: 'webp',
      metadata: 'EXIF',
    });
    expect(scanPhoto(webp(riffChunk('VP8X', 'odd'), riffChunk('XMP ', '<x:xmpmeta/>')))).toEqual({
      format: 'webp',
      metadata: 'XMP',
    });
    expect(scanPhoto(webp(riffChunk('VP8 ', 'EXIF and XMP  in pixels')))).toEqual({
      format: 'webp',
      metadata: undefined,
    });
  });

  it('does not know other formats', () => {
    expect(scanPhoto(bytesOf('GIF89a'))).toEqual({ format: undefined, metadata: undefined });
    expect(scanPhoto(bytesOf('RIFF', uint32le(0), 'WAVE'))).toEqual({
      format: undefined,
      metadata: undefined,
    });
  });

  it('finds no EXIF in the e2e fixture images', async () => {
    const photo = await readFile(new URL('../../web/e2e/fixtures/photo.jpg', import.meta.url));
    const tile = await readFile(new URL('../../web/e2e/fixtures/tile.png', import.meta.url));
    expect(scanPhoto(photo)).toEqual({ format: 'jpeg', metadata: undefined });
    expect(scanPhoto(tile)).toEqual({ format: 'png', metadata: undefined });
  });
});

describe('findPhotoProblem', () => {
  it('names the file and the metadata, and says how to remove it', () => {
    expect(findPhotoProblem('web/public/photos/zion/a.jpg', jpeg(segment(0xe1, 'Exif\0\0')))).toBe(
      'web/public/photos/zion/a.jpg: this photo has EXIF data, which can hold the GPS position ' +
        'where you took it. Remove all metadata with `exiftool -all= -overwrite_original ' +
        'web/public/photos/zion/a.jpg`, or export the photo again from Apple Photos with ' +
        '"Location Information" turned off.',
    );
    const xmp = webp(riffChunk('XMP ', '<x:xmpmeta/>'));
    expect(findPhotoProblem('b.webp', xmp)).toMatch(
      /^b\.webp: this photo has XMP data, .* `exiftool -all= -overwrite_original b\.webp`/,
    );
    const app1 = jpeg(segment(0xe1, 'other\0'));
    expect(findPhotoProblem('c.jpg', app1)).toMatch(
      /^c\.jpg: this photo has an APP1 metadata block/,
    );
  });

  it('rejects a file that is not a JPEG, PNG or WebP, and accepts a clean photo', () => {
    expect(findPhotoProblem('a.gif', bytesOf('GIF89a'))).toBe(
      'a.gif: this file is not a JPEG, PNG or WebP photo. Export it again as .jpg, .png or .webp.',
    );
    expect(findPhotoProblem('a.png', png())).toBeUndefined();
  });
});

describe('isPhotoCandidate', () => {
  it('skips hidden files such as .DS_Store, and checks every other file', () => {
    expect(isPhotoCandidate('.DS_Store')).toBe(false);
    expect(isPhotoCandidate('._narrows.jpg')).toBe(false);
    expect(isPhotoCandidate('narrows.jpg')).toBe(true);
    expect(isPhotoCandidate('notes.txt')).toBe(true);
  });
});
