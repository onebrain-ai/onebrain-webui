// WebUI entry. Resolves the daemon token, builds the data client, and starts the
// Command Center engine. Panel plugins self-register via the `./panels` import.

import "./ds/tokens.css";
import "./ds/base.css";
import "./shells/command-center/widget.css";

import { resolveToken } from "./core/token";
import { HttpDaemonClient } from "./core/daemon";
import { startCommandCenter } from "./shells/command-center/engine";
import "./panels"; // side-effect: registers every panel plugin

const daemon = new HttpDaemonClient(resolveToken());
startCommandCenter({ daemon });
