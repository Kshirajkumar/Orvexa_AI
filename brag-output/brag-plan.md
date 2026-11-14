# Brag Plan: TaxFlow.AI

## What is this app?

TaxFlow.AI is a desktop practice automation platform for Chartered Accountants — it collects client documents, uses AI to extract structured GST and tax data, puts the accountant in the review and approval seat, tracks every compliance deadline, schedules Telegram reminders, and generates verified working outputs. It is a real, production-grade app with 9 screens: Dashboard, Extract, ExtractionReview, Files, Generate, Deadlines, WhatsApp/Telegram, Clients, and onboarding.

## The angle

Accounting work is unglamorous chaos — invoices in email, deadlines in spreadsheets, reminders forgotten. TaxFlow doesn't promise magic automation: it promises that the accountant stays in control of every decision while the AI handles the heavy lifting. The video must show the actual workflow from scattered inputs → AI extraction → human verification → organised outputs. No fabricated capabilities, no fake government filing.

**Tone hook:** "This is what a CA's day actually looks like. And this is what it looks like when TaxFlow is in the room."

## Hook (first 2–3 seconds)

Cinematic fade-in of floating documents — GST invoices, Form 16s, bank statements — drifting chaotically in deep space. No text yet. Just the visual reality of a CA's inbox. At 2.5s a sharp impact sound and the headline fades in:

> **ACCOUNTING WORK, REIMAGINED.**

## Key moments (the middle)

1. **Brand reveal (Scene 2, 6–11s)** — Cinematic transition into midnight blue. TaxFlow.AI wordmark + logo glyph scales in through a cyan light sweep. Tagline: ONE WORKSPACE. CONNECTED PRACTICE.

2. **Dashboard at a glance (Scene 3, 11–17s)** — The real app Dashboard UI fades in: KPI cards (Active Clients, Invoices Extracted, Due in 7 days, Reminders Scheduled), Filings list with status chips (amber = overdue, green = complete). Animated progress bars. Floating metric cards. Cursor moves naturally. Headline: YOUR ENTIRE PRACTICE, IN ONE VIEW.

3. **AI extraction scan (Scene 4, 17–24s)** — GST invoice enters frame. A cyan scanning line sweeps across it. Extracted fields populate in real-time on the right: Invoice No. · Supplier GSTIN · Taxable Value · CGST · SGST · Grand Total. Headline: FROM DOCUMENTS TO STRUCTURED DATA.

4. **Human review and approval (Scene 5, 24–32s)** — The ExtractionReview two-panel interface. Left: original invoice PDF. Right: editable extracted fields. Cursor selects the Grand Total field, corrects a value. The amber "Needs Review" chip animates to a green "Human Verified ✓" chip. Headline sequence: AI DOES THE PREPARATION. → YOU STAY IN CONTROL.

5. **Deadlines and reminders (Scene 6/7 combined, 32–44s)** — The Deadlines page: KPI chips (Overdue / Due in 7 days / Complete). Progress bars per client filing. Then Telegram reminder scheduled — notification bubble pops in. Headline: KEEP EVERY DEADLINE IN SIGHT.

6. **Generate outputs (Scene 8, 44–50s)** — The Generate page: select client, select filing type, run. Output cards appear: "GSTR-3B Working Sheet.txt" ready. Headline: TURN APPROVED DATA INTO USEFUL OUTPUTS.

## Outro / punchline

Cinematic camera pull-back. All UI panels converge into the TaxFlow wordmark and logo glyph on deep midnight blue with cyan glow. Final typography:

> **TAXFLOW.AI**
> Make room for the work that matters.
> AI-powered practice automation for Chartered Accountants.
>
> COMING SOON — JOIN THE WAITLIST

A deep bell resonates. Music fades to silence. Logo holds.

## User flow worth showing

**Entry:** Scattered documents / CA's daily chaos
**Key action 1:** AI extraction — scan GST invoice → structured fields appear
**Key action 2:** Human review — accountant corrects and approves an extracted value
**Result:** Organised files, tracked deadlines, scheduled reminders, generated outputs

## Tone

- **Preset:** `cinematic`
- **Creative direction:** "Enterprise FinTech product launch — premium, serious, human. Like an Intercom or Notion reveal but for Indian CA practices."
- **Interpretation:** Slow, confident camera movements. Dark environment. Every scene holds long enough to read clearly. Restraint over flash. The product's real UI is the star, not effects.

