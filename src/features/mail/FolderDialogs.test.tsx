import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder } from "@/backend/types";
import { i18n } from "@/i18n";
import { openFolderDialog, useFolderDialog } from "@/state/folderDialog";
import { useSettings } from "@/state/settings";
import { useToasts } from "@/state/toasts";
import { FolderDialogs } from "./FolderDialogs";

const folder = (patch: Partial<Folder>): Folder => ({
  id: "f",
  accountId: "acc",
  name: "Folder",
  path: "Folder",
  role: null,
  parentId: null,
  selectable: true,
  unread: 0,
  total: 0,
  ...patch,
});

const FOLDERS = [
  folder({ id: "inbox", name: "Inbox", role: "inbox" }),
  folder({ id: "trash", name: "Trash", role: "trash", total: 4 }),
  folder({ id: "clients", name: "Clients" }),
];

const fake = {
  listFolders: vi.fn(async () => FOLDERS),
  listThreads: vi.fn(async () => ({ threads: [] })),
  createFolder: vi.fn(async () => "new"),
  emptyFolder: vi.fn(async () => 4),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderDialogs() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FolderDialogs />
    </QueryClientProvider>,
  );
}

describe("folder dialogs", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    act(() => useFolderDialog.setState({ dialog: null }));
  });

  it("creates a top-level folder once the name works", async () => {
    renderDialogs();
    act(() => openFolderDialog({ kind: "create", accountId: "acc", parent: null }));
    const input = await screen.findByLabelText("Name");

    fireEvent.change(input, { target: { value: "clients" } });
    expect((await screen.findByRole("alert")).textContent).toBe("There's already a folder with that name here.");
    fireEvent.change(input, { target: { value: "Work/Boss" } });
    expect(screen.getByRole("alert").textContent).toBe("A folder name can't contain “/”.");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(fake.createFolder).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  Receipts " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(fake.createFolder).toHaveBeenCalledWith({ accountId: "acc", name: "Receipts", parentId: null }),
    );
    await waitFor(() => expect(useFolderDialog.getState().dialog).toBeNull());
  });

  it("asks with the count before it empties the trash and reports what went", async () => {
    renderDialogs();
    act(() => openFolderDialog({ kind: "empty", folder: FOLDERS[1]! }));
    expect(await screen.findByText("Empty the trash?")).toBeTruthy();
    expect(screen.getByText("4 messages will be deleted forever. This can't be undone.")).toBeTruthy();
    expect(fake.emptyFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    await waitFor(() => expect(fake.emptyFolder).toHaveBeenCalledWith("trash"));
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((toast) => toast.message)).toContain("4 messages deleted forever"),
    );
  });

  it("empties nothing when the question is cancelled", async () => {
    renderDialogs();
    act(() => openFolderDialog({ kind: "empty", folder: FOLDERS[1]! }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(useFolderDialog.getState().dialog).toBeNull();
    expect(fake.emptyFolder).not.toHaveBeenCalled();
  });
});
