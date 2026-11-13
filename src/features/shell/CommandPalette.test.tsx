import "@/test/dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUi } from "@/state/ui";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  afterEach(cleanup);

  it("closes on a click beside it", () => {
    useUi.getState().setPaletteOpen(true);
    render(<CommandPalette commands={[]} />);
    // A click on the backdrop lands on the <dialog> element itself.
    fireEvent.click(screen.getByRole("dialog"));
    expect(useUi.getState().paletteOpen).toBe(false);
  });
});