## Format: landscape — 1920×1080
## Duration: 56 seconds

## Visual identity (from the project)

- Background: `#060A13`
- Secondary background: `#0A1120`
- Card surface: `#111B31`
- Card hover: `#162341`
- Border: `#1E2C4A`
- Primary accent: Blue (`#2347D9` website / `var(--blue)` app)
- AI accent: Cyan (`var(--cyan)`)
- Verified/success: Green (`var(--green)`)
- Needs review: Amber (`var(--amber)`)
- Primary text: `#E8EEFB`
- Secondary text: `#A6B4D3`
- Display font: Bricolage Grotesque (headings) / Plus Jakarta Sans (UI)
- Body font: Plus Jakarta Sans
- Mono font: JetBrains Mono (field values, IDs)
- Logo assets: `assets/taxflow-ai-logo.svg` (dark background version), `assets/taxflow-ai-logo-dark.svg`
- Strongest visual element: The ExtractionReview two-panel layout — left=document, right=structured fields with status chips

## Share copy (draft)

Built TaxFlow.AI — practice automation for CAs. AI extracts your GST invoices. You review and approve every field. Every deadline, every client, one workspace.

## Audio direction

- **Role:** Cinematic support — steady, building, premium
- **Music:** `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` — 1:58, steady and clean, best for cinematic tone
- **Music treatment:** Fade in from 0 at 0.3s, hold at 0.35 volume through the video, duck slightly under the final logo hold, let the impactBell_heavy ring over faded music at ~54s. Gradual swell matches increasing product complexity scene-to-scene.
- **Music cue guidance:** Bundled preset at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`. Strong cues: 8.74s (brand reveal → lock logo scale to this), 13.11s (dashboard push-in), 17.47s (scanning animation start), 22.93s (extracted fields fully populated).
- **Audio-reactive treatment:** Subtle — use music RMS/bass to make the brand logo's cyan glow halo breathe slightly; card KPI panels gain subtle presence on strong beats. No waveform/EQ visuals.
- **SFX posture:** Minimal but present. 3–4 key cues only. Cinematic restraint.
- **Audio-coupled moments:**
  - Scene 2 (brand reveal ~6.5s) — `impactSoft_medium_000` as logo scales in
  - Scene 4 (scanning start ~17.5s) — soft `interface/drop_001` as scan line begins
  - Scene 5 (approval chip transition ~28s) — `impactBell_heavy_000` as "Human Verified ✓" chip appears
  - Scene 9 (final logo ~52s) — `impactBell_heavy_003` deep resonant ring, music fades out
- **SFX analysis guidance:** `assets/sfx/sfx-analysis.md` — use lower HF-risk sounds for the polished/cinematic tone
- **Restraint rule:** No dense SFX layering. No glitch sounds. No casino sounds. No percussion-heavy stacking.

---

## Storyboard

### Scene 1 — The Problem — 6s (0–6s)
**On screen:** Deep space environment, `#060A13` background. 8–10 floating document thumbnails (PDF icons, invoice shapes, spreadsheet grids, Form 16 silhouettes) drifting in different directions with gentle motion blur. No labels — pure visual chaos metaphor. Camera slowly pulls back revealing the full chaos.
At 3.5s documents begin slowly converging toward center.
At 5s headline fades in: **ACCOUNTING WORK, REIMAGINED.**
Sequential/interaction: Documents drift in individually (staggered 0.3s apart), then converge
Audio intent: Sparse, atmospheric — the problem scene should feel unresolved
Audio-coupled idea: Soft ambient, no SFX until the convergence at 3.5s where a very soft `interface/drop_001` plays
Music: Cinematic bed, low volume at open, building
Transition mood: sharp → Scene 2

### Scene 2 — Brand Reveal — 5s (6–11s)
**On screen:** Clean midnight blue environment. The floating documents scatter/dissolve with a bright flash. TaxFlow.AI logo glyph (the blue rounded square with document lines + checkmark) scales in from centre at ~6.5s. A cyan light streak animates left-to-right across the wordmark "TaxFlow.AI". Elegant glass/card edge elements emerge at the periphery.
Headline at 8s: **ONE WORKSPACE. CONNECTED PRACTICE.**
Sequential/interaction: Logo scale-in → cyan light sweep → tagline fade-in
Audio intent: Confident arrival — the product is here
Audio-coupled idea: `impactSoft_medium_000` at ~6.5s as logo scales in. Lock logo scale to strong beat at 8.74s.
Music: Full presence
Transition mood: soft dissolve → Scene 3

