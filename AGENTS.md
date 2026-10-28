# UI design guidance

These instructions apply to UI work throughout this repository. Preserve app functionality unless the requested change explicitly alters it.

## Direction

Build a minimal, calm, focused language-learning tool, not a commercial product or marketing site. Use generous spacing and include nothing unnecessary. The learning material and the current task should receive attention, not the interface's personality.

The existing UI is not a style reference to preserve. Its promotional copy, decorative touches, and repeated explanations are examples of what to remove when redesigning a screen.

## Content and tone

- Use short, literal headings and action labels: "Languages", "Vocabulary", "Add language", "Settings".
- Remove slogans, inspirational quotes, motivational asides, welcome speeches, playful metaphors, and promotional feature descriptions.
- Do not add commentary just to make a screen feel friendly or complete. A heading does not automatically need a subtitle, and a page does not need a footer message.
- Avoid redundant breadcrumbs, workspace labels, status badges, descriptions, and repeated calls to action when the context is already clear.
- Keep instructions only where they explain a non-obvious operation. Place them at the point of need or in optional help rather than permanently across the interface.
- Keep useful error messages, loading states, empty states, destructive-action confirmations, and privacy/data-sharing information. Minimal does not mean withholding necessary information.
- Empty states should state the situation and offer the relevant action, without encouragement or sales copy.
- These rules concern user-facing copy, not useful source-code comments or actual language-learning content.

### Examples from the current UI

| Avoid | Prefer |
| --- | --- |
| "More languages. More possibilities." | "Languages" |
| "Choose your next adventure" | "Select language", or omit if redundant |
| "A new language, a new perspective" | "Add language" |
| "Creating your space…" | "Adding language…" |
| "Meet your learning companion" | "Connect tutor", where setup is relevant |
| "A little, every day." and "Small steps become second nature." | Remove; no replacement |
| "Every word is a small beginning." | Remove; no replacement |

## Layout and spacing

- Use a simple hierarchy: page title, essential actions, primary content.
- Give content generous, consistent padding and spacing. Let empty space remain empty; do not fill it with illustrations, tips, or decorative panels.
- Group related controls closely enough to make their relationship obvious, with larger gaps between distinct sections.
- Prefer plain sections and lists over grids of cards. Use a container, border, or panel only when it clarifies grouping or interaction.
- Avoid hero banners, oversized introductory areas, nested cards, and dashboard panels that merely repeat available navigation.
- Keep reading and study content at comfortable widths. Adapt spacing for small screens without crowding controls or causing horizontal overflow.

## Visual treatment

- Use restrained neutral surfaces and readable text, with a limited accent color for meaningful interaction or state.
- Avoid decorative gradients, colorful category backgrounds, ornamental shapes, illustrations, sparkles, emoji decoration, and heavy shadows.
- Use a small, consistent typography scale. Prefer readable, understated typography over display headlines, all-caps eyebrow labels, or ornamental type.
- Use subtle borders and modest corner rounding only where helpful. Do not turn every label into a pill or badge.
- Icons must serve recognition or interaction, not decoration. Do not add an icon beside every heading or sentence.
- Avoid decorative animation, bouncing elements, and hover movement. Keep any necessary transitions subtle and respect reduced-motion preferences.

## Interaction and accessibility

- Make the main action clear without competing buttons or repeated prompts.
- Preserve discoverable navigation, visible control labels, keyboard access, focus indicators, adequate contrast, and comfortable touch targets.
- Do not achieve visual quiet by making text too small or faint, or by hiding essential actions behind unexplained icons or hover states.
- Show feedback where it matters. Avoid persistent success banners or celebratory effects for routine actions.
- Do not introduce streaks, rewards, progress nudges, or other gamification unless explicitly requested. Retain learning data that is useful to the task without promotional framing.

## Working rules

- Prefer removing unnecessary UI to adding new components.
- Reuse shared styles and components so the design stays consistent across screens. Shared styling lives in `src/styles.css`; shared UI components live in `src/ui.jsx`.
- Do not add UI libraries, fonts, or decorative assets merely to restyle the app.
- Keep redesign changes scoped to the requested work; preserve learning workflows, integrations, saved data, and necessary setup controls.
- Before finishing UI work, check:
  1. Does every visible element help the user navigate, learn, act, or understand necessary state?
  2. Can any copy, decoration, container, or duplicate control be removed without losing clarity?
  3. Is there generous spacing and a clear visual hierarchy?
  4. Are errors, empty/loading states, keyboard navigation, and small-screen layouts still usable?
- rebuild the app after every completed task.
- Do not modify any files or implement any changes until told to explicitely. If the user expresses what they want, tell them how you would do it. Only make changes once you are told to explicitely.

When in doubt, choose the simpler, quieter version. Do not replace removed marketing copy with different marketing copy.

## Commands
- You do not have access to rg. Do not try and use it.
