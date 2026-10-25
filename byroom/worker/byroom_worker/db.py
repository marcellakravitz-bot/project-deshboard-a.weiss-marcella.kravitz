"""Database access for the worker (direct Postgres connection, service credentials from Secret Manager).

The worker writes only the uploaded/proposed layers: plan files, jobs, sources, review rows, views, maps.
It never writes byroom_rooms or byroom_room_finishes — those change only through byroom_approve_items().
"""
import contextlib
import json

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class DB:
    def __init__(self, url):
        self.url = url
        self.c = psycopg.connect(url, autocommit=True, row_factory=dict_row)

    def q(self, sql, *a):
        with self.c.cursor() as cur:
            cur.execute(sql, a)
            return cur.fetchall() if cur.description else None

    def one(self, sql, *a):
        r = self.q(sql, *a)
        return r[0] if r else None

    def now(self):
        return self.one("select now() as t")["t"]

    # ---------------------------------------------------------------- files / sets / jobs
    def file(self, fid):
        return self.one("select * from byroom_plan_files where id = %s", fid)

    def set(self, sid):
        return self.one("select * from byroom_plan_sets where id = %s", sid)

    def ready_files(self, sid):
        return self.q("select * from byroom_plan_files where set_id = %s and status = 'ready' order by created_at", sid)

    def file_status(self, fid, st):
        self.q("update byroom_plan_files set status = %s, error = null where id = %s and status <> 'removed'", st, fid)

    def file_ready(self, fid, derived, archive, detected):
        self.q("update byroom_plan_files set status = 'ready', derived_path = %s, archive_path = coalesce(%s, archive_path), "
               "detected = %s, error = null where id = %s and status <> 'removed'", derived, archive, Jsonb(detected), fid)

    def file_failed(self, fid, err):
        self.q("update byroom_plan_files set status = 'failed', error = %s where id = %s and status <> 'removed'", err, fid)

    def set_status(self, sid, st):
        self.q("update byroom_plan_sets set status = %s, updated_at = now() where id = %s", st, sid)

    def job_start(self, sid, fid, kind, version):
        import os
        return self.one("insert into byroom_parse_jobs (set_id, file_id, kind, status, worker_version, execution, started_at) "
                        "values (%s, %s, %s, 'running', %s, %s, now()) returning id",
                        sid, fid, kind, version, os.environ.get("CLOUD_RUN_EXECUTION"))["id"]

    def job_done(self, jid, integrity, warnings, metrics):
        self.q("update byroom_parse_jobs set status = 'done', finished_at = now(), integrity = %s, warnings = %s, metrics = %s where id = %s",
               Jsonb(integrity), Jsonb(warnings or []), Jsonb(metrics), jid)

    def job_failed(self, jid, err):
        self.q("update byroom_parse_jobs set status = 'failed', finished_at = now(), error = %s where id = %s", err, jid)

    def set_files_state(self, sid):
        r = self.one("select count(*) filter (where status in ('pending','uploading','uploaded','processing')) as busy, "
                     "count(*) filter (where status = 'ready') as ready from byroom_plan_files where set_id = %s and status <> 'removed'", sid)
        return r["busy"], r["ready"]

    @contextlib.contextmanager
    def set_lock(self, sid):
        """Blocking: a second cross-check of the same set waits for the first to finish."""
        self.q("select pg_advisory_lock(hashtext(%s))", "byroom:" + str(sid))
        try:
            yield True
        finally:
            self.q("select pg_advisory_unlock(hashtext(%s))", "byroom:" + str(sid))

    # ---------------------------------------------------------------- approved state (read only)
    def current_rooms(self, project_id, floor):
        rows = self.q("select * from byroom_rooms where project_id = %s and floor = %s", project_id, floor)
        out = {}
        for r in rows:
            fin = self.q("select kind, code from byroom_room_finishes where room_id = %s", r["id"])
            d = dict(r)
            d["finishes"] = {}
            for f in fin:
                d["finishes"].setdefault(f["kind"], []).append(f["code"])
            out[r["room_no"]] = d
        return out

    # ---------------------------------------------------------------- write the cross-check
    def write_crosscheck(self, s, res, job):
        sid = s["id"]
        with self.c.transaction():
            # earlier proposals of this set that were not approved are replaced; approved ones stay as history
            self.q("delete from byroom_room_review where set_id = %s and decision <> 'approved'", sid)
            self.q("delete from byroom_room_sources where set_id = %s", sid)
            self.q("delete from byroom_plan_views where set_id = %s", sid)
            self.q("delete from byroom_floor_maps where set_id = %s and not approved", sid)
            with self.c.cursor() as cur:
                cur.executemany(
                    "insert into byroom_room_sources (set_id, file_id, job_id, room_no, field, value, x, y, method, confidence) "
                    "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    [(sid, x["file_id"], job, x["room_no"], x["field"], x["value"], x["x"], x["y"], x["method"], x["confidence"])
                     for x in res["sources"]])
                cur.executemany(
                    "insert into byroom_room_review (set_id, project_id, floor, room_no, field, proposed, current, change_type, status, "
                    "rvt_verified, sources, note, decision) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    [(sid, s["project_id"], s["floor"], i["room_no"], i["field"], Jsonb(i["proposed"]), Jsonb(i["current"]),
                      i["change_type"], i["status"], i["rvt_verified"], Jsonb(i["sources"]), i["note"], i["decision"])
                     for i in res["items"]])
                cur.executemany(
                    "insert into byroom_plan_views (set_id, file_id, page, transform, method, fit_error, page_size) values (%s,%s,%s,%s,%s,%s,%s)",
                    [(sid, v["file_id"], v["page"], Jsonb(v["transform"]), v["method"], v["fit_error"], Jsonb(v["page_size"])) for v in res["views"]])
            if res["map"]:
                self.q("insert into byroom_floor_maps (set_id, project_id, floor, data) values (%s,%s,%s,%s)",
                       sid, s["project_id"], s["floor"], Jsonb(res["map"]))
            self.q("update byroom_plan_sets set status = 'review', processed_at = now(), updated_at = now(), "
                   "note = %s where id = %s", json.dumps({"warnings": res["warnings"], "summary": res["summary"]}, ensure_ascii=False), sid)
