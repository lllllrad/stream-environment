# Fixed-resolution overlays, scenes and widgets

## Model and OBS setup

An **overlay** is a transparent canvas at one unique fixed resolution. The defaults are 1920 × 1080 and 1280 × 720. A **scene** is an application situation, initially Live and Away; it is independent of session lifecycle and OBS scenes. A **layout** is the complete ordered widget configuration for one overlay/scene pair. Every pair exists: adding an overlay creates layouts for all scenes; adding a scene clones the chosen scene at every resolution. A **widget instance** has a stable layout-local ID, installed plugin type, visibility, integer pixel rectangle and presentation settings. Higher `zIndex` values cover lower values; equal values use array order, with later widgets in front. The integer range is 0–10000; omitted values default to zero, preserving existing layouts.

These terms align with OBS's fixed Browser Source viewport and its composition vocabulary, while keeping application scenes separate from OBS scene control. See the official [Browser Source guide](https://obsproject.com/kb/browser-source) and [Sources guide](https://obsproject.com/kb/sources-guide). No OBS control integration is required.

The operator UI at `/admin` opens in **Overlay editor**. Choose a resolution and scene, then copy its output URL. Add one OBS Browser Source at `(0, 0)` using the exact overlay width and height. Keep the default transparent-body CSS. Reuse that source in OBS scenes at the same base canvas resolution. Main video or desktop content comes from your other OBS sources; this app supplies the overlay only. Use **Content management** to create sessions and edit wording. Legacy output URLs remain available for existing OBS sources, without preset controls in the operator UI.

| Overlay | Anonymous output URL | OBS source dimensions |
| --- | --- | --- |
| 1080p | `/display/overlay-1920x1080` | 1920 × 1080 |
| 720p | `/display/overlay-1280x720` | 1280 × 720 |

Replace the URL origin with the dashboard computer's address for a remote OBS computer. Outputs need no authentication. The existing `main-full`, `main-side` and `main-lower` outputs remain available with their original renderer and sizes.

## Editing and review

Select a widget directly on the canvas, drag it to move, or drag its bottom-right handle to resize. Arrow keys move it by one pixel, Shift+Arrow by ten. Exact x/y/width/height and z-index inputs also work. Forward/Backward moves the selected widget one step in the effective stack, swapping neighboring layer values and order where necessary. The selection outline stays interactive above the preview without changing broadcast stacking. Rectangles stay inside the canvas. The inspector controls visibility, stacking order, installed widget addition/removal, colors, padding, type size and plugin-specific settings. Hidden widget outlines appear in the editor for selection, but hidden text is absent from public output.

Use **Undo** / **Redo** or `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y` also redoes; macOS uses Command) for layout edits. Each drag or resize is one undo step; inspector input edits are grouped until focus leaves the field. Text and number inputs retain native text undo while focused; use the toolbar to undo the complete field edit. Geometry, z-index, presentation settings, visibility, widget order, addition and removal share up to 100 local history steps. Undo restores selection as well as widget configuration. Saving retains history against the new saved baseline, but undo changes only the draft: review and save again to publish it. Cancel/reload, resolution/scene switching and leaving the editor clear history. Content updates received in the open editor do not clear layout history. Any undo/redo invalidates the previous save review.

Unsaved changes appear in a hypothetical private preview. **Review before saving** compares saved and draft layouts, including visible-text warnings; **Save reviewed layout** persists the complete draft. Preview readiness is checked before review/save. Cancel/reload discards the draft. Resolution/scene switching and creation are disabled while the current layout is dirty. Configuration revision checks reject concurrent changes without partially saving. Read the latest state and reconcile your intended edit after a conflict.

Selecting a scene changes all overlay resolutions together. Session status does not select a scene automatically. Layout/scene changes obey Auto, Hold and Hidden publication modes. Hold retains the last published layout and content until restore; emergency hide clears all output blocks; withdrawals, notice clearing/expiry and session-end current-activity removal still override Hold. Preview remains hypothetical during hold/hidden.

The Away widget displays an operator-authored message and optional detail independently of session activity. Live defaults to a right-side activity column with a bottom notice; Away defaults to a centered status panel. New scenes copy the chosen layout at every size. Overlay count is capped at eight, scenes at sixteen, and instances at thirty-two per layout. Resolution bounds are 640–3840 by 360–2160 pixels. Editing/deleting resolution definitions or deleting scenes is not currently provided.

## Widget presentation and overflow

Presentation settings belong to each widget instance. Plugins declare the extra settings they use, such as detail visibility, list length or Away text.

Background and text colors accept `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA` in both the editor and HTTP API. Alpha is last: `#8BF8` expands to `#88bbff88`, with alpha `136/255` (about 53% opacity). `0` / `00` is fully transparent; `F` / `FF` is fully opaque. Saved colors use lowercase six or eight digits. The RGB picker preserves the current alpha, and an opacity slider changes it separately. Background also accepts `transparent`, with a dedicated transparent-background button. Incomplete or invalid color entries keep the last valid preview and disable layout review/save until corrected, without sending invalid preview requests.

The shared text renderer supports:

| Behavior | Rendering |
| --- | --- |
| `clip` | Keep requested type size; clip outside the widget inner rectangle |
| `ellipsis` | Fit each field to the remaining height and maximum lines, using a measured prefix and ellipsis |
| `shrink` | Reduce the flow type size down to the configured minimum; clip anything still outside |
| `scroll` | Vertically scroll overflowing content, with an initial pause and alternating direction |

Small rectangles, large padding, limited item count, hidden details and overlapping widgets can suppress fields. The editor reports fully visible code points and identifies clipping and overlaps. Preview comparisons use the same renderer as broadcast. Test the final source in OBS because installed fonts, Chromium versions and scene scaling can change actual pixels.

