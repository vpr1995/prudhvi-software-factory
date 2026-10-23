// Finds EXIF data in owner photos. EXIF can hold the GPS position where the photo was taken, and
// that tells strangers where the owner stays. The site is public, so the data test rejects it.
// It reads the file structure only (no dependencies): JPEG segments, PNG chunks and WebP chunks.

/** The photo formats that the site accepts. */
export type PhotoFormat = 'jpeg' | 'png' | 'webp';

/** What the scan found in a file. */
export type PhotoScan = {
  /** The format, or undefined when the file is not a JPEG, PNG or WebP. */
  readonly format: PhotoFormat | undefined;
  /** True when the file has an EXIF block. */
  readonly hasExif: boolean;
};

const JPEG_START = [0xff, 0xd8];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MARKER_PREFIX = 0xff;
const JPEG_APP1 = 0xe1;
const JPEG_START_OF_SCAN = 0xda;
const JPEG_END = 0xd9;
const JPEG_TEM = 0x01;
const JPEG_RESTART_FIRST = 0xd0;
const JPEG_RESTART_LAST = 0xd7;
const JPEG_MARKER_SIZE = 2;
const JPEG_LENGTH_SIZE = 2;
const EXIF_HEADER = 'Exif\0\0';
const PNG_CHUNK_HEADER = 8;
const PNG_CRC_SIZE = 4;
const RIFF_HEADER = 12;
const RIFF_CHUNK_HEADER = 8;
const WEBP_FORMAT_OFFSET = 8;
const FOURCC_SIZE = 4;

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCodePoint(...bytes.subarray(start, start + length));

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((value, index) => bytes[index] === value);

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const hasNoLength = (marker: number): boolean =>
  marker === JPEG_TEM || (marker >= JPEG_RESTART_FIRST && marker <= JPEG_RESTART_LAST);

/**
 * Looks for an APP1 segment that starts with `Exif\0\0`, before the image data starts.
 *
 * @param bytes - The JPEG file.
 * @returns True when the file has EXIF data.
 */
function jpegHasExif(bytes: Uint8Array): boolean {
  const view = viewOf(bytes);
  let offset = JPEG_START.length;
  while (offset + JPEG_MARKER_SIZE + JPEG_LENGTH_SIZE <= bytes.length) {
    if (bytes[offset] !== MARKER_PREFIX) {
      return false;
    }
    const marker = bytes[offset + 1] ?? JPEG_END;
    if (marker === MARKER_PREFIX) {
      // A fill byte before the marker.
      offset += 1;
      continue;
    }
    if (marker === JPEG_START_OF_SCAN || marker === JPEG_END) {
      return false;
    }
    if (hasNoLength(marker)) {
      offset += JPEG_MARKER_SIZE;
      continue;
    }
    const length = view.getUint16(offset + JPEG_MARKER_SIZE);
    const payload = offset + JPEG_MARKER_SIZE + JPEG_LENGTH_SIZE;
    if (marker === JPEG_APP1 && ascii(bytes, payload, EXIF_HEADER.length) === EXIF_HEADER) {
      return true;
    }
    offset += JPEG_MARKER_SIZE + length;
  }
  return false;
}

/**
 * Looks for an `eXIf` chunk.
 *
 * @param bytes - The PNG file.
 * @returns True when the file has EXIF data.
 */
function pngHasExif(bytes: Uint8Array): boolean {
  const view = viewOf(bytes);
  let offset = PNG_SIGNATURE.length;
  while (offset + PNG_CHUNK_HEADER <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + FOURCC_SIZE, FOURCC_SIZE);
    if (type === 'eXIf') {
      return true;
    }
    if (type === 'IEND') {
      return false;
    }
    offset += PNG_CHUNK_HEADER + length + PNG_CRC_SIZE;
  }
  return false;
}

/**
 * Looks for an `EXIF` chunk in the RIFF container.
 *
 * @param bytes - The WebP file.
 * @returns True when the file has EXIF data.
 */
function webpHasExif(bytes: Uint8Array): boolean {
  const view = viewOf(bytes);
  let offset = RIFF_HEADER;
  while (offset + RIFF_CHUNK_HEADER <= bytes.length) {
    if (ascii(bytes, offset, FOURCC_SIZE) === 'EXIF') {
      return true;
    }
    const size = view.getUint32(offset + FOURCC_SIZE, true);
    // RIFF chunks have an even size: an odd chunk has one padding byte.
    offset += RIFF_CHUNK_HEADER + size + (size % 2);
  }
  return false;
}

const isWebp = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, FOURCC_SIZE) === 'RIFF' &&
  ascii(bytes, WEBP_FORMAT_OFFSET, FOURCC_SIZE) === 'WEBP';

/**
 * Finds the format of a photo file and tells whether it has EXIF data.
 *
 * @param bytes - The file content.
 * @returns The scan result.
 */
export function scanPhoto(bytes: Uint8Array): PhotoScan {
  if (startsWith(bytes, JPEG_START)) {
    return { format: 'jpeg', hasExif: jpegHasExif(bytes) };
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return { format: 'png', hasExif: pngHasExif(bytes) };
  }
  if (isWebp(bytes)) {
    return { format: 'webp', hasExif: webpHasExif(bytes) };
  }
  return { format: undefined, hasExif: false };
}

/**
 * Tells whether a file is a photo to check. Hidden files, for example the `.DS_Store` file that
 * Finder writes, are not photos. The site does not link to them.
 *
 * @param name - The file name.
 * @returns True when the scan must check the file.
 */
export function isPhotoCandidate(name: string): boolean {
  return !name.startsWith('.');
}

/**
 * Tells what is wrong with an owner photo, and how to fix it.
 *
 * @param path - The file path, for the message.
 * @param bytes - The file content.
 * @returns The problem, or undefined when the photo is safe to publish.
 */
export function findPhotoProblem(path: string, bytes: Uint8Array): string | undefined {
  const scan = scanPhoto(bytes);
  if (scan.format === undefined) {
    return `${path}: this file is not a JPEG, PNG or WebP photo. Export it again as .jpg, .png or .webp.`;
  }
  if (scan.hasExif) {
    return (
      `${path}: this photo has EXIF data, which can hold the GPS position where you took it. ` +
      `Remove it with \`exiftool -all= -overwrite_original ${path}\`, or export the photo again ` +
      'from Apple Photos with "Location Information" turned off.'
    );
  }
  return undefined;
}
