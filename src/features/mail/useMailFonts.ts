import { useMemo } from "react";
import { mailFontFiles } from "@/lib/fonts";
import { useSettings } from "@/state/settings";
import type { MailFonts } from "./MessageBody";

/** The chosen font for mail frames. */
export function useMailFonts(): MailFonts {
  const font = useSettings((s) => s.font);
  const senderFonts = useSettings((s) => s.senderFonts);
  return useMemo(() => ({ font, senderFonts, ...mailFontFiles(font) }), [font, senderFonts]);
}
