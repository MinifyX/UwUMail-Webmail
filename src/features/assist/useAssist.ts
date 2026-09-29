import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistError, backend, BackendError } from "@/backend/backend";
import type { AssistAnswer, AssistFeature, AssistLabel, AssistStreamHandlers } from "@/backend/types";
import { translate } from "@/i18n";
import { queryKeys } from "@/lib/queries";

/** What the assistant may do for the account; null hides everything about it. */
export function useAssistOptions() {
  return useQuery({ queryKey: queryKeys.assistOptions, queryFn: () => backend().assistOptions(), staleTime: Infinity });
}

/** Whether one feature can be used now. */
export function useAssistFeature(feature: AssistFeature): boolean {
  const { data } = useAssistOptions();
  return data?.features[feature] === true;
}

export function useAssistSettings(enabled = true) {
  const { data: options } = useAssistOptions();
  return useQuery({
    queryKey: queryKeys.assistSettings,
    queryFn: () => backend().assistSettings(),
    enabled: enabled && Boolean(options),
  });
}

export function useAssistProviders(enabled = true) {
  const { data: options } = useAssistOptions();
  return useQuery({
    queryKey: queryKeys.assistProviders,
    queryFn: () => backend().assistProviders(),
    enabled: enabled && Boolean(options),
  });
}

/** The person's labels; only fetched where the server has the assistant. */
export function useAssistLabels() {
  const { data: options } = useAssistOptions();
  return useQuery({
    queryKey: queryKeys.assistLabels,
    queryFn: () => backend().assistLabels(),
    enabled: Boolean(options),
    staleTime: 5 * 60_000,
  });
}

/** Labels by the keyword they put on mail. */
export function useLabelsByKeyword(): Map<string, AssistLabel> {
  const { data: labels = [] } = useAssistLabels();
  return new Map(labels.map((label) => [label.keyword, label]));
}

/** Why the model put labels on a mail, for mail that carries any. */
export function useLabelLog(emailId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.assistLabelLog, emailId],
    queryFn: () => backend().assistLabelLog([emailId], 50),
    enabled,
    staleTime: 60_000,
  });
}

export function useAssistUsage(enabled = true) {
  const { data: options } = useAssistOptions();
  return useQuery({
    queryKey: queryKeys.assistUsage,
    queryFn: () => backend().assistUsage(30),
    enabled: enabled && Boolean(options),
  });
}

/** Whether an error only says that the request was called off. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** What went wrong with the assistant, in the reader's words. */
export function assistErrorText(error: unknown): string {
  if (error instanceof AssistError) {
    switch (error.type) {
      case "assistUnavailable":
        return translate("assist.error.unavailable");
      case "overQuota":
        return translate("assist.error.overQuota");
      case "providerFailed":
        return error.retryAfter
          ? translate("assist.error.busy", { seconds: Math.ceil(error.retryAfter) })
          : translate("assist.error.providerFailed");
      case "notFound":
        return translate("assist.error.notFound");
      case "forbidden":
        return translate("assist.error.forbidden");
      case "invalidArguments":
      case "invalidProperties":
        return error.description
          ? translate("assist.error.invalidWith", { reason: error.description })
          : translate("assist.error.invalid");
    }
  }
  if (error instanceof BackendError) {
    if (error.code === "connection_failed") return translate("assist.error.connection");
    if (error.code === "signed_out") return translate("assist.error.signedOut");
  }
  return translate("assist.error.generic");
}

/** The provider's own words, where they say more than the friendly text: for a "details" line. */
export function assistErrorDetail(error: unknown): string | null {
  return error instanceof AssistError && error.type === "providerFailed" ? error.description : null;
}

export type StreamStatus = "idle" | "working" | "done" | "error";

export interface StreamState {
  status: StreamStatus;
  text: string;
  subject: string | null;
  answer: AssistAnswer | null;
  error: unknown;
}

const IDLE: StreamState = { status: "idle", text: "", subject: null, answer: null, error: null };

/**
 * One answer of the assistant at a time, as it streams in. Starting again or leaving calls the
 * one before off, which closes its request and stops the model.
 */
export function useAssistStream() {
  const [state, setState] = useState<StreamState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async <T extends AssistAnswer>(
      start: (handlers: AssistStreamHandlers) => Promise<T>,
      finalText: (answer: T) => { text: string; subject?: string | null },
    ): Promise<T | null> => {
      controller.current?.abort();
      const own = new AbortController();
      controller.current = own;
      setState({ ...IDLE, status: "working" });
      try {
        const answer = await start({
          signal: own.signal,
          onSubject: (subject) => {
            if (!own.signal.aborted) setState((current) => ({ ...current, subject }));
          },
          onDelta: (text) => {
            if (!own.signal.aborted) setState((current) => ({ ...current, text: current.text + text }));
          },
        });
        if (own.signal.aborted) return null;
        const final = finalText(answer);
        setState({
          status: "done",
          text: final.text,
          subject: final.subject ?? null,
          answer,
          error: null,
        });
        return answer;
      } catch (error) {
        if (own.signal.aborted || isAbort(error)) return null;
        setState((current) => ({ ...current, status: "error", error }));
        return null;
      } finally {
        if (controller.current === own) controller.current = null;
      }
    },
    [],
  );

  /** Calls the answer off; what came so far stays readable. */
  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState((current) => (current.status === "working" ? { ...current, status: "done" } : current));
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(IDLE);
  }, []);

  return { state, run, stop, reset };
}

/** "Mistral (Server) · mistral-small-latest" */
export function providerLabel(answer: { providerName: string; model: string | null } | null | undefined): string {
  if (!answer) return "";
  return answer.model ? `${answer.providerName} · ${answer.model}` : answer.providerName;
}
