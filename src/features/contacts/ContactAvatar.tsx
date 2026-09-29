import clsx from "clsx";
import { UsersRound } from "lucide-react";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { ContactRecord } from "@/backend/types";
import { Avatar } from "@/components/ui/Avatar";
import { useSettings } from "@/state/settings";

const SIZES = {
  list: "size-9",
  lg: "size-16",
} as const;

/**
 * Where a contact's picture shows from. A picture inside the card always; a web link only through
 * the server, and only while sender pictures are on (`everywhere`): switched off, the reader was
 * promised only what the server has itself, and a link makes the server ask another one
 * (security-audit W-31).
 */
export function contactPhotoSrc(photo: string | null, everywhere: boolean): string | null {
  if (!photo) return null;
  if (!everywhere && !/^data:image\//i.test(photo.trim())) return null;
  return backend().contactPhotoUrl(photo);
}

/**
 * The contact's own picture when the card has one and it may show (see contactPhotoSrc);
 * otherwise the same avatar as in the mail.
 */
export function ContactAvatar({ contact, size = "list" }: { contact: ContactRecord; size?: keyof typeof SIZES }) {
  const everywhere = useSettings((s) => s.senderPictures);
  const src = contactPhotoSrc(contact.photo, everywhere);
  // A linked photo the server could not fetch falls back to the avatar instead of a broken image.
  const [failed, setFailed] = useState<string | null>(null);
  if (src && src !== failed) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setFailed(src)}
        className={clsx("shrink-0 rounded-full object-cover", SIZES[size])}
      />
    );
  }
  if (contact.isGroup) {
    return (
      <span
        aria-hidden
        className={clsx("grid shrink-0 place-items-center rounded-full bg-pink-tint text-pink-ink", SIZES[size])}
      >
        <UsersRound className={size === "lg" ? "size-7" : "size-4"} />
      </span>
    );
  }
  return (
    <Avatar
      address={{ name: contact.displayName, email: contact.emails[0]?.address ?? contact.displayName }}
      size={size === "lg" ? "lg" : "list"}
      className={size === "lg" ? "!size-16 !text-[20px]" : undefined}
    />
  );
}
