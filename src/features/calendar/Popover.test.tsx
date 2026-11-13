import "@/test/dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Popover } from "./Popover";

afterEach(cleanup);

it("focuses the marked field, not the close button before it", () => {
  render(
    <Popover anchor={{ left: 0, top: 0, width: 10, height: 10 }} label="New event" onClose={() => {}}>
      <button type="button">Close</button>
      <input aria-label="Title" data-autofocus />
    </Popover>,
  );
  expect(document.activeElement).toBe(screen.getByLabelText("Title"));
});
