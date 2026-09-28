/**
 * Pictures for people: contact photos and the own profile picture.
 *
 * A picture is read in the browser, cropped to a circle the person places themselves, and only
 * the small square that comes out of that leaves the page — never the original file with its
 * metadata. Everything here but `readPicture` and the canvas is plain arithmetic, so it can be
 * tested without a browser.
 */

/** Files larger than this are refused before they are decoded. */
export const PICTURE_MAX_BYTES = 20 * 1024 * 1024;
/** Decoded pictures with more pixels than this are refused; a phone photo has about 12 million. */
export const PICTURE_MAX_PIXELS = 60_000_000;
/** How far in one can zoom, from the size where the picture just covers the circle. */
export const MAX_ZOOM = 8;

/** A contact photo: small enough that a card stays far below the server's 1 MiB. */
export const CONTACT_PHOTO = { size: 256, type: "image/jpeg", quality: 0.85 } as const;
/** The own profile picture; the server scales it to at most 512 × 512 anyway. */
export const PROFILE_PICTURE = { size: 512, type: "image/jpeg", quality: 0.9 } as const;

export type PictureProblem = "notImage" | "tooLarge" | "unreadable";

export class PictureError extends Error {
  readonly problem: PictureProblem;

  constructor(problem: PictureProblem) {
    super(problem);
    this.name = "PictureError";
    this.problem = problem;
  }
}

/** A decoded picture, turned the way its camera meant it. */
export interface Picture {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Frees the decoded pixels. */
  close: () => void;
}

/** What a file must look like before it is decoded at all. */
export function pictureFileProblem(file: Pick<Blob, "type" | "size">): PictureProblem | null {
  if (!/^image\//i.test(file.type)) return "notImage";
  if (file.size > PICTURE_MAX_BYTES) return "tooLarge";
  if (file.size === 0) return "unreadable";
  return null;
}

/** Decodes through an `<img>`, for what createImageBitmap can't read (SVG in most browsers). */
function decodeWithImage(file: Blob): Promise<Picture> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  return new Promise<Picture>((resolve, reject) => {
    image.onload = () => {
      // An SVG without a size of its own has no pixels to count; it is drawn at a sensible one.
      const width = image.naturalWidth || 512;
      const height = image.naturalHeight || 512;
      resolve({ source: image, width, height, close: () => URL.revokeObjectURL(url) });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PictureError("unreadable"));
    };
    image.src = url;
  });
}

/**
 * Reads a picture file. The EXIF orientation of photos is applied, so a portrait taken on a
 * phone stays upright. Throws a PictureError for anything that isn't a picture or is too big.
 */
export async function readPicture(file: Blob): Promise<Picture> {
  const problem = pictureFileProblem(file);
  if (problem) throw new PictureError(problem);
  let picture: Picture;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    picture = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    picture = await decodeWithImage(file);
  }
  if (picture.width < 1 || picture.height < 1) {
    picture.close();
    throw new PictureError("unreadable");
  }
  if (picture.width * picture.height > PICTURE_MAX_PIXELS) {
    picture.close();
    throw new PictureError("tooLarge");
  }
  return picture;
}

// ------------------------------------------------------------------------------------------------
// Placing the picture under the circle

/**
 * Where the picture lies under the square crop area of `view` × `view` pixels: its top left
 * corner at (x, y), drawn `scale` pixels per picture pixel. The circle is the square's inscribed one.
 */
export interface Crop {
  x: number;
  y: number;
  scale: number;
}

/** The smallest scale at which the picture still covers the whole square. */
export function coverScale(width: number, height: number, view: number): number {
  return Math.max(view / width, view / height);
}

/** Keeps the scale within cover × [1, MAX_ZOOM] and the square covered, nothing empty showing. */
export function clampCrop(crop: Crop, width: number, height: number, view: number): Crop {
  const min = coverScale(width, height, view);
  const scale = Math.min(Math.max(crop.scale, min), min * MAX_ZOOM);
  const clamp = (value: number, size: number) => Math.min(0, Math.max(view - size * scale, value));
  return { scale, x: clamp(crop.x, width), y: clamp(crop.y, height) };
}

