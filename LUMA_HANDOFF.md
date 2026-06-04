# Luma AI Handoff — Style Rank Emblems (A / S / SS)

We need **3 hero rank emblems** for the Game Metronome result screen: **A**, **S**, and **SS**.
B and below are fine as plain glowing letters — do **not** need art.

These animate in dramatically when the result card appears (S and SS get a "burst" with
extra glow). They are the trophy of a single run, so they should feel like a *reward*.

---

## What it replaces (current look)

Right now the rank is just a glowing italic letter:

- **Font:** Orbitron, weight **900**, *italic*, `font-size: 3.4rem`, `letter-spacing: 0.02em`
- **A** — green `#00e87a`, glow `0 0 10px rgba(0,232,122,0.8)`
- **S** — cyan `#00c8ff`, glow `0 0 10px / 0 0 24px rgba(0,200,255,…)`
- **SS** — gold `#ffe066`, glow `0 0 10px rgba(255,224,102,0.9), 0 0 28px rgba(255,184,0,0.7)`

App palette (match these): background near-black navy `#070d18`–`#0c1828`,
accent gold `#FFB800`, cyan `#00c8ff`, success green `#00e87a`, borders cyan-tinted.
Body font is **Rajdhani**; display/numbers/titles are **Orbitron**.

---

## Output specs (important)

- **Transparent PNG**, square canvas (1:1).
- Recommend **1024×1024** masters; they'll be displayed ~120–200px so keep the silhouette
  bold and readable when small.
- Centered emblem, generous padding, glow contained within the canvas (no hard edge clipping).
- Each emblem must contain the **letter mark** (A / S / SS) integrated into the design —
  Orbitron-style heavy italic, or a custom angular sci-fi letterform that reads instantly.
- Consistent framing/scale across all three so they swap cleanly.
- Deliver as: `rank-a.png`, `rank-s.png`, `rank-ss.png`.

They will be dropped into the existing layout via CSS `background-image` on
`.rogue-result-rank[data-rank="A"|"S"|"SS"]` (markup already exposes `data-rank`), so the
art just needs to look great on a dark navy backdrop.

---

## Aesthetic direction

Sci-fi / cyberpunk / drumming, premium game-UI badge. Reference vibes:
**Mass Effect** (clean holographic HUD), **Persona 5** (bold stylish graphic punch),
**Final Fantasy** (ornate emblem prestige), **Devil May Cry** (rank flair, "SSS" energy),
**Expedition 33** (painterly art-deco elegance). Drumming motifs welcome: drumsticks,
soundwaves, a kick/snare silhouette, concentric pulse rings, beat-grid lines.

Tiered escalation across the three — they should clearly read as good → great → god-tier:

- **A — "Solid"**  
  Emerald-green emblem. Clean, confident, holographic. A hexagonal or shield frame with the
  letter **A**, subtle soundwave/pulse-ring accent, thin cyan circuitry. Energetic but grounded.

- **S — "Elite"**  
  Cyan emblem with more ornament. Sharper angular frame, faint chromatic/holo shimmer,
  drumstick or beat-grid motif, brighter rim light. Should feel like a tier above A —
  more wings/spikes/energy lines radiating outward.

- **SS — "Legendary"**  
  Gold + warm-fire emblem with maximum drama. Radiant burst, prismatic/iridescent edges,
  ornate FF-style filigree or DMC-style explosive flair, dense glow and light rays.
  The "you nailed it" jackpot badge. Can carry a small crown / laurel / flame crest.

Keep all three on the **same dark navy** background context, glow color matching each rank's
hue (green / cyan / gold) so they harmonize with the existing UI lighting.

---

## Trophies & Tiers (for badge art, separate pass)

These are the **16 trophies**. The tiered ones share one **10-rung ladder**; single-badge
ones are one-shot unlocks. (You can art the badges later — same dark-navy, sci-fi-drumming
look. Tier color cues below match the in-app badge colors.)

**The 10-rung ladder (used by every tiered trophy):**
`Iron → Bronze → Silver → Gold → Emerald → Ruby → Diamond → Platinum → Master → Grandmaster`

In-app tier colors (for consistency if you tint badges per tier):
Iron `#8a929b` · Bronze `#cd7f32` · Silver `#c0c0c0` · Gold `#ffd24a` · Emerald `#2ecc71`
· Ruby `#ff3b6b` · Diamond `#9fe7ff` · Platinum `#e6f2f8` · Master `#b06fff`
· Grandmaster iridescent rainbow.

| # | Trophy | Tiers | What it's for |
|---|--------|-------|---------------|
| 1 | **Kick Speed Demon** | 10-rung (120→240 BPM) | Highest tempo cleared with an A+ on Kick |
| 2 | **Snare Speed Demon** | 10-rung (120→240 BPM) | Highest tempo cleared with an A+ on Snare |
| 3 | **Mileage** | 10-rung (5→1000 runs) | Total runs played |
| 4 | **Iron Endurance** | 10-rung (30s→30 min) | Longest Sudden Death survival |
| 5 | **Woodshed** | 10-rung (1h→1000h) | Total time practiced |
| 6 | **Consistency** | 10-rung (3→100 days) | Consecutive days practiced |
| 7 | **Gauntlet Slayer** | 10-rung (1→100 clears) | Gauntlets cleared |
| 8 | **Full Spectrum** | 10-rung (3→41 tempos) | Distinct tempos scored B+ (of 41) |
| 9 | **Sharpshooter** | 10-rung (3→41 tempos) | Distinct tempos scored S+ (of 41) |
| 10 | **Untouchable** | 10-rung (1→41 tempos) | Distinct tempos scored SS (of 41) |
| 11 | **First Blood** | single | Complete your first run |
| 12 | **Perfectionist** | single | Land a 100%-green run |
| 13 | **Coordinated** | single | Log runs on both Kick and Snare |
| 14 | **Marathon** | single | A single run of 10+ minutes |
| 15 | **Grand Slam** | single | Earn SS on both Kick and Snare |
| 16 | **Gauntlet Champion** | single | Clear every Gauntlet level |

Icon shorthand currently in use (emoji placeholders to be replaced by your art):
🦵 Kick Speed · ✋ Snare Speed · 🥁 Mileage · 🔥 Iron Endurance · 🪵 Woodshed · 📅 Consistency ·
⚔️ Gauntlet Slayer · 🎚️ Full Spectrum · 🎯 Sharpshooter · 💎 Untouchable · ✅ First Blood ·
✨ Perfectionist · 🤹 Coordinated · ⏱️ Marathon · 🏅 Grand Slam · 👑 Gauntlet Champion

---

## Delivery checklist
- [ ] `rank-a.png`, `rank-s.png`, `rank-ss.png` — 1024×1024 transparent, consistent framing
- [ ] (later) 16 trophy badge arts, square transparent, same art language
