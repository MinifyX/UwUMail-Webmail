import "@/test/dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/Toaster";
import { useToasts } from "@/state/toasts";

afterEach(() => {
  cleanup();
  useToasts.setState({ toasts: [] });
});

it("shows the webmail's toasts in the package stack and runs their action", () => {
  const run = vi.fn();
  render(<Toaster />);
  act(() => {
    useToasts.getState().show("Mail sent", "info", "sent", { action: { label: "Undo", run } });
  });
  expect(screen.getByRole("status").textContent).toContain("Mail sent");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(run).toHaveBeenCalledOnce();
  expect(screen.queryByRole("status")).toBeNull();
});

it("holds a toast while hovered and gives it its full time again afterwards", () => {
  vi.useFakeTimers();
  try {
    render(<Toaster />);
    act(() => {
      useToasts.getState().show("Moved", "info", undefined, { duration: 1000 });
    });
    const item = screen.getByRole("status").firstElementChild ?? screen.getByRole("status");
    fireEvent.pointerEnter(item);
    fireEvent.mouseEnter(item);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status").textContent).toContain("Moved");
    fireEvent.pointerLeave(item);
    fireEvent.mouseLeave(item);
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByRole("status").textContent).toContain("Moved");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Moved")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
