# **Game Metronome — FAQ**

Game Metronome turns metronome practice into a game. You play along to a precise click, and the app grades your timing in real time, hands you a rank, awards trophies, and drops you onto a global leaderboard. It runs right in your browser — no download needed.

---

## **Getting Started**

**What is Game Metronome?** It's a web app that makes metronome practice playable. You drum along to a click, it measures how tight your timing is, ranks you from E up to SS, and tracks trophies and a leaderboard.

**Do I need to install anything?** No. It runs in any modern browser. Desktop Chrome, Edge, or Firefox, plus Android Chrome and iOS Safari/Chrome all work for the metronome and audio-based Game Mode.

**What do I need to play Game Mode?** A way to feed your hits into the app: either MIDI (an electronic kit or trigger over USB) or audio (a mic or audio interface on any drum — acoustic, mesh pad, or practice pad). MIDI gives the best, most consistent accuracy; audio works everywhere, including iOS.

**Which drums can I play right now?** Kick drum and snare drum only, for now. Each has its own separate leaderboard, so your kick runs and snare runs are ranked independently.

---

## **Game Modes**

**Time Trial** Pick a BPM (50–250, in steps of 5) and a duration in minutes, then play the whole time. You're graded purely on accuracy — the percentage of your hits that land inside the green timing window. Rank runs E → D → C → B → A → S → SS.

**Sudden Death** Same BPM and duration setup, but one bad beat ends the run instantly. The Sudden Death leaderboard now also shows a **Best Rank** column alongside Survived %, but that's secondary — your endurance is still what sets your leaderboard position.

**Gauntlet** Six levels, each a BPM range, each played as sudden death (miss one beat, the run ends):

1. Level 1 — 80–100 BPM  
2. Level 2 — 100–120 BPM  
3. Level 3 — 120–140 BPM  
4. Level 4 — 140–160 BPM  
5. Level 5 — 160–180 BPM  
6. Level 6 — 180–200 BPM

Pick any level you want — there's no need to climb them in order.

---

## **Scoring & Ranks**

**How does ranking work?** Ranks go E (lowest) → D → C → B → A → S → SS (highest). At the end of every run you get an animated rank emblem reveal with sound. What earns the rank depends on the mode: Time Trial ranks on accuracy, while Sudden Death and Gauntlet rank on endurance.

**What's the "green window"?** It's the good timing band around each note. A hit that lands inside it counts as on-time. In Time Trial, your rank is the percentage of hits that fall in that window — so the goal is consistency.

**Why is my leaderboard rank different from what I expected?** The leaderboard shows your personal best for that exact slice — mode, BPM (or Gauntlet level), and instrument — not an average of your runs. And only valid runs count toward it.

**What's the hit timeline on my result card?** It's a practice tool that shows you exactly where in your run your timing drifted. After any run, click **Show hit timeline** to open a chart plotting every evaluated 16th note from start to finish, with how early or late each hit landed. Dots are colour-coded — green for in the pocket, yellow and orange for being off the grid, red for badly timed or dropped notes. The timeline appears for all three modes and stays collapsed until you open it.

---

## **Trophies**

**What are trophies?** There are 16 trophies, most with a 10-rung ladder: Iron → Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster, and beyond. They cover things like streak milestones, reaching certain ranks, playing at high BPMs, and clearing Gauntlet levels.

Some trophies are unique and only have 1 tier.

**How do I earn them?** You progress them by playing. When you unlock or level up a trophy, it pops up one at a time on the result screen. You can see all 16 and your current tier on the Stats & Leaderboard page under the Trophies tab.

---

## **Input & Hardware**

**Should I use MIDI or audio?** MIDI if you can — it's the most accurate, with minimal and consistent latency. Audio is the universal option: it works on every platform (including iOS, which MIDI doesn't) and with any drum a mic or interface can pick up.

**How do I set up MIDI?**