### Scene 3 — The Dashboard — 6s (11–17s)
**On screen:** The real TaxFlow dashboard UI rendered faithfully.
- Background: `#060A13`, app chrome in `#0A1120`
- 4 KPI cards in a grid: "Active Clients / 12", "Invoices Extracted / 47", "Due in 7 days / 3 (amber)", "Reminders Scheduled / 8"
- Below: "Filings that need attention" list — 3 rows showing client name, filing type (GSTR-1, ITR-3, etc.), status chip (amber "5 d left", red "2 d overdue", green "Complete"), and a progress bar
- Animated cursor moves from card to card, then scrolls the list
Camera push-in from slightly above: starts wider, slowly zooms to the KPI cards.
Headline: **YOUR ENTIRE PRACTICE, IN ONE VIEW.**
Sequential/interaction: KPI cards appear staggered left-to-right; list rows slide in; cursor moves
Audio intent: Busy but organised — the dashboard breathes
Audio-coupled idea: `interface/drop_001` at the first KPI card appearance (~11.3s), aligned to beat 13.11s for the full dashboard settled state
Music: Beat 13.11 (strong cue) locks the full dashboard settle
Transition mood: clean push → Scene 4

### Scene 4 — AI Document Intelligence — 7s (17–24s)
**On screen:** A GST invoice thumbnail (PDF-style document) floats in from the left. The invoice renders with visible text: Invoice No: GST/2024-25/001, Supplier: Prestige Traders (GSTIN: 29ABCDE1234F1Z5), Date: 15 Oct 2024, Taxable Value: ₹1,25,000, CGST: ₹11,250, SGST: ₹11,250, Grand Total: ₹1,47,500.
A glowing cyan scanning line sweeps top-to-bottom at ~18s.
On the right side, a structured extraction panel appears with fields populating one by one with a typewriter effect: Invoice Number → Supplier Name → GSTIN → Date → Taxable Value → CGST → SGST → Grand Total → Line Items.
Each field value snaps in with a tiny `drop` micro-sound.
Small cyan chip: "AI EXTRACTED" appears above the panel.
Headline: **FROM DOCUMENTS TO STRUCTURED DATA.**
Sequential/interaction: Invoice in → scan line → fields populate sequentially
Audio intent: Precise, clinical, impressive — the AI is working
Audio-coupled idea: Scan line start at 17.47s (locked to strong beat). `interface/drop_001` lightly for each 2nd field snap (not every one). No overscoring.
Music: Beat 17.47s (strong cue) locks scan start
Transition mood: wipe/dissolve → Scene 5

### Scene 5 — Human Review and Approval — 8s (24–32s)
**On screen:** The ExtractionReview two-panel interface fills screen.
LEFT PANEL (55% width): The original GST invoice PDF displayed with the cyan scanning highlight still faintly visible.
RIGHT PANEL (45% width): Extracted field list. All fields show amber "Needs Review" state initially.
At ~25s: cursor moves to "Grand Total" field, clicks it. The field highlights blue. The value reads "₹1,47,000" — the cursor changes value to "₹1,47,500". A correction tick appears.
At ~27s: a green "Save & Approve" button pulses. Cursor clicks it.
At ~28s: the status chip at top right transitions from amber "NEEDS REVIEW" to green "HUMAN VERIFIED ✓" with a satisfying animation.
Headline sequence:
  - 24–27s: **AI DOES THE PREPARATION.**
  - 27–32s: **YOU STAY IN CONTROL.**
Sequential/interaction: Cursor selects field → corrects value → clicks Approve → status chip transitions
Audio intent: Authoritative human moment — the professional makes the final call
Audio-coupled idea: `impactBell_heavy_000` at 28s as green chip appears. Mouse click sounds for cursor interactions.
Music: Beat 22.93s (strong beat, just before scene) aligns to the scene transition.
Transition mood: clean slide → Scene 6

