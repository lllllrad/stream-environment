# Multi-source panel widget proposal

Status: researched proposal; panel composition is not implemented. Widget z-index is implemented separately. Research reviewed on 2026-10-10.

## Recommendation

Add a **Panel widget** containing an ordered list of **sections**. The operator positions and resizes one outer rectangle. Sections select existing public content sources and arrange themselves inside it without child x/y coordinates. Start with a vertical stack; add horizontal or grid layouts later.

For example, one activity panel could contain Session, Current activity, Recap and Work sections. Moving the panel moves all sections. Changing the section list changes its composition. A separate notice banner can remain an independent widget when it needs another position or z-index.

## Evidence and alternatives

StreamElements custom widgets receive initial session data, recent events, live event notifications and session updates through one widget lifecycle. This demonstrates a broadcast widget consuming several kinds of data. Our recommendation adopts that composition pattern while using this application's existing structured publishing API. [StreamElements widget events](https://docs.streamelements.com/overlays/events).

CSS Flexbox arranges items along a row or column and distributes available space. It fits a stacked panel. CSS Grid supplies automatic placement and track spans for richer two-dimensional panels. These are rendering mechanisms; the application must still define source selection and overflow priorities. [MDN Flexbox](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Flexible_box_layout/Basic_concepts), [MDN Grid auto-placement](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Auto-placement).

| Approach | Operator configuration | Suitable use | Tradeoff |
| --- | --- | --- | --- |
| Fixed summary plugin | One rectangle and a preset | A quick, standard activity summary | Changing the source mix needs another preset or code change |
| Configurable stacked panel | One rectangle, source list, order and section budgets | The recommended initial activity panel | Needs section-aware fitting and inspection |
| Grid panel | One rectangle, column count and spans | Several compact summaries side by side | More sizing rules and narrow-width cases |
| Merged feed | One rectangle, compatible source filters and sorting | Timeline events or reported work updates | Current state and session goals do not share timeline semantics |
| Rotating panel | One rectangle, slides and timing | Optional secondary updates in limited space | Content is visible only part of the time |

W3C's carousel guidance identifies reading, discoverability and motion concerns and recommends pause controls. Broadcast viewers cannot operate controls inside a recorded overlay. Therefore this proposal keeps essential current activity continuously visible and defers rotation to optional secondary information. This broadcast conclusion is an inference from that guidance. [W3C Carousels Tutorial](https://www.w3.org/WAI/tutorials/carousels/).

## Current code and required extension

`WidgetPlugin.project(context, settings)` already returns multiple blocks and can read multiple public content fields. Session already combines title and goal; Current activity combines title, detail, next action and status. A specialized summary plugin is possible with today's interface.

The editor cannot currently configure an arbitrary source combination. `WidgetSettings` has a fixed schema and the renderer flattens blocks into one flow. Simply concatenating sources can let the first section consume all available height. It would not provide independent section budgets or reliable lower-section visibility.

Introduce a validated composition configuration for the Panel type, separate from shared appearance settings. Reuse existing source projectors rather than duplicating their mapping logic. Each section needs a stable layout-local ID, installed source type, visibility, source-specific options and presentation/space limits. Disallow nested panels initially. The outer widget retains its existing geometry, visibility and z-index; sections follow flow order and have no independently assigned z-index or absolute position.

Conceptual configuration, **not a currently accepted API request**:

```json
{
  "type": "panel",
  "x": 1464,
  "y": 24,
  "width": 424,
  "height": 1032,
  "zIndex": 10,
  "composition": {
    "mode": "stack",
    "gap": 16,
    "sections": [
      { "id": "session", "source": "session", "showDetails": false },
      { "id": "current", "source": "now", "priority": "essential", "maxLines": 4 },
      { "id": "recap", "source": "recap", "maxItems": 2 },
      { "id": "work", "source": "work", "showDetails": true }
    ]
  }
}
```

## Initial behavior and editing

- Add, remove and reorder sections in the inspector; drag the outer panel on the canvas.
- Collapse truly empty sections by default; optionally reserve their space to keep a stable layout.
- Give each section bounded item counts, line/height budgets, detail visibility and overflow behavior.
- Allocate essential section space before optional sections. Bound lower-priority content instead of shrinking the entire panel indiscriminately. If essential content cannot fit, report the failure explicitly.
- Preserve minimum readable font sizes and apply the existing plain-text/color validation.
- Include composition edits in undo/redo and show before/after section changes in layout review.

Default to a deterministic stack with capped content. Animated scrolling and rotation require explicit time-dependent inspection and should follow later.

## AI proposals and visibility

AI agents propose the outer rectangle plus section sources, order and limits through the existing reviewed layout proposal workflow. They do not calculate each section's coordinates. Extend the shared HTTP/OpenAPI/MCP contracts and validation together.

Inspection should return the computed canvas-relative section rectangles at the requested resolution, effective layer, overflow outcome and existing per-field visible code-point ranges. Include both `sectionId` and the original content path: repeated bindings need distinct section identity, while content grants still use paths such as `/now/title`. Report which optional sections were dropped for lack of space.

Keep full-layout measurement before scope filtering. A section unavailable to the requesting producer must retain its real geometry during private measurement; only genuinely empty source content may collapse. Otherwise producer-specific filtering would produce a visibility report unlike the actual broadcast. Layout composition permissions do not expand content permissions or bypass operator approval.

## Multiple external systems

This initial proposal combines existing public sources: session, current activity, recap, events, selected/latest work and notice. External systems continue sending structured content or proposals through HTTP/MCP; the panel consumes the resulting public projection.

A panel alone does not create independent current-activity records for multiple agents. The current data model has one current activity and one selected/latest projected work item. Showing several simultaneous agent-specific activities or work records requires additional public source selectors and a bounded collection projection. Keep ingestion and source identity separate from visual composition; implement those collection selectors when that use case is defined.

## Suggested implementation sequence

1. Validated Panel composition, reusable projectors, vertical stack, bounded section fitting, editor/undo/review, HTTP/MCP proposals and section visibility reports.
2. Horizontal/grid arrangement and compatible event/work feed adapters.
3. Optional rotation with explicit timing controls and reports for each displayed state.

Existing independent widgets and saved layouts remain supported. No automatic layout conversion is proposed.
