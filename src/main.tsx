import "@fontsource-variable/rubik";
import "@fontsource-variable/dm-sans";
import "./styles/app.css";
import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyUiFont } from "./lib/fonts";
import { useSettings } from "./state/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// The chosen font before the first paint.
applyUiFont(useSettings.getState().font);
useSettings.subscribe((state, previous) => {
  if (state.font !== previous.font) applyUiFont(state.font);
});

// The backend is loaded inside App, because it needs the session first.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
