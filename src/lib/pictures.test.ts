import { describe, expect, it, vi } from "vitest";
import {
  CONTACT_PHOTO,
  MAX_ZOOM,
  PICTURE_MAX_BYTES,
  PROFILE_PICTURE,
  PictureError,
  clampCrop,
  firstPictureFile,
  initialCrop,
  moveCrop,
  pictureFileProblem,
  readPicture,
  renderPicture,
  renderPictureBlob,
  sourceSquare,
  zoomCrop,
  zoomOf,
  type OutputCanvas,
} from "./pictures";

const VIEW = 256;

/** A canvas that records what was drawn and "encodes" in whatever type it is asked for. */
function fakeCanvas(encodes: (type: string) => string = (type) => type) {
  const drawn: unknown[][] = [];
  const fills: { style: unknown; rect: number[] }[] = [];
  const context = {
    fillStyle: "" as unknown,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low" as ImageSmoothingQuality,
    fillRect(...rect: number[]) {
      fills.push({ style: context.fillStyle, rect });
    },
    drawImage(...args: unknown[]) {
      drawn.push(args);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: vi.fn((type: string, quality: number) => `data:${encodes(type)};base64,${quality}`),
    toBlob: vi.fn((done: (blob: Blob | null) => void, type: string) => done(new Blob(["x"], { type: encodes(type) }))),
  };
  return { canvas, context, drawn, fills, create: () => canvas as unknown as OutputCanvas };
}

describe("placing a picture under the circle", () => {
  it("starts with the short side filling the square, centred", () => {
    expect(initialCrop(1000, 500, VIEW)).toEqual({ scale: 0.512, x: -128, y: 0 });
    expect(initialCrop(300, 600, VIEW)).toEqual({ scale: VIEW / 300, x: 0, y: -128 });
  });

  it("never lets an empty edge into the square", () => {
    const start = initialCrop(1000, 500, VIEW);
    expect(moveCrop(start, 500, 40, 1000, 500, VIEW)).toEqual({ scale: 0.512, x: 0, y: 0 });
    expect(moveCrop(start, -500, -40, 1000, 500, VIEW)).toEqual({ scale: 0.512, x: -256, y: 0 });
  });

  it("zooms around a point that stays in place, between covering and eight times that", () => {
    const start = initialCrop(1000, 1000, VIEW);
    const zoomed = zoomCrop(start, 2, 64, 64, 1000, 1000, VIEW);
    expect(zoomOf(zoomed, 1000, 1000, VIEW)).toBeCloseTo(2);
    // The picture point under (64, 64) is still there.
    expect((64 - zoomed.x) / zoomed.scale).toBeCloseTo((64 - start.x) / start.scale);
    expect(zoomOf(zoomCrop(start, 100, 0, 0, 1000, 1000, VIEW), 1000, 1000, VIEW)).toBeCloseTo(MAX_ZOOM);
    expect(zoomCrop(start, 0.1, 0, 0, 1000, 1000, VIEW)).toEqual(start);
    expect(clampCrop({ scale: 0, x: 5, y: 5 }, 1000, 1000, VIEW)).toEqual(start);
  });

  it("knows which square of the picture ends up in the output", () => {
    expect(sourceSquare({ scale: 0.5, x: -100, y: -20 }, VIEW)).toEqual({ x: 200, y: 40, size: 512 });
  });
});

describe("the cropped picture", () => {
  const picture = { source: {} as CanvasImageSource };

  it("is a 256 × 256 JPEG at quality 0.85 for a contact, on white", () => {
    const fake = fakeCanvas();
    const uri = renderPicture(picture, { scale: 0.5, x: -100, y: -20 }, VIEW, CONTACT_PHOTO, fake.create);
    expect(uri).toBe("data:image/jpeg;base64,0.85");
    expect([fake.canvas.width, fake.canvas.height]).toEqual([256, 256]);
    expect(fake.canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.85);
    expect(fake.fills).toEqual([{ style: "#ffffff", rect: [0, 0, 256, 256] }]);
    expect(fake.drawn).toEqual([[picture.source, 200, 40, 512, 512, 0, 0, 256, 256]]);
  });

  it("is a 512 × 512 JPEG file for the profile picture", async () => {
    const fake = fakeCanvas();
    const blob = await renderPictureBlob(picture, initialCrop(800, 600, VIEW), VIEW, PROFILE_PICTURE, fake.create);
    expect(blob.type).toBe("image/jpeg");
    expect([fake.canvas.width, fake.canvas.height]).toEqual([512, 512]);
    expect(fake.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
  });

  it("is refused rather than stored as something else when the browser can't write JPEG", async () => {
    const fake = fakeCanvas(() => "image/png");
    expect(() => renderPicture(picture, initialCrop(10, 10, VIEW), VIEW, CONTACT_PHOTO, fake.create)).toThrow(
      PictureError,
    );
    await expect(
      renderPictureBlob(picture, initialCrop(10, 10, VIEW), VIEW, PROFILE_PICTURE, fake.create),
    ).rejects.toThrow(PictureError);
  });
});

describe("picture files", () => {
  it("takes pictures only, and not huge ones", () => {
    expect(pictureFileProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(pictureFileProblem({ type: "application/pdf", size: 1000 })).toBe("notImage");
    expect(pictureFileProblem({ type: "", size: 1000 })).toBe("notImage");
    expect(pictureFileProblem({ type: "image/png", size: PICTURE_MAX_BYTES + 1 })).toBe("tooLarge");
    expect(pictureFileProblem({ type: "image/png", size: 0 })).toBe("unreadable");
  });

  it("refuses before decoding anything", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    try {
      await expect(readPicture(new Blob(["%PDF"], { type: "application/pdf" }))).rejects.toMatchObject({
        problem: "notImage",
      });
      const huge = { type: "image/jpeg", size: PICTURE_MAX_BYTES + 1 } as Blob;
      await expect(readPicture(huge)).rejects.toMatchObject({ problem: "tooLarge" });
      expect(decode).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("turns photos the way their camera meant, and refuses giant ones after decoding", async () => {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ width: 10_000, height: 10_000, close }));
    vi.stubGlobal("createImageBitmap", decode);
    try {
      const file = new Blob(["jpeg"], { type: "image/jpeg" });
      await expect(readPicture(file)).rejects.toMatchObject({ problem: "tooLarge" });
      expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
      expect(close).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("finds the picture among dropped files", () => {
    const text = new File(["a"], "a.txt", { type: "text/plain" });
    const photo = new File(["b"], "b.jpg", { type: "image/jpeg" });
    expect(firstPictureFile([text, photo])).toBe(photo);
    expect(firstPictureFile([text])).toBeNull();
    expect(firstPictureFile(null)).toBeNull();
  });
});
