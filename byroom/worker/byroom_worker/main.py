"""Entry point of the By Room processing job.

Cloud Run Job (environment):
  MODE=parse      FILE_ID=<uuid>   read one uploaded file, then cross-check its set if every file is ready
  MODE=crosscheck SET_ID=<uuid>    cross-check a set again (after a file was removed, say)
  DATABASE_URL, WORK_BUCKET, ARCHIVE_BUCKET

Local test (no cloud, no database):
  python -m byroom_worker.main local --out DIR  FL:dxf:path  FL:pdf:path  MODEL:rvt:path ...
"""
import argparse
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import traceback

from . import VERSION, crosscheck, extract


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# --------------------------------------------------------------------------- local
def local(args):
    os.makedirs(args.out, exist_ok=True)
    files = []
    for spec in args.files:
        ptype, fmt, path = spec.split(":", 2)
        name = os.path.basename(path)
        cache = os.path.join(args.out, name + ".json")
        if os.path.exists(cache) and not args.fresh:
            data = json.load(open(cache))
            log("cached", name)
        else:
            log("extract", name)
            data = extract.extract(path, fmt)
            json.dump(data, open(cache, "w"), ensure_ascii=False)
            log("  ", data["integrity"], data["warnings"])
        files.append({"id": name, "plan_type": ptype, "format": fmt, "name": name, "data": data})
    defined = json.load(open(args.marks)) if getattr(args, "marks", None) else None
    res = crosscheck.run(files, current={}, defined=defined)
    json.dump(res, open(os.path.join(args.out, "result.json"), "w"), ensure_ascii=False, indent=1)
    log("summary", json.dumps(res["summary"], ensure_ascii=False))
    for w in res["warnings"]:
        log("warning:", w)


# --------------------------------------------------------------------------- cloud
def _download(storage, bucket, obj, dst, gz):
    blob = storage.bucket(bucket).blob(obj)
    raw = dst + ".part"
    blob.download_to_filename(raw)
    h = hashlib.sha256()
    if gz:
        with gzip.open(raw, "rb") as src, open(dst, "wb") as out:
            for chunk in iter(lambda: src.read(8 << 20), b""):
                h.update(chunk); out.write(chunk)
        os.remove(raw)
    else:
        os.replace(raw, dst)
        with open(dst, "rb") as f:
            for chunk in iter(lambda: f.read(8 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


def parse(db, storage, file_id):
    f = db.file(file_id)
    job = db.job_start(f["set_id"], file_id, "parse", VERSION)
    tmp = tempfile.mkdtemp(prefix="byroom-")
    try:
        db.file_status(file_id, "processing")
        path = os.path.join(tmp, "src." + f["format"])
        log("download", f["object_path"], f["size_bytes"])
        digest = _download(storage, os.environ["WORK_BUCKET"], f["object_path"], path, f["gzip_in_transit"])
        if f["sha256"] and digest != f["sha256"]:
            raise RuntimeError("הקובץ שהגיע שונה מהקובץ שנבחר (טביעת אצבע לא תואמת) — יש להעלות אותו שוב")
        log("extract", f["format"])
        data = extract.extract(path, f["format"])
        derived = f"derived/{f['set_id']}/{file_id}.json.gz"
        storage.bucket(os.environ["WORK_BUCKET"]).blob(derived).upload_from_string(
            gzip.compress(json.dumps(data, ensure_ascii=False).encode()), content_type="application/gzip")
        archive = None
        if f["format"] == "pdf":
            archive = f"pdf/{f['project_id']}/{f['set_id']}/{file_id}.pdf"
            storage.bucket(os.environ["ARCHIVE_BUCKET"]).blob(archive).upload_from_filename(path, content_type="application/pdf")
        detected = dict(f["detected"] or {})
        detected["content_hint"] = data.get("content_hint")
        if data.get("code_kinds"):
            detected["code_kinds"] = data["code_kinds"]
        if f["format"] == "pdf" and data.get("page"):
            detected["dates"] = data["page"].get("dates", [])[:10]
            detected["revisions"] = data["page"].get("revisions", [])
        if f["format"] == "rvt":
            detected["model"] = data.get("info")
        db.file_ready(file_id, derived, archive, detected)
        db.job_done(job, data.get("integrity"), data.get("warnings"), {"sec": data["integrity"].get("extract_sec")})
        log("ready", file_id)
    except Exception as ex:
        traceback.print_exc()
        db.file_failed(file_id, str(ex)[:500])
        db.job_failed(job, str(ex)[:2000])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    maybe_crosscheck(db, storage, f["set_id"])


def maybe_crosscheck(db, storage, set_id):
    """Cross-check once every file of the set is read. Cross-checks of one set never overlap: each waits for the
    database lock. A job that finishes while another is cross-checking waits, then cross-checks again — so the
    last file to finish is always included."""
    busy, ready = db.set_files_state(set_id)
    if busy:
        log("set not complete yet")
        return
    if not ready:                         # every file failed: say so instead of waiting forever
        db.set_status(set_id, "failed")
        return
    run_crosscheck(db, storage, set_id)


def run_crosscheck(db, storage, set_id):
    with db.set_lock(set_id):
        _run_crosscheck(db, storage, set_id)


def _run_crosscheck(db, storage, set_id):
    job = db.job_start(set_id, None, "crosscheck", VERSION)
    try:
        s = db.set(set_id)
        files = []
        for f in db.ready_files(set_id):
            blob = storage.bucket(os.environ["WORK_BUCKET"]).blob(f["derived_path"])
            data = json.loads(gzip.decompress(blob.download_as_bytes()))
            files.append({"id": f["id"], "plan_type": f["plan_type"], "format": f["format"], "name": f["original_name"],
                          "file_date": (f["detected"] or {}).get("file_date"), "data": data})
        current = db.current_rooms(s["project_id"], s["floor"])
        res = crosscheck.run(files, current, s, defined=db.defined_marks(s["project_id"]))
        db.write_crosscheck(s, res, job)
        db.job_done(job, res["summary"], res["warnings"], None)
        log("cross-check", json.dumps(res["summary"], ensure_ascii=False))
    except Exception as ex:
        traceback.print_exc()
        db.job_failed(job, str(ex)[:2000])
        db.set_status(set_id, "failed")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    lp = sub.add_parser("local")
    lp.add_argument("--out", required=True)
    lp.add_argument("--fresh", action="store_true")
    lp.add_argument("--marks", help="JSON {code: category} — the project's defined marks")
    lp.add_argument("files", nargs="+")
    a = ap.parse_args(argv)
    if a.cmd == "local":
        return local(a)

    from google.cloud import storage as gcs
    from .db import DB
    db = DB(os.environ["DATABASE_URL"])
    st = gcs.Client()
    mode = os.environ.get("MODE", "parse")
    if mode == "parse":
        parse(db, st, os.environ["FILE_ID"])
    elif mode == "crosscheck":
        run_crosscheck(db, st, os.environ["SET_ID"])
    else:
        sys.exit(f"unknown MODE {mode}")


if __name__ == "__main__":
    main()
