// Finds EXIF and XMP metadata in owner photos. Both can hold the GPS position where the photo was
// taken (Lightroom and Photoshop write `exif:GPSLatitude` into XMP), and that tells strangers where
// the owner stays. The site is public, so the data test rejects both.
// It reads the file structure only (no dependencies): JPEG segments, PNG chunks and WebP chunks.

/** The photo formats that the site accepts. */
export type PhotoFormat = 'jpeg' | 'png' | 'webp';

/**
 * A metadata block that can hold a GPS position. `APP1` is a JPEG APP1 segment of another kind,
 * for example extended XMP. The scan rejects every APP1 segment.
 */
export type PhotoMetadata = 'EXIF' | 'XMP' | 'APP1';

/** What the scan found in a file. */
export type PhotoScan = {
  /** The format, or undefined when the file is not a JPEG, PNG or WebP. */
  readonly format: PhotoFormat | undefined;
  /** The first metadata block, or undefined when the file has none. */
  readonly metadata: PhotoMetadata | undefined;
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
const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0';
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp\0';
const PNG_TEXT_CHUNKS: ReadonlySet<string> = new Set(['iTXt', 'tEXt', 'zTXt']);
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
 * Names the kind of a JPEG APP1 segment from the start of its payload.
 *
 * @param bytes - The JPEG file.
 * @param payload - The offset of the payload.
 * @returns The kind.
 */
function app1Kind(bytes: Uint8Array, payload: number): PhotoMetadata {
  if (ascii(bytes, payload, EXIF_HEADER.length) === EXIF_HEADER) {
    return 'EXIF';
  }
  return ascii(bytes, payload, XMP_NAMESPACE.length) === XMP_NAMESPACE ? 'XMP' : 'APP1';
}

/**
 * Looks for an APP1 segment (EXIF, XMP or any other kind), before the image data starts.
 *
 * @param bytes - The JPEG file.
 * @returns The first metadata block, or undefined.
 */
function jpegMetadata(bytes: Uint8Array): PhotoMetadata | undefined {
  const view = viewOf(bytes);
  let offset = JPEG_START.length;
  while (offset + JPEG_MARKER_SIZE + JPEG_LENGTH_SIZE <= bytes.length) {
    if (bytes[offset] !== MARKER_PREFIX) {
      return undefined;
    }
    const marker = bytes[offset + 1] ?? JPEG_END;
    if (marker === MARKER_PREFIX) {
      // A fill byte before the marker.
      offset += 1;
      continue;
    }
    if (marker === JPEG_START_OF_SCAN || marker === JPEG_END) {
      return undefined;
    }
    if (hasNoLength(marker)) {
      offset += JPEG_MARKER_SIZE;
      continue;
    }
    const length = view.getUint16(offset + JPEG_MARKER_SIZE);
    const payload = offset + JPEG_MARKER_SIZE + JPEG_LENGTH_SIZE;
    if (marker === JPEG_APP1) {
      return app1Kind(bytes, payload);
    }
    offset += JPEG_MARKER_SIZE + length;
  }
  return undefined;
}

/**
 * Looks for an `eXIf` chunk, and for a text chunk (`iTXt`, `tEXt` or `zTXt`) with the XMP keyword.
 *
 * @param bytes - The PNG file.
 * @returns The first metadata block, or undefined.
 */
function pngMetadata(bytes: Uint8Array): PhotoMetadata | undefined {
  const view = viewOf(bytes);
  let offset = PNG_SIGNATURE.length;
  while (offset + PNG_CHUNK_HEADER <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + FOURCC_SIZE, FOURCC_SIZE);
    if (type === 'eXIf') {
      return 'EXIF';
    }
    const data = offset + PNG_CHUNK_HEADER;
    if (
      PNG_TEXT_CHUNKS.has(type) &&
      ascii(bytes, data, PNG_XMP_KEYWORD.length) === PNG_XMP_KEYWORD
    ) {
      return 'XMP';
    }
    if (type === 'IEND') {
      return undefined;
    }
    offset += PNG_CHUNK_HEADER + length + PNG_CRC_SIZE;
  }
  return undefined;
}

/**
 * Looks for an `EXIF` or an `XMP ` chunk in the RIFF container.
 *
 * @param bytes - The WebP file.
 * @returns The first metadata block, or undefined.
 */
function webpMetadata(bytes: Uint8Array): PhotoMetadata | undefined {
  const view = viewOf(bytes);
  let offset = RIFF_HEADER;
  while (offset + RIFF_CHUNK_HEADER <= bytes.length) {
    const fourcc = ascii(bytes, offset, FOURCC_SIZE);
    if (fourcc === 'EXIF') {
      return 'EXIF';
    }
    if (fourcc === 'XMP ') {
      return 'XMP';
    }
    const size = view.getUint32(offset + FOURCC_SIZE, true);
    // RIFF chunks have an even size: an odd chunk has one padding byte.
    offset += RIFF_CHUNK_HEADER + size + (size % 2);
  }
  return undefined;
}

const isWebp = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, FOURCC_SIZE) === 'RIFF' &&
  ascii(bytes, WEBP_FORMAT_OFFSET, FOURCC_SIZE) === 'WEBP';

/**
 * Finds the format of a photo file and its first EXIF or XMP block.
 *
 * @param bytes - The file content.
 * @returns The scan result.
 */
export function scanPhoto(bytes: Uint8Array): PhotoScan {
  if (startsWith(bytes, JPEG_START)) {
    return { format: 'jpeg', metadata: jpegMetadata(bytes) };
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return { format: 'png', metadata: pngMetadata(bytes) };
  }
  if (isWebp(bytes)) {
    return { format: 'webp', metadata: webpMetadata(bytes) };
  }
  return { format: undefined, metadata: undefined };
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

const METADATA_NAMES: Readonly<Record<PhotoMetadata, string>> = {
  EXIF: 'EXIF data',
  XMP: 'XMP data',
  APP1: 'an APP1 metadata block',
};

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
  if (scan.metadata !== undefined) {
    return (
      `${path}: this photo has ${METADATA_NAMES[scan.metadata]}, which can hold the GPS position ` +
      `where you took it. Remove all metadata with \`exiftool -all= -overwrite_original ${path}\`, ` +
      'or export the photo again from Apple Photos with "Location Information" turned off.'
    );
  }
  return undefined;
}
