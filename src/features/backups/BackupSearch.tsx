import { Button, Dialog, Field, Hint, IconButton, ICONS, Tag, TextInput } from "@uwusuite/design";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { backend } from "@/backend/backend";
import type { BackupMail, BackupQuery, BackupRestoreProblem, BackupRestoreResult, Folder } from "@/backend/types";
import { useT } from "@/i18n";
import { formatAddress, formatFullDate, formatSize } from "@/lib/format";
import { errorText, queryKeys } from "@/lib/queries";

/** Whether the server lets the person search their own mail in its backups. */
export function useBackupsAvailable() {
  return useQuery({ queryKey: queryKeys.backupsAvailable, queryFn: () => backend().backupsAvailable() });
}

/** Only in the own account's trash, where people look for deleted mail. */
export function backupsHere(folder: Folder | undefined): boolean {
  return folder?.role === "trash" && !folder.shared;
}

/**
 * "Search the backups" for the trash: a button that opens the search. `icon` for the narrow
 * header on phones.
 */
export function BackupSearchButton({ icon = false }: { icon?: boolean }) {
  const { t } = useT();
  const { data: available } = useBackupsAvailable();
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      {icon ? (
        <IconButton icon={ICONS.backup} label={t("backups.open")} onClick={() => setOpen(true)} />
      ) : (
        <Button size="sm" variant="ghost" icon={ICONS.backup} onClick={() => setOpen(true)}>
          {t("backups.open")}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t("backups.title")} width="lg">
        {open && <BackupSearch />}
      </Dialog>
    </>
  );
}

/** A day from the date field as the start of that day here, as a UTCDate. */
function startOfDay(day: string, plusDays = 0): string {
  const date = new Date(`${day}T00:00`);
  date.setDate(date.getDate() + plusDays);
  return date.toISOString();
}

type Outcome = "restored" | "alreadyThere" | BackupRestoreProblem;

function outcomes(result: BackupRestoreResult): Map<string, Outcome> {
  const map = new Map<string, Outcome>();
  for (const id of Object.keys(result.restored)) map.set(id, "restored");
  for (const id of result.alreadyThere) map.set(id, "alreadyThere");
  for (const [id, problem] of Object.entries(result.notRestored)) map.set(id, problem);
  return map;
}

function BackupSearch() {
  const { t, i18n } = useT();
  const client = useQueryClient();
  const ids = useId();
  const [text, setText] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [query, setQuery] = useState<BackupQuery | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<BackupRestoreResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ["backupSearch", query],
    queryFn: () => backend().searchBackups(query!),
    enabled: query !== null,
  });
  const list = search.data?.list ?? [];
  const indexing = search.data?.indexing;
  const done = result ? outcomes(result) : new Map<string, Outcome>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked([]);
    setPreview(null);
    setResult(null);
    setFailed(null);
    setQuery({
      text: text.trim() || undefined,
      after: after ? startOfDay(after) : undefined,
      // "Up to" includes that day.
      before: before ? startOfDay(before, 1) : undefined,
    });
  };

  const restore = async () => {
    setRestoring(true);
    setFailed(null);
    try {
      setResult(await backend().restoreFromBackups(checked));
      setChecked([]);
      // The new folder shows up in the folder list, and the hits say they're in the mailbox now.
      void client.invalidateQueries({ queryKey: queryKeys.folders });
      void search.refetch();
    } catch (error) {
      setFailed(errorText(error));
    } finally {
      setRestoring(false);
    }
  };

  const toggle = (id: string, on: boolean) =>
    setChecked((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));

  const status = search.isFetching
    ? ""
    : search.isError
      ? errorText(search.error)
      : search.data
        ? t("backups.found", { count: list.length })
        : "";

  return (
    <div className="flex flex-col gap-4 px-6 pt-1 pb-6">
      <p className="text-body text-muted">{t("backups.intro")}</p>
      <search>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t("backups.text")} hint={t("backups.textHint")}>
            {(id) => (
              <TextInput
                id={id}
                type="search"
                value={text}
                maxLength={256}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("backups.after")} className="min-w-40 flex-1">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={after}
                  max={before || undefined}
                  onChange={(event) => setAfter(event.target.value)}
                />
              )}
            </Field>
            <Field label={t("backups.before")} className="min-w-40 flex-1">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={before}
                  min={after || undefined}
                  onChange={(event) => setBefore(event.target.value)}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" icon={ICONS.search} busy={search.isFetching}>
              {t("backups.search")}
            </Button>
          </div>
        </form>
      </search>

      <p role="status" className="text-meta font-semibold empty:hidden">
        {status}
      </p>
      {indexing && indexing.done < indexing.total && (
        <Hint tone="info">{t("backups.indexing", { done: indexing.done, total: indexing.total })}</Hint>
      )}
      {result && <RestoreSummary result={result} />}
      {failed && (
        <Hint tone="danger" role="alert">
          {t("backups.restoreFailed", { reason: failed })}
        </Hint>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={t("backups.hits")}>
          {list.map((mail) => (
            <Hit
              key={mail.id}
              mail={mail}
              checked={checked.includes(mail.id)}
              onCheck={(on) => toggle(mail.id, on)}
              outcome={done.get(mail.id)}
              open={preview === mail.id}
              onPreview={() => setPreview(preview === mail.id ? null : mail.id)}
              previewId={`${ids}-preview-${mail.id}`}
              locale={i18n.language}
            />
          ))}
        </ul>
      )}

      {list.some((mail) => !mail.inMailbox) && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-hairline pt-4">
          <p className="text-meta text-muted">{t("backups.whereTo")}</p>
          <Button
            variant="primary"
            icon={ICONS.restore}
            disabled={checked.length === 0}
            busy={restoring}
            onClick={() => void restore()}
          >
            {checked.length > 0 ? t("backups.restoreCount", { count: checked.length }) : t("backups.restore")}
          </Button>
        </div>
      )}
    </div>
  );
}

