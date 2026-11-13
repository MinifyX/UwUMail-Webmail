import { Icon, ICONS } from "@uwusuite/design";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { AddressBookInfo } from "@/backend/types";
import { NyuScene } from "@/components/nyu/scenes";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextInput } from "@/components/ui/Field";
import { ContextMenu } from "@/components/ui/Menu";
import { useT } from "@/i18n";
import { queryKeys } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { startNewContact, useContactsUi } from "./state";
import { useAddressBooks, useContacts } from "./useContactsData";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Beside the contacts: a new contact and the address books. */
export function ContactsSidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <nav className={clsx("flex h-full flex-col gap-4 px-3 pt-3 pb-3", className)} aria-label={t("contacts.title")}>
      <Button
        size="lg"
        icon={ICONS.addContact}
        onClick={() => {
          onNavigate?.();
          startNewContact();
        }}
        className="w-full"
      >
        {t("contacts.newContact")}
      </Button>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        <AddressBookList onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

/** All contacts, then each address book with its count; "…" to rename, make default or delete. */
function AddressBookList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const client = useQueryClient();
  const { data: books = [] } = useAddressBooks();
  const { data: contacts = [] } = useContacts();
  const bookId = useContactsUi((s) => s.bookId);
  const setBook = useContactsUi((s) => s.setBook);
  const [menu, setMenu] = useState<{ book: AddressBookInfo; at: { x: number; y: number } } | null>(null);
  const [editing, setEditing] = useState<AddressBookInfo | "new" | null>(null);
  const [deleting, setDeleting] = useState<AddressBookInfo | null>(null);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) toast(success, "success");
      return true;
    } catch (error) {
      toast(t("contacts.toast.failed", { reason: reason(error) }), "error");
      return false;
    } finally {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.addressBooks }),
        client.invalidateQueries({ queryKey: queryKeys.contacts }),
      ]);
    }
  };
  const count = (id: string | null) => contacts.filter((contact) => !id || contact.addressBookId === id).length;
  const pick = (id: string | null) => {
    setBook(id);
    onNavigate?.();
  };
  const entry = (id: string | null, name: string, icon: LucideIcon, book?: AddressBookInfo) => {
    const Glyph = icon;
    return (
      <li
        key={id ?? "all"}
        className={clsx(
          "group relative flex h-9 items-center gap-2 rounded-xl pr-1 pl-3",
          bookId === id ? "bg-pink-tint text-pink-ink" : "hover:bg-pink-tint/50",
        )}
        onContextMenu={
          book
            ? (event) => {
                event.preventDefault();
                setMenu({ book, at: { x: event.clientX, y: event.clientY } });
              }
            : undefined
        }
      >
        <button
          type="button"
          aria-current={bookId === id ? "page" : undefined}
          onClick={() => pick(id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left text-body"
        >
          <Icon icon={Glyph} size="md" className="shrink-0 opacity-80" />
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          {book?.isDefault && books.length > 1 && (
            <span className="shrink-0 text-muted" title={t("contacts.default")}>
              <Icon icon={ICONS.favorite} size="xs" />
              <span className="sr-only">{t("contacts.default")}</span>
            </span>
          )}
          <span className="shrink-0 text-caption text-muted tabular-nums">{count(id)}</span>
        </button>
        {book && (
          <IconButton
            icon={ICONS.more}
            size="sm"
            label={t("contacts.bookActions", { name: book.name })}
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ book, at: { x: rect.left, y: rect.bottom + 4 } });
            }}
            className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          />
        )}
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-0.5" aria-labelledby="uwu-address-books">
      <ul className="flex flex-col gap-0.5">{entry(null, t("contacts.all"), ICONS.contacts)}</ul>
      <div className="flex items-center justify-between pt-3 pr-1 pl-3">
        <h2 id="uwu-address-books" className="text-caption font-bold tracking-wide text-muted uppercase">
          {t("contacts.addressBooks")}
        </h2>
        <IconButton icon={ICONS.add} size="sm" label={t("contacts.newBook")} onClick={() => setEditing("new")} />
      </div>
      <ul className="flex flex-col gap-0.5">{books.map((book) => entry(book.id, book.name, ICONS.contacts, book))}</ul>

      <ContextMenu
        at={menu?.at ?? null}
        label={menu ? t("contacts.bookActions", { name: menu.book.name }) : undefined}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                { label: t("contacts.renameBook"), onSelect: () => setEditing(menu.book) },
                ...(!menu.book.isDefault
                  ? [
                      {
                        label: t("contacts.makeDefault"),
                        onSelect: () =>
                          void run(
                            () => backend().setDefaultAddressBook(menu.book.id),
                            t("contacts.toast.defaultSet", { name: menu.book.name }),
                          ),
                      },
                    ]
                  : []),
                ...(menu.book.mayDelete && books.length > 1
                  ? [{ label: t("contacts.deleteBook"), danger: true, onSelect: () => setDeleting(menu.book) }]
                  : []),
              ]
            : []
        }
      />

      <Dialog open={editing !== null} onClose={() => setEditing(null)} width="sm">
        {editing !== null && (
          <BookForm
            key={editing === "new" ? "new" : editing.id}
            book={editing === "new" ? null : editing}
            onDone={async (name) => {
              const ok = await run(
                () =>
                  editing === "new" ? backend().createAddressBook(name) : backend().renameAddressBook(editing.id, name),
                editing === "new" ? t("contacts.toast.bookCreated", { name }) : undefined,
              );
              if (ok) setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} width="sm">
        {deleting && (
          <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-6 text-center">
            <NyuScene name="goodbye" className="w-36" />
            <h2 className="text-section font-extrabold text-balance">
              {t("contacts.deleteBookTitle", { name: deleting.name })}
            </h2>
            <p className="text-meta text-muted">{t("contacts.deleteBookBody", { count: count(deleting.id) })}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button
                variant="danger"
                autoFocus
                onClick={() => {
                  const book = deleting;
                  setDeleting(null);
                  if (bookId === book.id) setBook(null);
                  void run(
                    () => backend().deleteAddressBook(book.id),
                    t("contacts.toast.bookDeleted", { name: book.name }),
                  );
                }}
              >
                {t("contacts.deleteBook")}
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

function BookForm({
  book,
  onDone,
  onCancel,
}: {
  book: AddressBookInfo | null;
  onDone: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(book?.name ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const empty = !name.trim();
  return (
    <form
      className="flex flex-col gap-4 px-6 pt-5 pb-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setTried(true);
        if (empty) return;
        setBusy(true);
        await onDone(name.trim());
        setBusy(false);
      }}
    >
      <h2 className="text-section font-bold">{book ? t("contacts.renameBook") : t("contacts.newBook")}</h2>
      <Field label={t("contacts.bookName")} error={tried && empty ? t("contacts.problem.bookName") : undefined}>
        {(id) => (
          <TextInput id={id} autoFocus value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {book ? t("common.save") : t("contacts.create")}
        </Button>
      </div>
    </form>
  );
}