### Scene 6 — Client Files and Organisation — 6s (32–38s)
**On screen:** The TaxFlow Files page. Left nav shows client list. Main area shows folder structure for "Sharma & Associates":
- RAW (3 files — PDFs with doc icons)
- EXTRACTED (5 files — cyan chip "Extracted")
- GENERATED (2 files — violet chip "Generated")
Folders expand with a smooth accordion animation. File rows appear staggered. Each row: filename, type chip (GST · PDF), status chip, date.
Briefly transition (at ~36s) to a client portal view: clean white upload panel where a client drags a document into a secure upload zone. Blue progress bar fills. "Document received" confirmation appears.
Headline: **EVERY CLIENT. EVERY DOCUMENT. ORGANIZED.**
Sequential/interaction: Folders expand sequentially; files slide in; portal upload animation
Audio intent: Satisfying order after the chaos of Scene 1
Audio-coupled idea: `interface/drop_001` for each folder section expanding
Music: Steady cinematic bed
Transition mood: soft dissolve → Scene 7

### Scene 7 — Deadlines and Reminders — 6s (38–44s)
**On screen:** The TaxFlow Deadlines page. At top: 3 KPI chips — "2 Overdue" (red), "3 Due in 7 days" (amber), "8 Complete" (green). Below: client filing rows with progress bars. One row highlighted: "GSTR-1 · Mehta Enterprises · Due 20 Nov" with a red chip "3 d overdue" and a progress bar at 60%.
At ~41s: a Telegram notification bubble slides in from bottom-right: 🔔 "Reminder: GST-3B filing due in 2 days — Sharma & Associates" with a blue Telegram icon. A small scheduled time indicator appears: "Scheduled 09:00 AM".
Headline: **KEEP EVERY DEADLINE IN SIGHT.**
Sequential/interaction: Deadline rows appear → overdue row highlighted → Telegram notification slides in
Audio intent: Urgency acknowledged, then resolved — the system handles follow-up
Audio-coupled idea: `interface/bong_001` softly as Telegram notification appears
Music: Steady with mild swell
Transition mood: clean cut → Scene 8

### Scene 8 — Generate Outputs — 6s (44–50s)
**On screen:** The Generate page. Left: client dropdown showing "Sharma & Associates (India)". Filing type dropdown showing "GSTR-3B". A "Generate" blue primary button. 
At ~45s: cursor clicks Generate. A progress spinner appears briefly.
At ~46s: output card appears: "GSTR-3B_Working_Sheet_Oct2024.txt — Ready" with a green "Done" chip and a download icon. A second card: "Tax_Computation_Sharma_Oct2024.txt — Ready."
Small note at bottom: "Review these outputs before filing. TaxFlow prepares; you decide."
Headline: **TURN APPROVED DATA INTO USEFUL OUTPUTS.**
Sequential/interaction: Dropdown selections → Generate click → output cards appear staggered
Audio intent: Completion — the work is done, properly
Audio-coupled idea: `interface/click_001` on Generate button click; `impactSoft_medium_002` as output cards appear
Music: Building toward finale
Transition mood: cinematic camera pull-back → Scene 9

### Scene 9 — Final Brand Reveal — 6s (50–56s)
**On screen:** Cinematic pull-back. All the UI panels from previous scenes miniaturise and converge toward centre, forming a constellation around the TaxFlow brand mark. They dissolve into the midnight-blue environment.
The TaxFlow.AI logo — wordmark + glyph — fades in at full scale with a cyan halo glow breathing slowly.
Typography appears in sequence, each line fading in at 0.5s intervals:
  - **TAXFLOW.AI**
  - Make room for the work that matters.
  - AI-powered practice automation for Chartered Accountants.
  - `COMING SOON`
  - `JOIN THE WAITLIST — taxflowai.com`
At ~54s: `impactBell_heavy_003` rings. Music fades to silence. Logo holds.
Sequential/interaction: UI panel convergence → logo appear → text stagger-in → bell ring → logo hold
Audio intent: Arrival — premium, earned, final
Audio-coupled idea: `impactBell_heavy_003` at 54s as final logo fully settles. Music fades from 0.35 to 0 over the last 3s.
Music: Fade to silence over 50–56s
Transition mood: none — end

---

**Music mood for this video:** Cinematic, steady, building corporate energy with a clean resolving finale.
**Audio summary:** Vol-12 cinematic bed at 0.35 volume fades in at open, holds steady through the narrative, then fades under the final bell ring at 54s. 4 key SFX cues at the logo reveal (6.5s), scan start (17.5s), approval chip (28s), and final logo ring (54s). Restrained, professional, every sound earns its place.

