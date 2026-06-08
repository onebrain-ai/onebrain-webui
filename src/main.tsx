// WebUI entry. Resolves the token, builds the data client, applies theme, and
// hands off to ModeRouter (CMS by default; 3D command center when chosen).
import "./ds/tokens.css";
import "./ds/base.css";
import "./shells/command-center/widget.css";

import { render } from "preact";
import { resolveToken } from "./core/token";
import { HttpDaemonClient } from "./core/daemon";
import { applyThemeSettings } from "./core/stores";
import { ModeRouter } from "./shells/ModeRouter";
import "./panels"; // side-effect: registers every panel plugin

const daemon = new HttpDaemonClient(resolveToken());
applyThemeSettings();

const app = document.getElementById("app");
if (app) render(<ModeRouter daemon={daemon} />, app);
