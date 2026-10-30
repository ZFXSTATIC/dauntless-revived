# Fetches the pinned Dauntless 1.4.4 tree from the public CDN, hash-checked per file. Safe to re-run.
import hashlib, json, os, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
urllib.request.install_opener((lambda o: (o.addheaders.clear(), o.addheaders.append(("User-Agent","Mozilla/5.0 (X11; Linux x86_64)")), o)[2])(urllib.request.build_opener()))
BASE = os.environ.get("DR_GAME_BASE_URL", "https://dr-dl.afterlifeinteractive.com/dauntless-1.4.4/")
DEST = sys.argv[1] if len(sys.argv) > 1 else "/srv/dauntless/BaseGame144/Dauntless/"
m = json.load(urllib.request.urlopen(BASE + "manifest.json", timeout=60))
files = m["files"]
print("files", len(files), "bytes", m.get("totalBytes"), flush=True)
def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
def get(f):
    p = os.path.join(DEST, f["path"])
    if os.path.isfile(p) and os.path.getsize(p) == f["size"] and sha(p) == f["sha256"]:
        return "ok"
    os.makedirs(os.path.dirname(p), exist_ok=True)
    url = BASE + "/".join(urllib.parse.quote(x) for x in f["path"].split("/"))
    for attempt in range(5):
        try:
            tmp = p + ".part"
            with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as o:
                while True:
                    b = r.read(1 << 20)
                    if not b: break
                    o.write(b)
            if sha(tmp) != f["sha256"]:
                raise ValueError("hash mismatch")
            os.replace(tmp, p)
            return "got"
        except Exception as e:
            err = str(e)
    return "FAIL " + f["path"] + " " + err
bad = 0; n = 0
with ThreadPoolExecutor(8) as ex:
    for res in ex.map(get, files):
        n += 1
        if res.startswith("FAIL"): bad += 1; print(res, flush=True)
        if n % 200 == 0: print("done", n, flush=True)
print("FETCH-EXIT", bad, flush=True)
