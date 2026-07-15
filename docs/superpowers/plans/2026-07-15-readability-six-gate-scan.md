# Readability and Six-Gate Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the illegible pill-shaped hero animation and primary CTA with a causally clear six-gate readiness scan, then repair readability defects across every site route without changing print pagination.

**Architecture:** Keep the static HTML-fragment architecture. Replace only the hero visual markup in `fragments/index-01.js`; add a focused readability override stylesheet imported last from `styles.css`; expand `scripts/qa.py` with source assertions for removed pill patterns, accessible hero copy, and preserved PDF page contracts. Use GitHub Actions/Playwright on a pull request to render desktop, laptop, tablet, mobile, reduced-motion, and document-route evidence before merging.

**Tech Stack:** Static HTML fragments, CSS, vanilla JavaScript, Python QA, Playwright Chromium, GitHub Pages.

## Global Constraints

- Remove the floating `.offer-capsule` from rendered markup.
- Replace the orbit/pill hero with a six-gate scan that ends at `Ready with controls`.
- Animation runs once and rests in a meaningful completed state.
- Reduced-motion mode shows the completed state immediately.
- Primary CTA label must remain visible with WCAG AA contrast in default, hover, and focus states.
- Do not use pill-shaped CTA geometry; maximum CTA radius is 12px.
- Site UI text outside print documents must not rely on sub-12px low-opacity labels for essential meaning.
- Screen document surfaces may grow/reflow; print geometry and PDF counts remain exactly 2 / 1 / 2 / 2 / 1.
- No animated element may cross or obscure text.
- Preserve official NWN identity and existing campaign thesis.

---

### Task 1: Replace the hero motion system

**Files:**
- Modify: `fragments/index-01.js`
- Create: `styles/readability-repair.css`
- Modify: `styles.css`

**Interfaces:**
- Consumes: existing `.hero`, `.hero-inner`, `.hero-actions`, and brand tokens.
- Produces: `.readiness-scan`, `.scan-offer`, `.scan-gates`, `.scan-gate`, and `.scan-outcome` markup/styles.

- [ ] Replace the orbit/core/capsule markup with static readable labels for all six gates and a final release-posture panel.
- [ ] Animate gate activation sequentially once using CSS only; no moving object crosses copy.
- [ ] Add a reduced-motion completed state.
- [ ] Change the CTA copy to `Run the readiness model` and enforce rectangular, high-contrast button states.

### Task 2: Repair site-wide readability

**Files:**
- Modify: `styles/readability-repair.css`

**Interfaces:**
- Consumes: current section, artifact, evidence, plan, table, footer, and document classes.
- Produces: contrast, minimum-size, focus, responsive, and screen-document overrides.

- [ ] Raise essential site labels and descriptions to readable sizes.
- [ ] Strengthen low-opacity text on navy/blue backgrounds.
- [ ] Add consistent `:focus-visible` outlines to links, buttons, and interactive controls.
- [ ] Recompose the six-gate scan at tablet/mobile widths without shrinking labels.
- [ ] Make mobile screen-document footers flow normally and prevent hidden overflow without changing print rules.

### Task 3: Add regression coverage

**Files:**
- Modify: `scripts/qa.py`

**Interfaces:**
- Consumes: public HTML/CSS/JS source and generated PDFs.
- Produces: failures when pill markup returns, CTA copy/geometry regresses, reduced-motion support disappears, or page counts change.

- [ ] Assert `offer-capsule` and the old animated-airlock markup are absent from public fragments.
- [ ] Assert the six gate names and `Ready with controls` appear in hero source.
- [ ] Assert `Run the readiness model` exists and the readability stylesheet is imported last.
- [ ] Preserve existing exact PDF page-count assertions.

### Task 4: Browser and visual QA

**Files:**
- Modify: `.github/workflows/campaign-qa.yml` only if screenshot artifacts are not already produced.

**Interfaces:**
- Consumes: repair branch source.
- Produces: desktop/laptop/tablet/mobile/reduced-motion screenshots, interaction evidence, and passing QA.

- [ ] Run source QA.
- [ ] Render the homepage at 1440x900, 1280x800, 768x1024, and 390x844.
- [ ] Verify primary CTA text, gate labels, no overlap, no horizontal overflow, and no console errors.
- [ ] Verify reduced-motion completed state.
- [ ] Inspect all HTML routes for low-contrast essential text, overflow, clipping, and visible focus states.
- [ ] Regenerate and verify PDFs only if document source changed.

### Task 5: Publish and record the correction

**Files:**
- Modify: private RoleForge case/pattern memory after successful publication.

**Interfaces:**
- Consumes: verified repair commit.
- Produces: merged `main`, redeployed Pages, and a user-steering revision delta.

- [ ] Open and merge the repair PR after QA passes.
- [ ] Verify the live homepage returns the revised hero copy and no `.offer-capsule` markup.
- [ ] Record the rejected pill/capsule execution, approved six-gate scan, affected surfaces, and regression coverage in private RoleForge memory.
