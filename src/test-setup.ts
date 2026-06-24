import { afterEach } from "vitest";
import { cleanup } from "@testing-library/preact";

// Unmount any component rendered with @testing-library/preact between tests so
// jsdom state doesn't leak across cases.
afterEach(() => cleanup());
