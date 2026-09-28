import { useQuery } from "@tanstack/react-query";
import { backend, BackendError } from "@/backend/backend";
import { translate } from "@/i18n";
import { queryKeys } from "@/lib/queries";

/** Whether the server makes masked addresses for the account, and where; null hides the section. */
export function useMaskedOptions() {
  return useQuery({ queryKey: queryKeys.maskedOptions, queryFn: () => backend().maskedOptions() });
}

export function useMaskedAddresses() {
  return useQuery({ queryKey: queryKeys.maskedAddresses, queryFn: () => backend().maskedAddresses() });
}

/** What went wrong, in the reader's language: the server's own words are for administrators. */
export function maskedErrorText(error: unknown): string {
  const code = error instanceof BackendError ? error.code : "internal";
  switch (code) {
    case "forbidden":
      return translate("masked.error.forbidden");
    case "invalid_input":
      return translate("masked.error.invalid");
    case "not_found":
      return translate("masked.error.notFound");
    case "connection_failed":
      return translate("masked.error.connection");
    case "signed_out":
      return translate("masked.error.signedOut");
    default:
      return translate("masked.error.generic");
  }
}
