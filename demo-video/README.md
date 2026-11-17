# The demo film

The demo video is made from the live app, not from mock-ups. One script drives six real browsers at once (the seller's
laptop, four buyer phones and the operator page), records every screen at device resolution, and writes down what
Nexconn and the server said to each other while it happened. The edit then lines everything up on one clock.

Nothing about the outcome is scripted: three phones tap Claim in the same instant, and the script reads the winner off
the screens and follows whoever it turned out to be.

| Step | Command | What it does |
|---|---|---|
| Record | `BASE=https://… ADMIN_KEY=… RUN=take1 npx tsx record.ts` | Runs the whole story on a running ClaimIt and saves timestamped frames, the SDK trace from each browser (`web/src/rt.ts` `trace`), and the server's Nexconn activity log (`/api/admin/nexconn`). |
| Assemble | `npx tsx assemble.ts take1` | Turns each screen's frames into a 30 fps video on the shared timeline. |
| Narrate | `cd voice && uv run --python 3.12 --with kokoro-onnx --with soundfile python tts.py ../src/vo.json ../public/vo` | Generates the narration locally with the open Kokoro voice model (put `kokoro-v1.0.onnx` and `voices-v1.0.bin` in `voice/models`). |
| Score | `npx tsx cues.ts`, then `cd voice && uv run --python 3.12 --with numpy --with scipy --with soundfile python score.py ../raw/cues.json ../public/music.wav` (and `sfx.py ../public/sfx` once) | Writes the cue sheet from the edit's own timeline and synthesises the music and sound effects against it: the score stops on "Who was first?", holds its breath for the race, and lands a hit when the winner does. No samples, nothing licensed. |
| Prepare | `npx tsx prepare.ts take1` | Collects marks, facts, traces, activity, narration lengths and the real test output into `src/data.json`. |
| Render | `npx remotion render src/index.ts Demo out/claimit-demo.mp4` | Renders the film (Remotion). |

Sound effects are placed from the same data as the picture (`src/sounds.ts`): each buyer's pop is their real
`OpenChannel.enterChannel()`, each dull "no" in the scam scene is a message that browser really sent. To re-score without
re-rendering the picture: `npx remotion render src/index.ts Demo out/audio.wav --codec=wav --props='{"audioOnly":true}'`
and mux it onto the existing video with ffmpeg.

Every number on screen (API calls, webhooks, round-trip times, tap timings, test results) is read from that take's
data, and the test output shown is the real output of `npm run test:race`, `test:billing` and `test:webhooks`.
