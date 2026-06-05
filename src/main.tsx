// WebUI entry. Resolves the daemon token, builds the data client, and starts the
// Command Center engine. Panel plugins self-register via the `./panels` import.

import "./ds/tokens.css";
import "./ds/base.css";
import "./shells/command-center/widget.css";

import { render } from "preact";
import { resolveToken } from "./core/token";
import { HttpDaemonClient } from "./core/daemon";
import { startCommandCenter } from "./shells/command-center/engine";
import { HudChrome } from "./shells/command-center/hud/HudChrome";
import "./panels"; // side-effect: registers every panel plugin

const daemon = new HttpDaemonClient(resolveToken());

// Mount the HUD chrome into #app FIRST so the engine can find the radar/heading
// <canvas>es it draws to, then start the 3D engine.
const app = document.getElementById("app");
if (app) render(<HudChrome />, app);
startCommandCenter({ daemon });
