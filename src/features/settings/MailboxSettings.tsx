import { ArrowDown, ArrowUp } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { accountAddress, hiddenFromUnified, orderAccounts } from "@/lib/arrangement";
import { useAccounts, useMailboxes, useSharedAccounts } from "@/lib/queries";
import { moveMailbox, setHiddenFromUnified } from "@/state/arrangement";
import { useSettings } from "@/state/settings";
import { Row } from "./Row";

/**
 * Settings → Mail: the order of the mailboxes in the sidebar (the own one and those others share
 * folders from), whether the own one counts under "All mailboxes", and whether hidden folders
 * show. All of it follows the account to the app.
 */
export function MailboxSettings() {
  const { t } = useT();
  const { mailboxes } = useMailboxes();
  const { data: accounts = [] } = useAccounts();
  const { data: shared = [] } = useSharedAccounts();
  const order = useSettings((s) => s.accountsOrder);
  const unifiedHidden = useSettings((s) => s.unifiedHidden);
  const showHiddenFolders = useSettings((s) => s.showHiddenFolders);
  const hasHiddenFolders = useSettings((s) => s.hiddenFolders.length > 0);
  const update = useSettings((s) => s.update);

  const ordered = orderAccounts(mailboxes, order);
  // Several entries with one address move together, as in the sidebar.
  const addresses = [...new Set(ordered.map(accountAddress))];
  const own = new Set(accounts.map((account) => account.id));
  const nameOf = (id: string) => shared.find((owner) => owner.id === id)?.name;

  return (
    <>
      {ordered.length > 1 && (
        <Row label={t("settings.mailboxes")} description={t("settings.mailboxesDesc")}>
          <ul className="flex flex-col gap-2">
            {ordered.map((mailbox) => {
              const address = accountAddress(mailbox);
              const index = addresses.indexOf(address);
              const name = nameOf(mailbox.id);
              return (
                <li key={mailbox.id} className="flex flex-col gap-2.5 rounded-2xl border border-hairline px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="selectable block truncate text-[13.5px] font-semibold">
                        {name ?? mailbox.email}
                      </span>
                      {name && name !== mailbox.email && (
                        <span className="selectable block truncate text-[12px] text-muted">{mailbox.email}</span>
                      )}
                    </span>
                    <IconButton
                      icon={ArrowUp}
                      size="sm"
                      label={t("settings.accountUp", { email: name ?? mailbox.email })}
                      disabled={index <= 0}
                      onClick={() => moveMailbox(mailboxes, index, index - 1)}
                    />
                    <IconButton
                      icon={ArrowDown}
                      size="sm"
                      label={t("settings.accountDown", { email: name ?? mailbox.email })}
                      disabled={index >= addresses.length - 1}
                      onClick={() => moveMailbox(mailboxes, index, index + 1)}
                    />
                  </div>
                  {/* The unified views gather the own mailbox only; shared folders stay apart. */}
                  {own.has(mailbox.id) && (
                    <div className="border-t border-hairline pt-2.5">
                      <Toggle
                        checked={!hiddenFromUnified(mailbox, unifiedHidden)}
                        onChange={(on) => setHiddenFromUnified(mailbox, !on)}
                        label={t("settings.inUnified")}
                        description={t("settings.inUnifiedDesc")}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Row>
      )}
      {hasHiddenFolders && (
        <div className="border-b border-hairline py-4 last:border-0">
          <Toggle
            checked={showHiddenFolders}
            onChange={(on) => update({ showHiddenFolders: on })}
            label={t("settings.showHiddenFolders")}
            description={t("settings.showHiddenFoldersDesc")}
          />
        </div>
      )}
    </>
  );
}