const OUTCOME_KEYS: Record<Outcome, string> = {
  restored: "backups.outcome.restored",
  alreadyThere: "backups.inMailbox",
  notFound: "backups.outcome.notFound",
  overQuota: "backups.outcome.overQuota",
  invalidEmail: "backups.outcome.invalidEmail",
  other: "backups.outcome.other",
};

function Hit({
  mail,
  checked,
  onCheck,
  outcome,
  open,
  onPreview,
  previewId,
  locale,
}: {
  mail: BackupMail;
  checked: boolean;
  onCheck: (on: boolean) => void;
  outcome: Outcome | undefined;
  open: boolean;
  onPreview: () => void;
  previewId: string;
  locale: string;
}) {
  const { t } = useT();
  const subject = mail.subject || t("backups.noSubject");
  const from = mail.from.map(formatAddress).join(", ");
  const dates = mail.snapshots.map((at) => new Date(at).toLocaleDateString(locale)).join(", ");
  const shown = outcome ?? (mail.inMailbox ? "alreadyThere" : undefined);
  const problem = outcome !== undefined && outcome !== "restored" && outcome !== "alreadyThere";
  return (
    <li className="rounded-2xl border border-line px-3.5 py-2.5">
      <div className="flex items-start gap-3">
        {/* Mail the account has already isn't stored twice, so there is nothing to tick. */}
        <input
          type="checkbox"
          checked={checked}
          disabled={mail.inMailbox}
          onChange={(event) => onCheck(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-pink disabled:opacity-40"
          aria-label={t("backups.choose", { subject })}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{subject}</p>
          <p className="text-meta break-words text-muted">
            {from} · {formatFullDate(mail.receivedAt, locale)} · {t("backups.folder", { folder: mail.folder })}
          </p>
          <p className="text-caption text-muted">{t("backups.snapshots", { dates })}</p>
          {shown && (
            <Tag tone={problem ? "danger" : "success"} className="mt-1">
              {t(OUTCOME_KEYS[shown])}
            </Tag>
          )}
        </div>
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={previewId} onClick={onPreview}>
          {open ? t("backups.hide") : t("backups.preview")}
        </Button>
      </div>
      {open && <Preview id={previewId} mailId={mail.id} locale={locale} />}
    </li>
  );
}

function Preview({ id, mailId, locale }: { id: string; mailId: string; locale: string }) {
  const { t } = useT();
  const content = useQuery({
    queryKey: ["backupMail", mailId],
    queryFn: async () => (await backend().backupMails([mailId]))[0] ?? null,
  });
  return (
    <div id={id} className="mt-3 border-t border-hairline pt-3">
      {content.isPending ? (
        <p className="text-meta text-muted">{t("backups.reading")}</p>
      ) : content.isError ? (
        <p className="text-meta text-danger">{errorText(content.error)}</p>
      ) : !content.data ? (
        <p className="text-meta text-muted">{t("backups.outcome.notFound")}</p>
      ) : (
        <>
          {/* Plain text only: mail from the backups is never shown as HTML. */}
          <pre className="max-h-80 overflow-auto font-sans text-body break-words whitespace-pre-wrap">
            {content.data.text || t("backups.noText")}
          </pre>
          {content.data.attachments.length > 0 && (
            <>
              <p className="mt-3 text-caption font-bold tracking-wide text-muted uppercase">
                {t("backups.attachments")}
              </p>
              <ul className="text-meta">
                {content.data.attachments.map((file, index) => (
                  <li key={index} className="break-words">
                    {file.name || t("backups.unnamed")} · {file.type} · {formatSize(file.size, locale)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RestoreSummary({ result }: { result: BackupRestoreResult }) {
  const { t } = useT();
  const restored = Object.keys(result.restored).length;
  const problems = Object.values(result.notRestored);
  const count = (problem: BackupRestoreProblem) => problems.filter((entry) => entry === problem).length;
  const lines = [
    restored > 0 && t("backups.summary.restored", { count: restored }),
    result.alreadyThere.length > 0 && t("backups.summary.alreadyThere", { count: result.alreadyThere.length }),
    ...(["notFound", "overQuota", "invalidEmail", "other"] as const).map(
      (problem) => count(problem) > 0 && t(`backups.summary.${problem}`, { count: count(problem) }),
    ),
  ].filter((line): line is string => Boolean(line));
  return (
    <Hint tone={problems.length > 0 ? "warning" : "success"} role="status">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </Hint>
  );
}
