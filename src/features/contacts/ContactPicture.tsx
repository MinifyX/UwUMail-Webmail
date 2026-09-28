import clsx from "clsx";
import { Building2, Camera, ImagePlus, Trash } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { backend } from "@/backend/backend";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n";
import { useMediaQuery } from "@/lib/device";
import { CONTACT_PHOTO, firstPictureFile, renderPicture, type Crop, type Picture } from "@/lib/pictures";
import { toast } from "@/state/toasts";
import { CROP_VIEW, PictureCropDialog } from "../pictures/PictureCropDialog";

/** Phones and tablets, where a file input can open the camera. */
const TOUCH_QUERY = "(pointer: coarse)";

/**
 * The contact's picture in the editor: choose a file, drop one on the circle, paste one, take a
 * photo on a phone or use the company's logo, then crop it; or remove it. What comes out is a
 * small square JPEG that goes into the card itself.
 */
export function ContactPictureField({
  photo,
  src,
  email,
  onChange,
}: {
  /** The picture the contact will have, as stored (a `data:` URI) or null. */
  photo: string | null;
  /** Where the circle shows it from; null while there is nothing to show. */
  src: string | null;
  /** The address whose company logo can be taken, if any. */
  email: string | null;
  onChange: (photo: string | null) => void;
}) {
  const { t } = useT();
  const touch = useMediaQuery(TOUCH_QUERY);
  const [file, setFile] = useState<Blob | null>(null);
  const [over, setOver] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const domain = email?.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";

  // A picture pasted anywhere in the open editor lands here; text still pastes as text.
  useEffect(() => {
    if (file) return;
    const paste = (event: ClipboardEvent) => {
      const pasted = firstPictureFile(event.clipboardData?.files);
      if (!pasted) return;
      event.preventDefault();
      setFile(pasted);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [file]);

  const picked = (files: FileList | null) => {
    const chosen = files?.[0];
    if (chosen) setFile(chosen);
  };

  const dragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    // A picture among the files if there is one; otherwise the first file, which the crop step refuses.
    const dropped = firstPictureFile(event.dataTransfer.files) ?? event.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const takeLogo = async () => {
    if (!email) return;
    setLogoBusy(true);
    try {
      const logo = await backend().companyLogo(email);
      if (logo) setFile(logo);
      else toast(t("contacts.picture.noLogo", { domain }), "info");
    } finally {
      setLogoBusy(false);
    }
  };

  const cropped = (picture: Picture, crop: Crop) => {
    try {
      onChange(renderPicture(picture, crop, CROP_VIEW, CONTACT_PHOTO));
    } finally {
      picture.close();
    }
    setFile(null);
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => chooser.current?.click()}
        onDragOver={dragOver}
        onDragEnter={dragOver}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        aria-label={photo ? t("contacts.picture.change") : t("contacts.picture.choose")}
        className={clsx(
          "group relative grid size-[72px] shrink-0 place-items-center overflow-hidden rounded-full bg-pink-tint text-pink-ink transition-shadow focus-visible:shadow-focus focus-visible:outline-none",
          over && "ring-4 ring-pink",
        )}
      >
        {src ? (
          <img src={src} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-7" aria-hidden />
        )}
        <span
          aria-hidden
          className={clsx(
            "absolute inset-0 grid place-items-center bg-[#1c1420]/45 text-white opacity-0 transition-opacity group-hover:opacity-100",
            over && "opacity-100",
          )}
        >
          <Camera className="size-6" />
        </span>
      </button>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={ImagePlus} onClick={() => chooser.current?.click()}>
            {t("contacts.picture.choose")}
          </Button>
          {touch && (
            <Button size="sm" icon={Camera} onClick={() => camera.current?.click()}>
              {t("contacts.picture.camera")}
            </Button>
          )}
          {domain && (
            <Button size="sm" icon={Building2} busy={logoBusy} onClick={() => void takeLogo()}>
              {t("contacts.picture.logo")}
            </Button>
          )}
          {photo && (
            <Button size="sm" variant="ghost" icon={Trash} onClick={() => onChange(null)}>
              {t("contacts.picture.remove")}
            </Button>
          )}
        </div>
        <p className="text-[12.5px] text-muted">{t("contacts.picture.hint")}</p>
      </div>
      <input
        ref={chooser}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          picked(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(event) => {
          picked(event.target.files);
          event.target.value = "";
        }}
      />
      <PictureCropDialog file={file} onCancel={() => setFile(null)} onCropped={cropped} />
    </div>
  );
}
