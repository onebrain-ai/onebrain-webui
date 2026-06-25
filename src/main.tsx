// WebUI entry. Resolves the token, builds the data client, applies theme, and
// hands off to ModeRouter (CMS by default; 3D command center when chosen).
import "./ds/fonts.css"; // self-hosted fonts (offline) — must load before the DS tokens that reference them
import "./ds/tokens.css";
import "./ds/base.css";
import "./ui/callout.css";
import "./shells/command-center/widget.css";

import { render } from "preact";
import { resolveToken } from "./core/token";
import { HttpDaemonClient } from "./core/daemon";
import { applyThemeSettings, mode } from "./core/stores";
import { ModeRouter } from "./shells/ModeRouter";
import "./panels"; // side-effect: registers every panel plugin

const daemon = new HttpDaemonClient(resolveToken());
applyThemeSettings();
// Mark the active surface on <html> so CSS can gate the command-center layer
// stack (hardcoded in index.html) off in CMS mode — otherwise those fixed,
// full-viewport layers paint over the 2D shell. See ds/base.css "Mode gate".
document.documentElement.setAttribute("data-mode", mode.value);

const app = document.getElementById("app");
if (app) render(<ModeRouter daemon={daemon} />, app);
