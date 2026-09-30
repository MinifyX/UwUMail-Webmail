import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { backend } from "@/backend/backend";
import type { ThreadDetail } from "@/backend/types";
import { playFirstNyu } from "@/components/nyu/cameo";
import { useNyuLevel } from "@/components/nyu/level";
import { openCameos } from "@/components/nyu/occasions";
import { useAccounts, queryKeys } from "@/lib/queries";
import { useContactsAvailable } from "../contacts/useContactsData";

/**
 * Nyu greets a mail once it has opened: with a party hat on the sender's birthday, hearts for new
 * mail from a contact, a camera for photos, a nightcap late at night, or else it peeks and reads
 * along (see components/nyu/occasions). Once per conversation, when it has finished loading.
 */
export function useNyuOnOpen(detail: ThreadDetail | undefined): void {
  const level = useNyuLevel();
  const { data: accounts = [] } = useAccounts();
  const { data: contactsAvailable = false } = useContactsAvailable();
  // The address book only matters while Nyu may show something; shared with the contacts view.
  const { data: contacts = [] } = useQuery({
    queryKey: queryKeys.contacts,
    queryFn: () => backend().contacts(),
    enabled: contactsAvailable && level !== "off",
    staleTime: 10 * 60_000,
  });
  const threadId = detail?.thread.id;

  useEffect(() => {
    if (!detail || level === "off") return;
    const own = new Set(accounts.map((account) => account.email.toLowerCase()));
    const { messages } = detail;
    const latest = messages.findLast((message) => !own.has(message.from.email.toLowerCase())) ?? messages.at(-1);
    if (!latest) return;
    playFirstNyu(
      openCameos(
        {
          from: own.has(latest.from.email.toLowerCase()) ? "" : latest.from.email,
          unread: messages.some((message) => !message.flags.seen),
          attachments: messages.flatMap((message) => message.attachments),
        },
        contacts,
        new Date(),
      ),
    );
    // Once per conversation that finished loading, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
}
