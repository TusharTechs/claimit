# Local neural narration (Kokoro, open weights): no account, nothing leaves this machine.
#   uv run --python 3.12 --with kokoro-onnx --with soundfile python tts.py <lines.json> <outdir> [voice] [speed]
import json, sys, os
import soundfile as sf
from kokoro_onnx import Kokoro

lines = json.load(open(sys.argv[1]))
out = sys.argv[2]; os.makedirs(out, exist_ok=True)
voice = sys.argv[3] if len(sys.argv) > 3 else 'af_heart'
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
k = Kokoro(os.path.join(os.path.dirname(__file__), 'models/kokoro-v1.0.onnx'), os.path.join(os.path.dirname(__file__), 'models/voices-v1.0.bin'))
meta = []
for l in lines:
    samples, sr = k.create(l['text'], voice=voice, speed=speed, lang='en-us')
    p = os.path.join(out, l['id'] + '.wav')
    sf.write(p, samples, sr)
    meta.append({'id': l['id'], 'sec': round(len(samples) / sr, 3)})
    print(l['id'], meta[-1]['sec'])
json.dump(meta, open(os.path.join(out, 'durations.json'), 'w'))
