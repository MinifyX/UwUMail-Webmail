import "@/test/dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("stays open on a click beside it and closes with its X", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Settings">
        <p>Body</p>
      </Dialog>,
    );
    // A click on the backdrop lands on the <dialog> element itself.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