1. Connect your e-drum kit or MIDI trigger over USB.  
2. Select your drum.  
3. Click **Connect MIDI** and select your device.  
4. Click **Learn Note** and hit the drum you want to use.  
5. The app learns that note and listens for it from then on.

MIDI works on desktop Chrome, Edge, and Firefox, plus Android Chrome. It does **not** work on Safari. So Apple users will need a Mac running with Chrome or Brave browser.

**Examples of Supported hardware**  
Any e-drum module with USB MIDI output - Roland, Yamaha, Alesis, Gewa, Pearl, Carlsbro.

Any trigger modules with USB MIDI output - Roland TM-1, eDRUMin, Alesis sample pad, ddrum DDTI, Yamaha EAD10, EAD50.

**How do I set up audio (mic / interface)?**

1. Click **Enable mic / interface** and allow the microphone permission when your browser asks.  
2. Play a few hits and adjust your interface's gain until the meter lands in the green zone.  
3. Click on **Sensitivity** and play strokes for 8s to check if the app registers them cleanly.  
4. Every hit should register a hit.  
5. If you strike your drum once and see 0 hits - the gain is too low.  
6. If you strike your drum once and see multiple hits - the gain is too high.

This works with acoustic kick, snare, practice pads, using a mic.

**You must calibrate to play.** Calibration measures your system latency offset — the delay between you hearing the click, hitting the drum and the app registering it. It's Step 3 in Game Mode:

1. **Quarters (required)** — play quarter notes to the click for 8 bars so the app can measure your average offset.  
2. **16ths (optional)** — refine it further with sixteenth notes for a sharper result.  
3. **Manual offset** — if you already know your offset, skip the calibration and just type it in milliseconds.

**My timing drifts on a laptop — what helps?**  
Make sure it's plugged into power. If you can't - Turn on **Auto Latency Correction** in ⚙️ Settings (it's off by default). It gently eases your calibration by ±50ms over time, which helps on laptops where audio latency shifts with power state.

Having your audio output from your e-drums/audio interface will eliminate the latency shifts.

---

## **Account**

**How do I sign in?** Sign in with Google. Your session sticks across visits on the same browser. You need to be signed in to play the game mode.

**Where do I see my stats and the leaderboard?** Open the **Stats & Leaderboard ▸** link inside Game Mode beside your sign-in profile name, and it opens in a new tab. The Personal tab shows your run history, best ranks, and streaks; the Global tab shows the top-100 leaderboard filtered by mode, BPM, Gauntlet level, and instrument; the Trophies tab shows all 16 with your current tier.

**Can I change my leaderboard name or avatar?** Yes — the ⚙️ Settings panel lets you set a custom display name and avatar, so you can personalise your leaderboard identity without touching your Google account. Whatever you set overrides your Google name and picture everywhere in the app: the global leaderboard, your personal stats, and your profile.

**How do I send feedback or report a bug?** At the bottom of the ⚙️ Settings panel, tap **Provide Feedback ↗**. You can also request for features here!

---

## **Troubleshooting**

**My timing feels off.** Run calibration again. On a laptop, make sure it's plugged in to power, and not running on power-saver modes. Also try Auto Latency Correction in ⚙️ Settings.

**MIDI won't connect.** Check that your browser has MIDI permission and that your device is detected by your computer. If you're on an iPhone or iPad, MIDI isn't supported there at all — switch to the audio input method instead.

**My mic isn't triggering, or it's triggering on everything.** Re-do the sensitivity setup: play a few hits and adjust until the meter sits in the green zone, and that you register exactly 1 hit for each stroke you play. Also confirm your browser actually has microphone permission, and you selected the correct microphone.

**The Stats page says I'm signed out even though I'm signed in.** Hard-refresh the page with Ctrl+Shift+R. Then sign in again.

**My screen keeps dimming while I practise.** Turn on **Keep screen awake** in ⚙️ Settings and it'll stop dimming during your session.

**My leaderboard rank looks wrong.** It's showing your personal best for that specific mode / BPM / instrument, not an average. So a single great run sets your spot; a rough one won't drag it down.