/** The whole picture's short side under the circle, centred. */
export function initialCrop(width: number, height: number, view: number): Crop {
  const scale = coverScale(width, height, view);
  return { scale, x: (view - width * scale) / 2, y: (view - height * scale) / 2 };
}

/** Moves the picture by (dx, dy) screen pixels. */
export function moveCrop(crop: Crop, dx: number, dy: number, width: number, height: number, view: number): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, width, height, view);
}

/** Zooms by `factor` around the point (cx, cy) of the square, which stays where it is. */
export function zoomCrop(
  crop: Crop,
  factor: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  view: number,
): Crop {
  const wanted = clampCrop({ ...crop, scale: crop.scale * factor }, width, height, view).scale;
  const ratio = wanted / crop.scale;
  return clampCrop(
    { scale: wanted, x: cx - (cx - crop.x) * ratio, y: cy - (cy - crop.y) * ratio },
    width,
    height,
    view,
  );
}

/** How far in the crop is zoomed: 1 where the picture just covers the square. */
export function zoomOf(crop: Crop, width: number, height: number, view: number): number {
  return crop.scale / coverScale(width, height, view);
}

/** The square of the picture, in picture pixels, that ends up in the output. */
export function sourceSquare(crop: Crop, view: number): { x: number; y: number; size: number } {
  return { x: -crop.x / crop.scale, y: -crop.y / crop.scale, size: view / crop.scale };
}

// ------------------------------------------------------------------------------------------------
// Drawing the result

export interface PictureOutput {
  size: number;
  type: string;
  quality: number;
}

/** The parts of a canvas the output needs, so tests can hand in their own. */
export interface OutputCanvas {
  width: number;
  height: number;
  getContext(
    kind: "2d",
  ): Pick<
    CanvasRenderingContext2D,
    "drawImage" | "fillRect" | "fillStyle" | "imageSmoothingEnabled" | "imageSmoothingQuality"
  > | null;
  toDataURL(type: string, quality: number): string;
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void;
}

const newCanvas = (): OutputCanvas => document.createElement("canvas") as unknown as OutputCanvas;

/** Draws the cropped square at the output size, on white: JPEG has no transparency. */
function drawOutput(
  picture: Pick<Picture, "source">,
  crop: Crop,
  view: number,
  output: PictureOutput,
  createCanvas: () => OutputCanvas,
): OutputCanvas {
  const canvas = createCanvas();
  canvas.width = output.size;
  canvas.height = output.size;
  const context = canvas.getContext("2d");
  if (!context) throw new PictureError("unreadable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.size, output.size);
  const square = sourceSquare(crop, view);
  context.drawImage(picture.source, square.x, square.y, square.size, square.size, 0, 0, output.size, output.size);
  return canvas;
}

/** The cropped picture as a `data:` URI, e.g. for a contact card. */
export function renderPicture(
  picture: Pick<Picture, "source">,
  crop: Crop,
  view: number,
  output: PictureOutput = CONTACT_PHOTO,
  createCanvas: () => OutputCanvas = newCanvas,
): string {
  const uri = drawOutput(picture, crop, view, output, createCanvas).toDataURL(output.type, output.quality);
  // A browser that can't write the type falls back to PNG; better to say so than to store that.
  if (!uri.startsWith(`data:${output.type}`)) throw new PictureError("unreadable");
  return uri;
}

/** The cropped picture as a file, e.g. for an upload. */
export function renderPictureBlob(
  picture: Pick<Picture, "source">,
  crop: Crop,
  view: number,
  output: PictureOutput = PROFILE_PICTURE,
  createCanvas: () => OutputCanvas = newCanvas,
): Promise<Blob> {
  const canvas = drawOutput(picture, crop, view, output, createCanvas);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob && blob.type === output.type ? resolve(blob) : reject(new PictureError("unreadable"))),
      output.type,
      output.quality,
    ),
  );
}

/** The first picture file among dropped or pasted ones. */
export function firstPictureFile(files: FileList | readonly File[] | null | undefined): File | null {
  for (const file of Array.from(files ?? [])) if (/^image\//i.test(file.type)) return file;
  return null;
}
