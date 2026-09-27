import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { handleWorkerMessage } from "./index";
import { MESSAGE_OPEN } from "./shared";

describe("messages from the service worker", () => {
  beforeEach(() => {
    useUi.setState({ section: "calendar", view: { kind: "unified", role: "sent" }, selectedThreadId: null });
  });

  it("opens the message a notification was clicked for, in the inbox", async () => {
    useSettings.setState({ conversations: true });
    useUi.getState().openSettings("mail");
    handleWorkerMessage({ type: MESSAGE_OPEN, emailId: "e1", threadId: "t1" });
    await vi.waitFor(() => expect(useUi.getState().selectedThreadId).toBe("t1"));
    expect(useUi.getState()).toMatchObject({
      section: "mail",
      view: { kind: "unified", role: "inbox" },
      settingsOpen: null,
    });
  });

  it("opens the single message when conversations are off", async () => {
    useSettings.setState({ conversations: false });
    handleWorkerMessage({ type: MESSAGE_OPEN, emailId: "e1", threadId: "t1" });
    await vi.waitFor(() => expect(useUi.getState().selectedThreadId).toBe("msg:e1"));
  });

  it("ignores anything else", () => {
    for (const junk of [null, "text", { type: MESSAGE_OPEN, emailId: 5, threadId: "t1" }, { type: "other" }]) {
      handleWorkerMessage(junk);
    }
    expect(useUi.getState().selectedThreadId).toBeNull();
  });
});