## AI layout suggestions

Agents with `canProposeLayouts` can submit complete widget replacements for an overlay/scene pair. The operator compares actual before/after output, geometry, clipping and settings in Change proposals and approves or rejects the suggestion. Pending suggestions never affect output. Existing producer credentials need the explicit grant enabled in Producers. See [AI layout proposals](layout-proposals.md) for HTTP/OpenAPI/MCP requests and stale/disclosure review.

## Agent inspection over HTTP and MCP

Use `getLayouts` (`GET /api/v1/overlays`) to discover overlay IDs, scenes, geometry, order and plugin settings. This authenticated catalog contains operator-authored layout settings but no session content. Read normal capabilities and scoped session context first.

Call `renderPreview` (`POST /api/v1/sessions/{id}/render-preview`) with:

```json
{
  "overlayId": "overlay-1920x1080",
  "sceneId": "live",
  "includeImage": false
}
```

Optionally include `widgets` with a complete candidate layout (requires the layout proposal grant), and/or `change` with a complete normal ChangeSet. A new candidate request ID avoids replaying an already-receipted request. Both current and candidate inspections validate session/field/operation grants; candidate inspection preserves normal revision, ownership, lock, observation and disclosure checks. Use proposal intent for a reviewed suggestion. Inspection itself never saves a proposal, receipt, session change, lock or publication.

The response includes a hypothetical snapshot, inspected session/configuration/layout revisions, changed paths and browser-measured `report`. Every widget has a pixel rectangle, effective `zIndex`, visibility, overflow, scrolling flag, overlap IDs and scoped fields. Each field includes full permitted text, actual visible text, total/visible Unicode code-point counts, ranges with inclusive `start` and exclusive `end`, font size and canvas-relative rectangle. A code point is counted only when its browser Range rectangle is fully inside the field's widget clipping area and canvas and unobscured by an opaque panel in front according to z-index and tie-breaking array order. Partial glyphs are conservatively excluded. Combining marks/emoji sequences may comprise multiple code points; these are not grapheme counts. Ellipsis itself is not counted as source text.

Fields missing from the report are hidden, empty, excluded by plugin settings, unbound in this layout or outside the producer's grants. Compare `changedPaths` with visible field paths to see whether the proposed change is represented. Shrink font size is reported after fitting. Scroll is frozen at its first frame for repeatable inspection, so later frames can reveal different text. Overlap IDs are warnings; full glyph occlusion is reflected in visible ranges. Only a fully opaque widget background in front counts as a complete rectangular occluder; translucent backgrounds preserve underlying geometric visibility. Text with zero alpha has no visible glyph ranges. Partial opacity does not establish readability or contrast, and rounded corners, shadows and antialiased glyphs are not pixel-accurate occlusion masks.

The server measures real full-layout geometry privately to preserve occlusion and text flow, then removes ungranted fields from reports. For an optional PNG, ungranted glyphs are hidden while their geometry/panels remain. Original ungranted text never enters the HTTP snapshot/report/image. Private candidate data is loaded directly into an isolated browser page, never through an anonymous preview URL; network requests are blocked. Inspecting a hidden output does not publish it.

MCP exposes the same workflow as `get_layouts` and `render_preview`; omit `sessionId` to use the active session. Supply `overlayId`, optional `sceneId`, `change` and `includeImage`. PNG output is an MCP image content block; the remaining response is JSON text and structured content. Keep the inspected revisions: a later content/layout edit invalidates the earlier visibility assessment. MCP calls time out after thirty seconds by default and make no automatic retries.

## Browser runtime

`pnpm build` generates a separate private render bundle. Browser inspection uses the pinned Playwright Core runtime with an installed Chromium browser, defaulting to Microsoft Edge on Windows and Google Chrome elsewhere. Set `RENDER_BROWSER_CHANNEL` to an installed supported channel, or `RENDER_BROWSER_EXECUTABLE` to a trusted browser executable path. No browser is downloaded at runtime. Broadcast pages and operator layout editing still function if server-side inspection is unavailable.

At most two inspections run concurrently. `RENDER_BUSY` returns 429; `RENDER_UNAVAILABLE` returns 503 when the browser or bundle is unavailable. Rendered pages have bounded waits, exact viewports, device scale factor one and isolated contexts that close after each request. Screenshots are returned directly and not retained. Ordinary producer request quotas also apply.

## Adding trusted widget plugins

For a researched design that combines multiple public sources in one automatically arranged widget, see [Multi-source panel widget proposal](widget-composition.md). This is a proposal; configurable panels are not implemented.

Create a TypeScript module implementing `WidgetPlugin` in `src/widgets`, following `away.ts`, and register it in `registry.ts`. Declare a unique type, version, operator UI label, English description, source paths, supported settings keys, defaults and a pure `project(context, settings)` function returning plain-text blocks with stable content paths and heading/body/label roles. The core builds layouts, scopes blocks, validates geometry and renders declared blocks without branching on widget types. `away.ts` is an independently registered status plugin demonstrating the extension contract.

Plugins are trusted build-time code, installed by a repository change and rebuild. There is no runtime arbitrary-code upload, plugin marketplace, external URL fetching or task execution. Use the public-shaped context supplied by the registry; it excludes credentials, audit, proposals and provenance. Blocks must refer to their real content grant paths; static operator captions use `/widget/...` paths. Widgets needing new setting shapes or custom non-text rendering should explicitly extend the validated contract/shared renderer and tests. The initial extension interface supplies the existing text presentation settings rather than arbitrary per-plugin schemas.

Operator widget captions are independent layout configuration and survive session purges. Remove sensitive caption text from every affected layout separately. Session purge, credential revocation, publication control and backups retain their existing semantics.
