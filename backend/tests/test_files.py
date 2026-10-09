"""Файлы к задачам: QR-код получения, фото, PDF — по подписанной ссылке, только своей семье."""

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app
from app.services import files

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
PDF = b"%PDF-1.4 test"


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as test_client:
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login(client: TestClient, phone: str) -> str:
    check = client.post("/api/v1/auth/phone/start", json={"phone": phone, "consent": True}).json()
    return client.get(f"/api/v1/auth/phone/status/{check['check_id']}").json()["token"]


@pytest.fixture
def family(client: TestClient) -> dict[str, str]:
    mom = client.post(
        "/api/v1/families", json={"member_name": "Мама"}, headers=auth(login(client, "79990003001"))
    ).json()
    code = client.get("/api/v1/family", headers=auth(mom["token"])).json()["invite_code"]
    dad = client.post(
        f"/api/v1/invites/{code}/join",
        json={"member_name": "Папа"},
        headers=auth(login(client, "79990003002")),
    ).json()
    task = client.post(
        "/api/v1/tasks", json={"title": "Забрать с Озона"}, headers=auth(mom["token"])
    ).json()
    return {"mom": mom["token"], "dad": dad["token"], "task": task["id"]}


def upload(client: TestClient, token: str, task_id: str, data: bytes, kind: str, name="код.png"):
    return client.post(
        f"/api/v1/tasks/{task_id}/files", files={"upload": (name, data, kind)}, headers=auth(token)
    )


def test_attach_view_and_detach(client: TestClient, family: dict[str, str]) -> None:
    response = upload(client, family["mom"], family["task"], PNG, "image/png")
    assert response.status_code == 201
    [file] = response.json()["files"]
    assert (file["name"], file["content_type"], file["size"]) == ("код.png", "image/png", len(PNG))

    # Исполнитель видит файл в задаче и открывает по ссылке
    tasks = client.get("/api/v1/tasks", headers=auth(family["dad"])).json()
    assert tasks[0]["files"][0]["url"] == file["url"]
    shown = client.get(file["url"])
    assert shown.status_code == 200 and shown.content == PNG
    # Без подписи или с чужой — нельзя
    assert client.get(f"/api/v1/files/{file['id']}").status_code == 404
    assert client.get(f"/api/v1/files/{file['id']}?sig=0000").status_code == 404

    # Удалить может тот, кто прикрепил (или автор); исполнитель — нет
    url = f"/api/v1/tasks/{family['task']}/files/{file['id']}"
    assert client.delete(url, headers=auth(family["dad"])).status_code == 403
    assert client.delete(url, headers=auth(family["mom"])).json()["files"] == []
    assert client.get(file["url"]).status_code == 404


def test_rejects_bad_files(client: TestClient, family: dict[str, str]) -> None:
    task = family["task"]
    assert upload(client, family["mom"], task, b"MZ\x90", "image/png").status_code == 415
    assert upload(client, family["mom"], task, b"hello", "text/plain").status_code == 415
    big = PDF + b"0" * files.MAX_BYTES
    assert upload(client, family["mom"], task, big, "application/pdf").status_code == 413
    for _ in range(files.MAX_PER_TASK):
        assert (
            upload(client, family["dad"], task, PDF, "application/pdf", "чек.pdf").status_code
            == 201
        )
    assert upload(client, family["dad"], task, PDF, "application/pdf").status_code == 409


def test_deleting_task_removes_files(client: TestClient, family: dict[str, str]) -> None:
    file = upload(client, family["mom"], family["task"], PNG, "image/png").json()["files"][0]
    client.delete(f"/api/v1/tasks/{family['task']}", headers=auth(family["mom"]))
    assert client.get(file["url"]).status_code == 404
    assert not (files.storage_dir() / file["id"]).exists()
