// WebUI entry. Resolves the token, builds the data client, applies theme, and
// renders the CMS shell.
import "./ds/fonts.css"; // self-hosted fonts (offline) — must load before the DS tokens that reference them
import "./ds/tokens.css";
import "./ds/base.css";
import "./ds/density.css"; // [data-density="compact"] overrides (toggled in Settings)
import "./ui/callout.css";
import "./ds/widget.css";
import "./ds/effects.css"; // panel-header redesign + button motion + ambient cues — LAST so it wins over widget.css

import { render } from "preact";
import { resolveToken } from "./core/token";
import { HttpDaemonClient } from "./core/daemon";
import { applyThemeSettings } from "./core/stores";
import { CmsShell } from "./shells/cms/CmsShell";
import "./panels"; // side-effect: registers every panel plugin

const daemon = new HttpDaemonClient(resolveToken());
applyThemeSettings();

const app = document.getElementById("app");
if (app) render(<CmsShell daemon={daemon} />, app);
