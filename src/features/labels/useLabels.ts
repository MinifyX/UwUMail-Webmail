import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { backend } from "@/backend/backend";
import type { AssistLabel, LabelOverlap, ListFilter, MailboxView } from "@/backend/types";
import { translate } from "@/i18n";
import { errorText, queryKeys, useThreads } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { useAssistLabels } from "../assist/useAssist";
import { useSelectionActions } from "../mail/selection";
import { listKeywords, parseLabelSearch } from "./logic";

/** The list's conversations, with the label chips and the `label:` terms of the search applied. */
export function useListThreads(view: MailboxView, filter: ListFilter, search: string) {
  const { data: labels = [] } = useAssistLabels();
  const chips = useUi((s) => s.labelFilter);
  const parsed = parseLabelSearch(search, labels);
  return useThreads(view, filter, parsed.text, listKeywords(chips, parsed));
}

/** Puts a label on conversations or takes it off, every mail in them, with a toast. */
export function useLabelActions() {
  const selection = useSelectionActions();
  const client = useQueryClient();
  const set = async (threadIds: string[], label: AssistLabel, on: boolean) => {
    try {
      const messages = await selection.messagesOf(threadIds);
      if (messages.length === 0) return;
      await backend().setFlags(
        messages.map((message) => message.id),
        { keywords: { [label.keyword]: on } },
      );
      toast(
        translate(on ? "labels.quick.added" : "labels.quick.removed", { name: label.name, count: threadIds.length }),
        "success",
      );
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      for (const key of [queryKeys.threads, queryKeys.thread, queryKeys.folders, queryKeys.assistLabels]) {
        void client.invalidateQueries({ queryKey: key });
      }
    }
  };
  return { set };
}

/** How long typing rests before the overlap check asks the server. */
export const OVERLAP_DELAY = 400;

/**
 * The labels one called `name` with `description` would overlap with (`id` is the label being
 * edited), asked a moment after typing rests. Nothing while it's off or the name is empty; a
 * failed check warns of nothing.
 */
export function useLabelOverlap(name: string, description: string, id: string | undefined, enabled: boolean) {
  const query = enabled && name.trim() ? JSON.stringify([name.trim(), description.trim(), id ?? null]) : null;
  const [result, setResult] = useState<{ query: string; overlaps: LabelOverlap[] } | null>(null);
  useEffect(() => {
    if (!query) return;
    let live = true;
    const [wantedName, wantedDescription, wantedId] = JSON.parse(query) as [string, string, string | null];
    const timer = setTimeout(() => {
      backend()
        .checkLabelOverlap(wantedName, wantedDescription, wantedId ?? undefined)
        .then(
          (overlaps) => live && setResult({ query, overlaps }),
          () => live && setResult({ query, overlaps: [] }),
        );
    }, OVERLAP_DELAY);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  // A result for older text doesn't show once the text changed.
  return query && result?.query === query ? result.overlaps : [];
}
