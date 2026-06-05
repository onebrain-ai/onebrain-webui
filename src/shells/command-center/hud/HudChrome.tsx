// HUD chrome overlay — topbar + radar + heading tape + workspaces drawer, plus
// the M5c operator chrome: the ⌘K command palette, the Settings popover, the
// add-panel launcher, and the Controls help sheet. The radar + heading <canvas>es
// are drawn each frame by the engine (which queries them by id after this mounts);
// the palette / settings / add-menu / help DOM is wired imperatively by their
// hud/* modules (createCmdK / createSettings / createAddMenu / createHelp).

import { TopBar } from "./TopBar";
import { radarCount, radarHeading } from "./store";
import "./hud.css";
import "./views.css";

const SLIDERS_ICON = (
  <svg viewBox="0 0 24 24">
    <line x1="21" x2="14" y1="4" y2="4" />
    <line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" />
    <line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" />
    <line x1="12" x2="3" y1="20" y2="20" />
    <line x1="14" x2="14" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    <line x1="16" x2="16" y1="18" y2="22" />
  </svg>
);

export function HudChrome() {
  return (
    <>
      <TopBar />
      <div id="radar">
        <div class="r-frame">
          <canvas width="320" height="320" />
        </div>
        <div class="r-cap">
          <span>
            RADAR · <b>{radarCount.value}</b> IN RANGE
          </span>
          <span>{String(radarHeading.value).padStart(3, "0")}°</span>
        </div>
      </div>
      <div id="heading">
        <canvas />
      </div>

      {/* workspaces drawer (telescopes up out of the radar) — populated imperatively by camera/views */}
      <div id="views">
        <div id="view-list" />
      </div>
      <button id="views-handle" type="button" aria-label="Toggle workspaces">
        <svg viewBox="0 0 24 24">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
        <span class="hud-lab">Workspaces</span>
      </button>

      {/* ⌘K command palette — wired by hud/cmdk */}
      <div id="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdk-box" role="document">
          <div class="cmdk-top">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              id="cmdk-input"
              type="text"
              placeholder="Search panels, skills, workspaces, actions…"
              autocomplete="off"
              spellcheck={false}
              aria-label="Command search"
            />
            <span class="cmdk-esc">Esc</span>
          </div>
          <div class="cmdk-list" id="cmdk-list" />
        </div>
      </div>

      {/* Settings popover — wired by hud/settings (#global-acc swatches built in JS) */}
      <div id="settings-pop" role="dialog" aria-label="Settings">
        <div class="set-head">
          <div class="set-title">
            {SLIDERS_ICON}
            Settings
          </div>
          <span class="set-ver">v3.1.6</span>
        </div>

        <div class="set-grp">Display</div>
        <div class="set-toggle">
          <div class="set-toggle-text">
            <div class="set-tg-lab">Fullscreen mode</div>
            <div class="set-tg-sub">
              Hide browser chrome <span class="k">F</span>
            </div>
          </div>
          <button id="fs-switch" class="cyber-switch" role="switch" aria-checked="false" aria-label="Toggle fullscreen mode" type="button">
            <span class="cs-knob" />
          </button>
        </div>
        <div class="set-toggle" style="margin-top:11px">
          <div class="set-toggle-text">
            <div class="set-tg-lab">Ambient motion</div>
            <div class="set-tg-sub">Stars, drift &amp; radar sweep — off saves power</div>
          </div>
          <button id="amb-switch" class="cyber-switch" role="switch" aria-checked="true" aria-label="Toggle ambient motion" type="button">
            <span class="cs-knob" />
          </button>
        </div>
        <div class="set-block" style="margin-top:13px">
          <div class="set-tg-lab">Frame rate cap</div>
          <div class="set-tg-sub">Limit render FPS — saves power on fast displays</div>
          <div class="set-seg" id="fps-seg" role="group" aria-label="Frame rate cap">
            <button class="seg-btn" data-fps="30" type="button">
              30
            </button>
            <button class="seg-btn" data-fps="60" type="button">
              60
            </button>
            <button class="seg-btn" data-fps="120" type="button">
              120
            </button>
            <button class="seg-btn" data-fps="144" type="button">
              144
            </button>
          </div>
        </div>
        <div class="set-grp">Accent · main UI</div>
        <div class="acc-row" id="global-acc" />
        <div class="set-hint">Re-keys radar, views &amp; chrome. New panels inherit this.</div>
      </div>

      {/* add-panel launcher (bottom-left) — menu built by hud/add-panel */}
      <div id="add-panel">
        <div id="add-menu" />
        <button id="add-btn" type="button" aria-label="Add panel">
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span class="hud-lab">Panels</span>
        </button>
      </div>

      {/* Controls help sheet — wired by hud/help (H · the corner button · ⌘K) */}
      <div id="help">
        <div id="help-body">
          <div class="help-head">
            <div class="help-title">
              <svg viewBox="0 0 24 24">
                <rect x="2.5" y="6" width="19" height="12" rx="1.6" />
                <path d="M6 9.6h.01M9 9.6h.01M12 9.6h.01M15 9.6h.01M18 9.6h.01M6 12.6h.01M9 12.6h.01M12 12.6h.01M15 12.6h.01M18 12.6h.01M8.5 15.4h7" />
              </svg>
              Controls
            </div>
            <span class="help-mode">
              <span class="m-explore">Explore</span>
              <span class="m-focus">Focus</span>
            </span>
          </div>

          <div id="hints" class="help-grid">
            <div class="help-grp">Navigate</div>
            <div class="help-keys">
              <span class="kbd">W</span>
              <span class="kbd">S</span>
            </div>
            <div class="help-desc">Move forward / back</div>
            <div class="help-keys">
              <span class="kbd">A</span>
              <span class="kbd">D</span>
            </div>
            <div class="help-desc">Turn left / right</div>
            <div class="help-keys">
              <span class="kbd">Q</span>
              <span class="kbd">E</span>
            </div>
            <div class="help-desc">Strafe left / right</div>
            <div class="help-keys">
              <span class="kbd">Drag</span>
            </div>
            <div class="help-desc">Look around</div>
            <div class="help-keys">
              <span class="kbd">Wheel</span>
            </div>
            <div class="help-desc">Dolly in / out</div>
            <div class="help-keys">
              <span class="kbd">⇧ Shift</span>
            </div>
            <div class="help-desc">Sprint (hold)</div>

            <div class="help-grp">Panels</div>
            <div class="help-keys">
              <span class="kbd">Dbl-click</span>
            </div>
            <div class="help-desc">Focus a panel</div>
            <div class="help-keys">
              <span class="kbd">Drag</span>
              <span class="q">header</span>
            </div>
            <div class="help-desc">Move</div>
            <div class="help-keys">
              <span class="kbd">Drag</span>
              <span class="q">corner</span>
            </div>
            <div class="help-desc">Resize</div>

            <div class="help-grp">Views</div>
            <div class="help-keys">
              <span class="kbd">0</span>
            </div>
            <div class="help-desc">Show all · return</div>
            <div class="help-keys">
              <span class="kbd">1</span>
              <span class="q">–</span>
              <span class="kbd">9</span>
            </div>
            <div class="help-desc">Saved views</div>

            <div class="help-grp">Display</div>
            <div class="help-keys">
              <span class="kbd">F</span>
            </div>
            <div class="help-desc">Fullscreen</div>
            <div class="help-keys">
              <span class="kbd">H</span>
            </div>
            <div class="help-desc">Toggle this sheet</div>
          </div>

          <div id="focus-hint" class="help-grid">
            <div class="help-grp">Focus</div>
            <div class="help-keys">
              <span class="kbd">◀</span>
              <span class="kbd">▶</span>
            </div>
            <div class="help-desc">Switch panel</div>
            <div class="help-keys">
              <span class="kbd">Drag</span>
              <span class="q">corner</span>
            </div>
            <div class="help-desc">Resize frame</div>
            <div class="help-keys">
              <span class="kbd">1</span>
              <span class="q">–</span>
              <span class="kbd">9</span>
            </div>
            <div class="help-desc">Jump to view</div>

            <div class="help-grp">Exit</div>
            <div class="help-keys">
              <span class="kbd">0</span>
              <span class="kbd">Esc</span>
            </div>
            <div class="help-desc">Previous view</div>
            <div class="help-keys">
              <span class="kbd">Click</span>
              <span class="q">outside</span>
            </div>
            <div class="help-desc">Exit focus</div>
          </div>
        </div>
        <button id="help-btn" type="button" aria-label="Toggle shortcuts (H)">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9.2" />
            <path d="M9.5 9.3a2.6 2.6 0 015.02.8c0 1.8-2.62 2.4-2.62 2.4" />
            <path d="M12 16.9h.01" />
          </svg>
          <span class="hud-lab">Help</span>
        </button>
      </div>
    </>
  );
}
