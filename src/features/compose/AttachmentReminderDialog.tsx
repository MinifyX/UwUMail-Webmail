import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";

/** Asked before sending when the text speaks of an attachment and none is there. */
export function AttachmentReminderDialog({
  open,
  onClose,
  onAttach,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onAttach: () => void;
  onSend: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("attachmentReminder.title")} width="sm">
      <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
        <p className="text-[14px]">{t("attachmentReminder.body")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onSend}>
            {t("attachmentReminder.sendAnyway")}
          </Button>
          <Button variant="primary" icon={Paperclip} autoFocus onClick={onAttach}>
            {t("attachmentReminder.attach")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
