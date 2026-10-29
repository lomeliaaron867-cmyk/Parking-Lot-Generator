from fastapi.testclient import TestClient
import pytest
from backend.app import app, MAX_BODY
from test_solver import example

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c: yield c

def test_health_and_solve(client):
    assert client.get('/api/health').json()['engine']=='python-shapely'
    response=client.post('/api/solve',json={'settings':example()})
    assert response.status_code==200, response.text
    assert response.json()['engine']=='python-shapely'
    assert response.json()['layout']['stalls']

def test_alternatives(client):
    response=client.post('/api/alternatives',json={'settings':example('curved-drive')})
    assert response.status_code==200, response.text
    assert len(response.json()['options'])==6

def test_validation_and_body_limit(client):
    assert client.post('/api/solve',content='invalid json').status_code==422
    assert client.post('/api/solve',json={'settings':{}}).status_code==422
    assert client.post('/api/solve',content=' '* (MAX_BODY+1)).status_code==413
    assert client.get('/api/unknown').status_code==404

def test_admission_limit(client):
    app.state.active=2
    try:
        response=client.post('/api/solve',json={'settings':example()})
        assert response.status_code==503
        assert response.headers['retry-after']=='2'
    finally: app.state.active=0

def test_static_build_when_present(client):
    response=client.get('/')
    assert response.status_code in (200,503)
    if response.status_code==200: assert '<div id="root">' in response.text

def test_worker_failure_recovers(client, monkeypatch):
    # A completed failed future exercises error handling for either executor.
    from concurrent.futures import Future
    def failed_submit(*args, **kwargs):
        future = Future()
        future.set_exception(RuntimeError('simulated worker failure'))
        return future
    with monkeypatch.context() as patch:
        patch.setattr(app.state.pool, 'submit', failed_submit)
        response = client.post('/api/solve', json={'settings': example()})
        assert response.status_code == 500
        assert 'simulated' not in response.text
    response = client.post('/api/solve', json={'settings': example()})
    assert response.status_code == 200
    assert app.state.active == 0

def test_executor_configuration(monkeypatch):
    from backend.app import create_executor
    from concurrent.futures import ThreadPoolExecutor
    monkeypatch.setenv('PARKING_EXECUTOR', 'thread')
    with create_executor() as pool:
        assert isinstance(pool, ThreadPoolExecutor)
        assert pool.submit(sum, [1, 2]).result() == 3
    monkeypatch.setenv('PARKING_EXECUTOR', 'invalid')
    with pytest.raises(ValueError, match='PARKING_EXECUTOR'):
        create_executor()
