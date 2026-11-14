// Made-up mail in made-up backups for the demo, on reserved domains only. Restoring hands the mail
// to the demo backend, which puts it into a folder "Restored <date>".

import type { BackupMailContent, BackupQuery, BackupSearchResult } from "./types";

type Lang = "de" | "en";

const DAY = 24 * 60 * 60 * 1000;

/** Nightly backups at 01:30, the newest last night. */
function snapshots(now: number, count: number): string[] {
  const last = new Date(now - DAY);
  last.setHours(1, 30, 0, 0);
  return Array.from({ length: count }, (_, index) =>
    new Date(last.getTime() - (count - 1 - index) * DAY).toISOString(),
  );
}

export function sampleBackupMails(lang: Lang, now = Date.now()): BackupMailContent[] {
  const de = lang === "de";
  const me = { name: "Mini", email: "mini@uwumail.example" };
  const all = snapshots(now, 7);
  const at = (days: number) => new Date(now - days * DAY).toISOString();
  return [
    {
      id: "k17",
      subject: de ? "Deine eSIM ist bereit" : "Your eSIM is ready",
      from: [{ name: "Mobilfunk", email: "esim@mobile.example" }],
      to: [me],
      receivedAt: at(9),
      size: 48211,
      folder: de ? "Posteingang" : "Inbox",
      snapshots: all.slice(0, 5),
      inMailbox: false,
      text: de
        ? "Hallo Mini,\n\ndeine eSIM ist bereit. Scanne den QR-Code im Anhang mit deinem Telefon.\n\nAktivierungscode: LPA:1$smdp.mobile.example$DEMO-0000\n\nViele Grüße\nDein Mobilfunk-Team"
        : "Hi Mini,\n\nyour eSIM is ready. Scan the QR code attached with your phone.\n\nActivation code: LPA:1$smdp.mobile.example$DEMO-0000\n\nBest regards\nYour mobile team",
      attachments: [{ name: "esim-qr.png", type: "image/png", size: 18342 }],
    },
    {
      id: "k12",
      subject: de ? "Rechnung Oktober" : "October invoice",
      from: [{ name: "Mobilfunk", email: "rechnung@mobile.example" }],
      to: [me],
      receivedAt: at(20),
      size: 91200,
      folder: de ? "Rechnungen" : "Invoices",
      snapshots: all,
      inMailbox: true,
      text: de ? "Deine Rechnung für Oktober liegt bei." : "Your invoice for October is attached.",
      attachments: [{ name: "rechnung-10.pdf", type: "application/pdf", size: 84210 }],
    },
    {
      id: "k9",
      subject: de ? "Fotos vom Ausflug" : "Photos from the trip",
      from: [{ name: "Lea", email: "lea@example.org" }],
      to: [me],
      receivedAt: at(26),
      size: 3_400_000,
      folder: de ? "Papierkorb" : "Trash",
      snapshots: all.slice(0, 2),
      inMailbox: false,
      text: de ? "Hier sind die Fotos von Samstag!" : "Here are the photos from Saturday!",
      attachments: [
        { name: "see.jpg", type: "image/jpeg", size: 1_700_000 },
        { name: "berg.jpg", type: "image/jpeg", size: 1_650_000 },
      ],
    },
  ];
}

/** The demo's backups are read bit by bit, so the hint about older ones shows for a while. */
export function searchDemoBackups(
  mails: BackupMailContent[],
  query: BackupQuery,
  indexing: BackupSearchResult["indexing"],
): BackupSearchResult {
  const text = query.text?.trim().toLowerCase() ?? "";
  const list = mails
    .filter((mail) => {
      const haystack = [mail.subject, ...[...mail.from, ...mail.to].flatMap((a) => [a.name ?? "", a.email])]
        .join(" ")
        .toLowerCase();
      if (text && !haystack.includes(text)) return false;
      if (query.after && mail.receivedAt < query.after) return false;
      if (query.before && mail.receivedAt >= query.before) return false;
      return true;
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map(({ text: _text, attachments: _attachments, ...mail }) => ({ ...mail }));
  return { list, indexing };
}
