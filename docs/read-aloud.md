# Read-aloud voices with Kokoro

Den Duty reads chores, routine steps, the den message, weather, money jars and Judge Trash Panda's verdicts out loud with a 🔊 button. Out of the box that's the tablet's own voice, which can sound robotic. If you run [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small open-source text-to-speech model, Den Duty can read with one of its natural-sounding voices instead, on every tablet and phone.

## 1. Run Kokoro

The easiest server is [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI). It runs fine on a CPU; a GPU makes it faster. With Docker Compose, next to Den Duty:

```yaml
  kokoro:
    image: ghcr.io/remsky/kokoro-fastapi-cpu:latest   # or kokoro-fastapi-gpu with an NVIDIA GPU
    container_name: kokoro
    restart: unless-stopped
    ports:
      - "8880:8880"
```

On Unraid, add a container from `ghcr.io/remsky/kokoro-fastapi-cpu:latest` and map port 8880.

Any server with the same OpenAI-style endpoints (`POST /v1/audio/speech`, `GET /v1/audio/voices`) works too.

## 2. Link it

In **Settings → Read-aloud voice**, paste Kokoro's address (e.g. `http://192.168.1.10:8880`, or `http://kokoro:8880` when both run in the same Compose file) and press **Save**. Pick a voice from the list, press **▶ Try it** to hear it, then **Use this voice**. If your Kokoro sits behind a proxy that wants a key, paste it in the key box; it's stored encrypted and never sent to the tablets.

Only Den Duty's server talks to Kokoro, so tablets don't need to reach it. The text that's read goes to your Kokoro server and nowhere else.

## How it behaves

- **Languages**: English boards use the voice you picked. Spanish and French boards use Kokoro's voice for that language (Dora for Spanish, Siwis for French) when your server has one, and the tablet's own voice otherwise.
- **If Kokoro is down** or slow, the tablet's own voice reads instead, so the 🔊 button always says something.
- **Caching**: the same words in the same voice are only made once; chore titles and routine steps play straight away after the first time.
- **Turning it off**: **Use device voice** in the same card unlinks Kokoro.

Home Assistant voice answers (see [voice.md](voice.md)) are spoken by Home Assistant's own text-to-speech, so pick Kokoro there if you want the same voice from your speakers.
