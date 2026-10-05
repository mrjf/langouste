---
"name": "Langouste public course workbook"
"description": "Compact textbook structure for authored Hungarian and Egyptian Arabic study."
"colors":
  "primary": "#245c44"
  "ink": "#24352c"
  "muted": "#526057"
  "paper": "#fcfcf8"
  "index-paper": "#f2f4ed"
  "reference-paper": "#f5f6ef"
  "control": "#ffffff"
  "rule": "#d4dad2"
  "control-border": "#a6b6a8"
  "selected": "#dde9de"
  "selected-ink": "#174830"
  "selected-border": "#b0c4af"
  "nav-hover": "#e5ebdf"
  "term-hover": "#e4eddf"
  "term-underline": "#a2b6a5"
  "feedback-paper": "#f2efe5"
  "feedback-border": "#d7ccb4"
  "correct-paper": "#edf3ed"
  "correct-border": "#b9ccb9"
"typography":
  "headline":
    "fontFamily": "Source Serif 4, Georgia, serif"
    "fontSize": "32px"
    "fontWeight": 500
    "lineHeight": 1.2
    "letterSpacing": "-0.02em"
  "title":
    "fontFamily": "IBM Plex Sans, Helvetica Neue, Arial, system-ui, sans-serif"
    "fontSize": "21px"
    "fontWeight": 600
    "lineHeight": 1.35
  "body":
    "fontFamily": "IBM Plex Sans, Helvetica Neue, Arial, system-ui, sans-serif"
    "fontSize": "16px"
    "lineHeight": 1.55
  "reading":
    "fontFamily": "IBM Plex Sans, Helvetica Neue, Arial, system-ui, sans-serif"
    "fontSize": "22px"
    "lineHeight": 1.65
  "reading-arabic":
    "fontFamily": "Tahoma, Noto Sans Arabic, sans-serif"
    "fontSize": "28px"
    "lineHeight": 1.8
  "lesson-label":
    "fontFamily": "IBM Plex Sans, Helvetica Neue, Arial, system-ui, sans-serif"
    "fontSize": "14px"
    "lineHeight": 1.35
"rounded":
  "square": "0"
  "control": "3px"
"spacing":
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
"components":
  "button-primary":
    "backgroundColor": "{colors.primary}"
    "textColor": "{colors.control}"
    "rounded": "{rounded.control}"
    "padding": "8px 12px"
  "button-secondary":
    "backgroundColor": "{colors.control}"
    "textColor": "{colors.primary}"
    "rounded": "{rounded.control}"
    "padding": "8px 12px"
  "reference-search":
    "backgroundColor": "{colors.control}"
    "rounded": "{rounded.control}"
    "padding": "10px"
    "width": "100%"
  "lesson-navigation":
    "backgroundColor": "{colors.selected}"
    "textColor": "{colors.selected-ink}"
    "typography": "{typography.lesson-label}"
    "rounded": "{rounded.control}"
    "padding": "10px 8px"
  "word-chip":
    "backgroundColor": "transparent"
    "textColor": "{colors.primary}"
    "rounded": "{rounded.control}"
    "padding": "8px 12px"
  "term-link":
    "backgroundColor": "transparent"
    "textColor": "{colors.ink}"
    "typography": "{typography.reading}"
    "rounded": "{rounded.square}"
    "padding": "0"
  "feedback":
    "backgroundColor": "{colors.feedback-paper}"
    "padding": "16px"
---

# Design System: Langouste public course workbook

## Overview

**Creative North Star: "The Reading Workbook"**

A compact textbook for authored Hungarian and Egyptian Arabic study. Warm paper, dark green ink, thin rules and a restrained green accent keep attention on language content. Serif titles establish the book character; reading passages and controls use the inherited sans-serif stack.

This system describes the public static workbook mounted by LocalApp, not the separate account-connected interface. It is extracted from StudyWorkspace, StudyPractice, CourseAudio and the inherited app.css base. The implemented source takes precedence over the initial direction contract.

**Key Characteristics:**
- Readable passages with nearby contextual reference.
- Dense navigation and ruled sections rather than a card dashboard.
- Explicit text controls and visible keyboard focus.
- Responsive lesson drawer and bottom reference sheet.

## Colors

The palette combines near-white paper, green-black ink and one restrained forest-green action accent. Frontmatter values are normative. Sidecar tonal ramps are synthetic preview aids, not implemented additional tokens.

### Primary

- **Forest green** (`primary`): primary actions, links, selected step underline, caret and focus outlines.
- **Selected greens** (`selected`, `selected-ink`, `selected-border`): current lesson and open vocabulary state. Hover fills remain pale and local.

### Neutral

- **Paper**: main reading surface and sticky header.
- **Index paper / reference paper**: distinguish navigation and contextual reference without raised cards.
- **Ink / muted**: reading text and supporting metadata.
- **Rule / control border**: section dividers and control boundaries.
- **Feedback paper / correct paper**: quiet warm and green feedback surfaces, each with its corresponding border; meaning also appears in text.

## Typography

**Headline Font:** Source Serif 4, with Georgia and serif fallbacks. The variable normal face is self-hosted from `src/client/assets/source-serif4.ttf`, declared for weights 200–900 with `font-display: swap`. The upstream source is official Google Fonts Source Serif 4; the bundled license is `src/client/assets/source-serif4-OFL.txt`.

**Body Font:** The inherited `--font-sans` stack from `src/client/app.css`; this documentation does not claim a self-hosted body font. Arabic passages use the explicit Tahoma / Noto Sans Arabic / sans-serif stack.

