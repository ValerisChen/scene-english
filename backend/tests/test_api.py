import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import get_enqueue
from app.config import Settings, get_settings
from app.db import Base, get_db
from app.demo_seed import seed_demo
from app.main import app
from app.models import Film
from app.pipeline.markup import markup_matches

FP = "a" * 64


@pytest.fixture
def client(tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)
    queued: list[tuple[int, str]] = []

    def db():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_settings] = lambda: Settings(storage_dir=tmp_path)
    app.dependency_overrides[get_enqueue] = lambda: lambda job_id, path: queued.append((job_id, path))
    with TestClient(app) as c:
        c.queued, c.Session = queued, Session
        yield c
    app.dependency_overrides.clear()


def test_create_film_is_idempotent_on_fingerprint(client):
    body = {"fingerprint": FP, "title": "Titanic", "duration_sec": 11640}
    first = client.post("/films", json=body).json()
    second = client.post("/films", json=body).json()
    assert first["id"] == second["id"]
    assert client.get(f"/films/by-fingerprint/{FP}").json()["title"] == "Titanic"
    assert client.get(f"/films/by-fingerprint/{'b' * 64}").status_code == 404


def test_upload_audio_queues_a_job(client, tmp_path):
    film = client.post("/films", json={"fingerprint": FP, "title": "Titanic"}).json()
    r = client.post(f"/films/{film['id']}/audio", files={"file": ("audio.m4a", b"fake-audio", "audio/mp4")})
    assert r.status_code == 202
    job = r.json()
    assert job["status"] == "queued"
    ((job_id, path),) = client.queued
    assert job_id == job["id"] and path.startswith(str(tmp_path))
    assert client.get(f"/jobs/{job_id}").json()["status"] == "queued"


def test_upload_rejects_unknown_format(client):
    film = client.post("/films", json={"fingerprint": FP, "title": "Titanic"}).json()
    r = client.post(
        f"/films/{film['id']}/audio", files={"file": ("movie.exe", b"x", "application/octet-stream")}
    )
    assert r.status_code == 415


def test_other_users_film_is_hidden(client):
    with client.Session() as s:
        s.add(Film(owner_id=2, fingerprint=FP, title="Someone else's"))
        s.commit()
    assert client.get(f"/films/by-fingerprint/{FP}").status_code == 404
    assert client.get("/films/1/scenes").status_code == 404


def test_scene_endpoints_with_demo_seed(client):
    with client.Session() as s:
        film = seed_demo(s, owner_id=1, fingerprint=FP, duration_sec=11640)
    scenes = client.get(f"/films/{film.id}/scenes").json()
    assert scenes[0]["word_count"] == 5
    detail = client.get(f"/scenes/{scenes[0]['id']}").json()
    assert detail["content"]["words"][0]["text"] == "let go"
    assert all(markup_matches(line["markup"], line["text"]) for line in detail["content"]["lines"])


def test_film_list_and_detail_include_latest_job(client):
    film = client.post("/films", json={"fingerprint": FP, "title": "Titanic"}).json()
    assert film["scene_count"] == 0 and film["latest_job"] is None
    client.post(f"/films/{film['id']}/audio", files={"file": ("a.webm", b"x", "audio/webm")})
    listed = client.get("/films").json()
    assert [f["id"] for f in listed] == [film["id"]]
    assert listed[0]["latest_job"]["status"] == "queued"
    assert client.get(f"/films/{film['id']}").json()["latest_job"]["status"] == "queued"
