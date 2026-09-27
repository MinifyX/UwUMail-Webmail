/**
 * The webmail's service worker, built on its own into `dist/sw.js` (see vite.config.ts) and served
 * at `/mail/sw.js`, so its scope is the whole webmail. It is only there for Web Push; what it does
 * is in serviceWorker.ts.
 */

import { idbKeyValue } from "@/push/shared";
import { attach, workerEnv, type ServiceWorkerScope } from "./serviceWorker";

const scope = self as unknown as ServiceWorkerScope;
attach(scope, workerEnv(scope, idbKeyValue));
