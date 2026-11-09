#!/usr/bin/env python3
"""Lokalni pregled verzija (Windows/macOS/Linux). Pokreće se kroz verzija.cmd ili izravno:
    python scripts/verzija.py            – interaktivni izbornik
    python scripts/verzija.py v0.3.1     – odmah izdvoji i pokreni tu verziju
    python scripts/verzija.py radno      – pokreni radnu kopiju (trenutna grana)
Opcije: --port 8800  --bez-preglednika  --bez-fetcha
Verzije se čitaju iz commitova "release: vX.Y.Z" (ili tagova vX.Y.Z ako postoje)."""
import json, os, re, subprocess, sys, threading, webbrowser, pathlib, http.server, functools, socket

ROOT = pathlib.Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=pathlib.Path(__file__).parent, text=True).strip())
VDIR = ROOT / ".verzije"

def git(*a, check=True):
    return subprocess.run(["git", *a], cwd=ROOT, text=True, capture_output=True, check=check, encoding="utf-8", errors="replace").stdout

def fetch():
    print("Povlačim verzije s GitHuba…", end=" ", flush=True)
    r = subprocess.run(["git", "fetch", "--all", "--prune", "--tags"], cwd=ROOT, text=True, capture_output=True)
    print("ok" if r.returncode == 0 else f"neuspjelo ({r.stderr.strip()[:120]}) – nastavljam s lokalnim stanjem")

def versions():
    out = git("log", "--all", "--grep=^release: v[0-9]", "--format=%s%x09%H%x09%ad", "--date=short", check=False)
    seen, res = set(), []
    for line in out.splitlines():
        m = re.match(r"^release: (v\d+\.\d+\.\d+)[^\t]*\t([0-9a-f]+)\t(\S+)", line)
        if m and m.group(1) not in seen:
            seen.add(m.group(1)); res.append((m.group(1), m.group(2), m.group(3)))
    for t in git("tag", "--list", "v*", check=False).split():
        if re.fullmatch(r"v\d+\.\d+\.\d+", t) and t not in seen:
            res.append((t, git("rev-parse", t).strip(), "tag"))
    res.sort(key=lambda x: [int(n) for n in x[0][1:].split(".")], reverse=True)
    return res

def checkout(v, commit):
    d = VDIR / v
    if d.is_dir():
        return d
    VDIR.mkdir(exist_ok=True)
    git("worktree", "prune", check=False)
    subprocess.run(["git", "worktree", "add", "--detach", str(d), commit], cwd=ROOT, check=True, capture_output=True)
    return d

def files(base):
    out = []
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base)
        if p.is_file() and p.suffix in (".md", ".json", ".html") and not any(s.startswith(".") for s in rel.parts) \
           and "node_modules" not in rel.parts and rel.parts[0] != "site":
            out.append(rel.as_posix())
    return out

def index(vers):
    idx = {"radno": {"path": ".", "files": files(ROOT)}}
    for v, _, _ in vers:
        if (VDIR / v).is_dir():
            idx[v] = {"path": f".verzije/{v}", "files": files(VDIR / v)}
    (ROOT / "site").mkdir(exist_ok=True)
    (ROOT / "site" / "docs.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")

def free_port(start):
    for p in range(start, start + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return start

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()

def serve(port, v, open_browser):
    port = free_port(port)
    handler = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    base = f"http://localhost:{port}"
    vpath = "" if v == "radno" else f"/.verzije/{v}"
    print(f"\nVerzija: {v}")
    print(f"  Preglednik dokumentacije: {base}/site/?v={v}")
    if (ROOT / vpath.lstrip('/') / "prototip" / "index.html").is_file() if vpath else (ROOT / "prototip" / "index.html").is_file():
        print(f"  Prototip (WP0.5):         {base}{vpath}/prototip/index.html")
    print("\nPoslužitelj radi. Zatvori ovaj prozor ili pritisni Ctrl+C za prekid.")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(f"{base}/site/?v={v}")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

def main(argv):
    port = 8765; open_browser = True; do_fetch = True; pick = None
    it = iter(argv)
    for a in it:
        if a == "--port": port = int(next(it))
        elif a == "--bez-preglednika": open_browser = False
        elif a == "--bez-fetcha": do_fetch = False
        else: pick = a
    if do_fetch: fetch()
    vers = versions()
    if not vers:
        print("Nema release commitova."); return 1
    if pick is None:
        print("\nDostupne verzije:")
        print("  0) radna kopija (trenutna grana: %s)" % git("rev-parse", "--abbrev-ref", "HEAD").strip())
        for i, (v, c, d) in enumerate(vers, 1):
            mark = " (izdvojena)" if (VDIR / v).is_dir() else ""
            print(f"  {i}) {v}  {c[:7]}  {d}{mark}")
        try:
            ans = input("\nOdaberi broj (Enter = najnovija): ").strip()
        except EOFError:
            ans = ""
        pick = "radno" if ans == "0" else vers[int(ans) - 1][0] if ans.isdigit() and 0 < int(ans) <= len(vers) else vers[0][0]
    if pick != "radno":
        if not pick.startswith("v"): pick = "v" + pick
        match = [x for x in vers if x[0] == pick]
        if not match:
            print(f"Verzija {pick} ne postoji. Dostupne: {', '.join(v for v, _, _ in vers)}"); return 1
        checkout(pick, match[0][1])
    index(vers)
    serve(port, pick, open_browser)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