### Hierarchy

- **Headline:** the frontmatter headline role; mobile headings reduce to 28px. The brand label is 25px, weight 600, reducing to 22px on mobile; the current button-font cascade uses the inherited sans-serif stack.
- **Title:** section headings use the title role; tertiary headings use 18px with 1.4 line height.
- **Body:** the body role, with prose capped at 72ch.
- **Reading:** the reading role, capped at 64ch; mobile passages use 21px. Arabic uses the reading-arabic role and reduces to 27px on mobile. Practice passages use 22px / 1.7, with Arabic at 27px.
- **Labels:** lesson navigation uses the lesson-label role. Supporting metadata ranges from 11px to 14px; this is supporting information, not the primary reading scale.
- **Support:** translations and transliteration use 16px, 1.6 line height in the workbook; reference example passages use 20px, or 26px in Arabic.

**The Context Rule.** An authored term remains part of the sentence; its underline signals reference access without changing the reading size or direction.

## Layout

Desktop uses a sticky 64px header and a 236px lesson index beside a flexible reading column. Opening reference adds a 290px inspector. The main column is capped at 880px including its padding; desktop padding is 26px 36px 64px. Spacing follows the small recurring frontmatter steps, with component-specific measures retained where needed.

At 1150px and below the index becomes 210px, main padding becomes 24px and reference becomes a fixed bottom-right sheet: up to 420px wide and 65vh high. At 720px and below the header is 60px, main padding is 16px 18px 48px, and the index is a toggled fixed drawer below the header, up to 310px or 90vw wide. The language control becomes a select. The reference sheet spans the width and is capped at 58vh. Lesson tabs scroll horizontally, reading tools wrap, and the reading selector occupies a full row. Practice has an additional 600px adjustment for gaps and question heading size.

**The Reading First Rule.** Keep introductory material compact so real study content follows the lesson heading and controls without a hero.

## Elevation & Depth

Ordinary reading sections are flat, separated by thin rules and pale surface tones. The current lesson uses an inset one-pixel outline. Only overlaid reference and mobile navigation introduce diffuse shadows; exact recipes live in the sidecar.

**The Flat Page Rule.** Use rules and paper tones for ordinary sections; diffuse shadows belong to overlay sheets and drawers.

## Shapes

Controls use the small frontmatter control radius. Reading sections have square edges and one-pixel separators. The current lesson combines the same small radius with an inset outline. Inline term buttons are unboxed and square; they inherit sentence typography. Do not make the workbook's reading sections rounded panels.

## Components

### Buttons

Plain, text-led actions use a white background, green label and fine border; primary actions invert to green with white text. Workbook buttons use the frontmatter padding, generally with a 44px minimum height. Practice action padding is 9px 12px. The mobile lesson toggle is 40px minimum; sentence reveals are 36px minimum and inline terms intentionally remain text-sized. Disabled opacity is 0.55 in the workbook and 0.5 in practice. There is no generic hover animation to inherit.

Focus-visible uses a two-pixel green outline with a three-pixel offset. Preserve this on buttons, links, fields, selects and disclosure summaries. The skip link reveals itself on focus and moves focus to study content.

### Inputs / Fields

Reference search is a full-width white field, with the small radius, 10px padding and 18px text. Practice answers use 12px padding and 20px text with a darker gray-green border. Selects remain native controls with visible boundaries. Use the same focus outline as buttons.

### Navigation

The index uses numbered lesson rows with an inset outline on the current page, pale green hover and tabular day numbers. Destination buttons form a two-column group. Lesson steps use a bottom rule with a green two-pixel underline on the current step. State is communicated with `aria-current` or `aria-pressed` as appropriate.

### Word chips and inline terms

Vocabulary chips are small-radius outlined text buttons in a wrapping strip; the open entry has the selected fill. Inline authored terms retain passage size, inherit text color and use a one-pixel underline offset by five pixels; hovering adds a pale green fill. Do not infer additional word forms for this interaction.

### Contextual reference

The inspector is a labeled aside with an explicit Close button. Opening an entry focuses Close without scrolling. Nested lookups retain the original external trigger; Close or Escape returns focus to it, falling back to the study region if it was removed. This is not a modal-dialog contract and no focus trap is claimed. The reference entrance moves upward eight pixels over 150ms with ease-out only when reduced motion is not requested.

### Practice and feedback

Answer choices are stacked outlined rows with a selected green border and pale fill. Feedback is a flat bordered section with warm neutral or correct-green treatment, accompanied by explicit answer text. Answer submission, correction and moving to the next question remain separate actions. Support and self-assessment are identified in language rather than implying mastery.

### Recorded audio

CourseAudio conditionally offers labeled playback controls for prerecorded assets. Its compact controls use 12px text and a 4px radius. The public workbook hides missing recordings; no synthetic fallback or decorative play glyph belongs to this pattern.

## Do's and Don'ts

### Do:
- Do preserve the reading hierarchy, Arabic direction and mixed-language isolation.
- Do keep translations sentence-level and transliteration separately controlled.
- Do use text labels, green focus outlines and compact controls.
- Do preserve the original reading trigger when navigating between entries inside the reference inspector.
- Do describe saved completion as activity and review as latest incorrect answers.

### Don't:
- Don't add eyebrow labels, marketing heroes or decorative glyph icons.
- Don't convert ruled study sections into a card dashboard.
- Don't shrink passage text to create mobile density; compact the surrounding controls.
- Don't represent imported progress, a public spaced-review scheduler or lasting retention as implemented features.
- Don't show audio controls without an actual prerecorded asset.
