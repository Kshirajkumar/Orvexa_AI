# Hyperframes Composition Brief: TaxFlow.AI

## Objective
Create a 56-second premium cinematic launch commercial for TaxFlow.AI — an AI-powered practice automation platform for Chartered Accountants.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920×1080
- Duration: 56 seconds

## Source Material
- Project root: `c:\Users\K.HARI BABU\OneDrive\Pictures\TaxFlow_AI`
- Product name: TaxFlow.AI
- Tagline: "Make room for the work that matters."
- CTA: "AI-powered practice automation for Chartered Accountants."
- Logo assets: `assets/taxflow-ai-logo.svg` (light version), `assets/taxflow-ai-logo-dark.svg` (dark text version)
- Key UI: Dashboard (KPI cards + filing list), ExtractionReview (two-panel), Deadlines, Generate
- Copy that must appear verbatim:
  - ACCOUNTING WORK, REIMAGINED.
  - ONE WORKSPACE. CONNECTED PRACTICE.
  - YOUR ENTIRE PRACTICE, IN ONE VIEW.
  - FROM DOCUMENTS TO STRUCTURED DATA.
  - AI DOES THE PREPARATION. / YOU STAY IN CONTROL.
  - EVERY CLIENT. EVERY DOCUMENT. ORGANIZED.
  - KEEP EVERY DEADLINE IN SIGHT.
  - TURN APPROVED DATA INTO USEFUL OUTPUTS.
  - TAXFLOW.AI / Make room for the work that matters. / AI-powered practice automation for Chartered Accountants. / COMING SOON / JOIN THE WAITLIST

## Creative Direction
- **Tone preset:** `cinematic`
- **Creative direction:** "Enterprise FinTech product launch — premium, serious, human. Dark environment, real app UI, restrained effects."
- **Interpretation:** Slow, confident camera movement. Every scene holds long enough to read clearly. The app's real interface is the visual centrepiece. Avoid gratuitous particle systems or over-engineered glows — only what serves the narrative.
- **Hook:** Floating chaotic documents (the CA's daily reality)
- **Outro / punchline:** All UI converges to logo — deep bell ring — silence — logo hold

## Visual Identity
- Background: `#060A13` (root)
- Secondary bg: `#0A1120`
- Card surface: `#111B31`
- Card hover: `#162341`
- Border: `#1E2C4A`
- Blue accent: `#2347D9`
- Cyan accent: `#00C8E0`
- Green: `#1A9E6A`
- Amber: `#D97706`
- Red: `#DC2626`
- Violet: `#7C3AED`
- Primary text: `#E8EEFB`
- Secondary text: `#A6B4D3`
- Muted text: `#6F7FA3`
- Mono: `#A6B4D3` (JetBrains Mono for field values)
- Display font: 'Bricolage Grotesque', sans-serif (scene headlines)
- UI font: 'Plus Jakarta Sans', sans-serif (app labels, chips)
- Logo: Use embedded SVG from `assets/taxflow-ai-logo.svg`

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The Problem — 6s — floating documents, convergence, headline "ACCOUNTING WORK, REIMAGINED."
2. Brand Reveal — 5s — logo scale-in, cyan sweep, tagline
3. Dashboard — 6s — KPI cards, filing list, cursor movement
4. AI Extraction — 7s — invoice + scan line + field population
5. Human Review — 8s — two-panel review, field correction, approval chip
6. File Organisation — 6s — folder structure, client portal upload
7. Deadlines and Reminders — 6s — deadline KPIs, Telegram notification
8. Generate Outputs — 6s — generate click, output cards
9. Final Brand Reveal — 6s — UI convergence, logo, final copy, bell ring

## Audio
- Audio role: Cinematic support — steady, building, premium
- Audio arc: Fades in → builds scene-by-scene → fades under final bell at 54s
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: Fade in from 0 at 0s, vol 0.35 through video, fade to 0 over 52–56s. Let impactBell_heavy_003 ring over faded music at 54s.
- Music cue guidance: Bundled cues at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`. Lock logo scale-in to 8.74s strong beat. Lock scan line start to 17.47s. Lock dashboard settle to 13.11s. Lock approval chip to 22.93s region.
- Audio-reactive treatment: Subtle — logo cyan glow halo breathes with RMS; KPI card presence gains on bass beats. No waveform/EQ visuals.
- Audio-coupled moments:
  - Logo scale-in (~6.5s) — impactSoft_medium_000
  - Scan line start (~17.47s) — interface/drop_001
  - Approval chip appear (~28s) — impactBell_heavy_000
  - Final logo settle (~54s) — impactBell_heavy_003
- SFX selection guidance: cinematic tone, 2–3 large cues + 1–2 subtle drops. No dense layering, no glitch, no casino.
- SFX analysis guidance: `assets/sfx/sfx-analysis.md` — prefer lower HF-risk
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, volume per implemented animation
- Audio files: already copied to `brag-output/composition/assets/`

## Hyperframes Instructions
Build the full 56-second composition as a single HTML file per the Hyperframes data-* timing contract. Use `references/motion.md` eases. Use `references/look.md` visual treatment. Wire all audio per the media-use skill. Run `hyperframes check` as the single pre-render gate. Skip story.md, SPEC.md, storyline steps — this brief replaces them.

Requirements:
- Render every scene headline at high contrast (white/`#E8EEFB` on dark backgrounds)
- Keep all text readable — slow animations where needed
- Every frozen frame should be shareable ("show the thing" law)
- Use the logo SVG asset — do not recreate the brand mark from scratch
- The ExtractionReview scene (Scene 5) is the centerpiece — give it space
- Do not show government e-filing or tax submission — only "generate working outputs"
- Final logo hold must be a minimum 2 seconds of full settle before cut

