import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { backend, BackendError } from "@/backend/backend";
import type { ShipmentInput, ShipmentPatch, ShipmentStatus } from "@/backend/types";
import { markNow } from "@/lib/shipments";
import { translate } from "@/i18n";
import { queryKeys } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";

/** What the session says about parcels; asked anew whenever the session changes. */
export function useShipmentsSupport() {
  return useQuery({
    queryKey: queryKeys.shipmentsAvailable,
    queryFn: () => backend().shipmentsSupport(),
    staleTime: Infinity,
  });
}

/** Whether parcels are on for the account; while false, nothing about parcels shows or is asked for. */
export function useShipmentsAvailable() {
  const { data } = useShipmentsSupport();
  return { data: data?.enabled };
}

export function useShipments() {
  const { data: available = false } = useShipmentsAvailable();
  return useQuery({ queryKey: queryKeys.shipments, queryFn: () => backend().shipments(), enabled: available });
}

export function useHiddenShipments() {
  const { data: available = false } = useShipmentsAvailable();
  return useQuery({
    queryKey: queryKeys.hiddenShipments,
    queryFn: () => backend().shipments(true),
    enabled: available,
  });
}

/** The card the mail's parcel chip leads to; the view scrolls to it and focuses it once. */
export const useShipmentFocus = create<{ id: string | null; set: (id: string | null) => void }>()((set) => ({
  id: null,
  set: (id) => set({ id }),
}));

/** Switches parcels on or off for the account; off drops the parcels kept here at once. */
export async function setShipmentsEnabled(client: QueryClient, on: boolean): Promise<boolean> {
  try {
    await backend().setShipmentsEnabled(on);
  } catch (error) {
    toast(shipmentErrorText(error), "error");
    return false;
  }
  if (!on) client.removeQueries({ queryKey: queryKeys.shipments });
  await client.invalidateQueries({ queryKey: queryKeys.shipmentsAvailable });
  return true;
}

export function showShipment(id: string) {
  useShipmentFocus.getState().set(id);
  useUi.getState().setSection("shipments");
}

/** What went wrong, in the reader's language. */
export function shipmentErrorText(error: unknown): string {
  const code = error instanceof BackendError ? error.code : "internal";
  if (code === "invalid_input") return translate("shipments.error.invalid");
  if (code === "not_found") return translate("shipments.error.notFound");
  if (code === "connection_failed") return translate("shipments.error.connection");
  return translate("shipments.error.generic");
}

/** Adding, renaming, hiding and deleting, with the toasts and the refresh after each. */
export function useShipmentActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.shipments });
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work();
      await refresh();
      return true;
    } catch (error) {
      toast(shipmentErrorText(error), "error");
      return false;
    }
  };
  const update = (id: string, patch: ShipmentPatch) => run(() => backend().updateShipment(id, patch));
  return {
    add: (input: ShipmentInput) => run(() => backend().createShipment(input)),
    rename: (id: string, title: string | null) => update(id, { title }),
    hide: async (id: string) => {
      if (!(await update(id, { hidden: true }))) return;
      toast(translate("shipments.toast.hidden"), "success", undefined, {
        action: { label: translate("shipments.undo"), run: () => void update(id, { hidden: false }) },
      });
    },
    unhide: (id: string) => update(id, { hidden: false }),
    mark: async (id: string, status: ShipmentStatus) => {
      const event = { at: markNow(), status };
      if (!(await update(id, { addEvents: [event] }))) return;
      const name = translate(`shipments.status.${status}`);
      toast(translate("shipments.toast.marked", { status: name }), "success", undefined, {
        action: { label: translate("shipments.undo"), run: () => void update(id, { removeEvents: [event] }) },
      });
    },
    /** Asks the carrier now; says so when it won't, then shows what came back. */
    lookUp: async (id: string) => {
      try {
        const why = await backend().refreshShipment(id);
        await refresh();
        toast(translate(why ? `shipments.lookup.not.${why}` : "shipments.lookup.done"), why ? "info" : "success");
      } catch (error) {
        toast(shipmentErrorText(error), "error");
      }
    },
    remove: async (id: string) => {
      if (await run(() => backend().deleteShipment(id))) toast(translate("shipments.toast.deleted"), "success");
    },
  };
}
