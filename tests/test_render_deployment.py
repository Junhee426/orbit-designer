from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_render_blueprint_contract():
    text = (ROOT / "render.yaml").read_text(encoding="utf-8")
    assert "runtime: docker" in text
    assert "region: singapore" in text
    assert "healthCheckPath: /health" in text
    assert "autoDeployTrigger: commit" in text
    assert "KLEO_SERVER_MODE" in text


def test_dockerfile_contract():
    text = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "FROM python:3.12-slim" in text
    assert "EXPOSE 10000" in text
    assert 'CMD ["kleo-server"]' in text
    assert "USER kleo" in text


def test_server_entrypoint_reads_render_port():
    text = (ROOT / "app" / "server.py").read_text(encoding="utf-8")
    assert '"PORT"' in text
    assert 'host="0.0.0.0"' in text
