from copy import deepcopy
from threading import RLock
from time import monotonic
from uuid import uuid4

from flask import Flask, render_template, request, jsonify
from werkzeug.exceptions import HTTPException, InternalServerError
from obst import (
    advance_obst_execution,
    advance_obst_tree_execution,
    initialize_obst_execution,
    reconstruct_boundary_tree,
    reverse_obst_execution,
    reverse_obst_tree_execution,
    start_obst_tree_execution,
    tree_search_path,
    tree_from_progress,
)

app = Flask(__name__)
execution_runs = {}
execution_runs_lock = RLock()
RUN_TTL_SECONDS = 3600


@app.get('/')
def index():
    return render_template('index.html')


def validate_records(records):
    if not isinstance(records, list):
        raise ValueError('Records must be a list.')
    clean_records = []
    seen = set()
    for i, item in enumerate(records):
        if not isinstance(item, dict):
            raise ValueError(f'Row {i + 1} must contain a key and frequency.')
        key = str(item.get('key', '')).strip()
        raw_frequency = item.get('frequency', '')
        if not key:
            raise ValueError(f'Row {i + 1}: key cannot be empty.')
        if key in seen:
            raise ValueError(f'Duplicate key: {key}. Keys must be unique.')
        seen.add(key)
        try:
            frequency = int(raw_frequency)
        except (TypeError, ValueError):
            raise ValueError(f'Frequency for key {key} must be a positive integer.')
        if frequency <= 0:
            raise ValueError(f'Frequency for key {key} must be greater than zero.')
        clean_records.append({'key': key, 'frequency': frequency})

    if not clean_records:
        raise ValueError('Add at least one key and frequency.')
    if len(clean_records) > 15:
        raise ValueError('For a clear visualization, use at most 15 keys.')
    if all(can_parse_number(row['key']) for row in clean_records):
        clean_records.sort(key=lambda row: float(row['key']))
    else:
        clean_records.sort(key=lambda row: row['key'].casefold())
    return clean_records


def get_json_payload():
    if not request.is_json:
        raise ValueError('Expected an application/json request body.')
    payload = request.get_json()
    if not isinstance(payload, dict):
        raise ValueError('The request body must be a JSON object.')
    return payload


def execution_response(run_id, state):
    keys = state['keys']
    active_interval = None
    if not state['completed']:
        i = state['interval_start']
        j = i + state['interval_length']
        active_interval = {
            'i': i,
            'j': j,
            'length': state['interval_length'],
            'left_key': keys[i],
            'right_key': keys[j - 1],
            'candidate_root': state['candidate_root'],
            'candidate_key': keys[state['candidate_root'] - 1],
            'best_cost': state['best_cost'],
            'best_root': state['best_root'],
            'best_root_key': keys[state['best_root'] - 1] if state['best_root'] is not None else None,
        }

    table_complete = state['completed']
    tree_complete = state['tree_completed']
    result = {
        'run_id': run_id,
        'records': [
            {'key': key, 'frequency': frequency}
            for key, frequency in zip(keys, state['frequencies'])
        ],
        'n': len(keys),
        'cost_table': deepcopy(state['cost_table']),
        'root_table': deepcopy(state['root_table']),
        'active_interval': active_interval,
        'last_evaluation': deepcopy(state['last_evaluation']),
        'evaluations': deepcopy(state['evaluations']),
        'last_finalized': deepcopy(state['last_finalized']),
        'steps_completed': state['steps_completed'],
        'total_steps': state['total_steps'],
        'can_previous': bool(state['history']),
        'table_completed': table_complete,
        'tree_started': state['tree_started'],
        'tree_steps': state['tree_steps'],
        'tree_queue_length': len(state['tree_queue']),
        'tree_can_previous': bool(state['tree_history']),
        'tree_completed': tree_complete,
        'completed': tree_complete,
        'tree_progress': deepcopy(state['tree_nodes']),
        'tree_expansions': deepcopy(state['tree_expansions']),
        'tree_last_operation': deepcopy(state['tree_last_operation']),
        'tree_initial_interval': (
            {'i': 0, 'j': len(keys), 'root_k': state['root_table'][0][len(keys)]}
            if state['tree_started'] else None
        ),
        'total_frequency': sum(state['frequencies']),
        'minimum_cost': state['cost_table'][0][len(keys)] if table_complete else None,
        'average_comparisons': (
            state['cost_table'][0][len(keys)] / sum(state['frequencies'])
            if table_complete else None
        ),
        'tree': (
            reconstruct_boundary_tree(keys, state['root_table'], 0, len(keys))
            if tree_complete else None
        ),
        'tree_progress_root': tree_from_progress(state['tree_nodes']),
    }
    return result


def expire_old_runs():
    now = monotonic()
    expired = [
        run_id for run_id, run in execution_runs.items()
        if now - run['last_access'] > RUN_TTL_SECONDS
    ]
    for run_id in expired:
        del execution_runs[run_id]


def find_run(payload):
    run_id = payload.get('run_id')
    if not isinstance(run_id, str) or not run_id:
        raise ValueError('A valid run_id is required.')
    with execution_runs_lock:
        expire_old_runs()
        run = execution_runs.get(run_id)
        if run is None:
            return None, run_id
        run['last_access'] = monotonic()
        return run, run_id


@app.post('/api/obst/initialize')
def initialize_obst():
    try:
        payload = get_json_payload()
        clean_records = validate_records(payload.get('records', []))
        keys = [row['key'] for row in clean_records]
        frequencies = [row['frequency'] for row in clean_records]
        state = initialize_obst_execution(keys, frequencies)
        run_id = uuid4().hex
        with execution_runs_lock:
            expire_old_runs()
            execution_runs[run_id] = {'state': state, 'last_access': monotonic()}
        return jsonify(execution_response(run_id, state))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400


@app.post('/api/obst/step')
def step_obst():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            advance_obst_execution(run['state'])
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, run['state']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        app.logger.exception('OBST execution dependency error')
        return jsonify({'error': str(exc)}), 500


@app.post('/api/obst/previous')
def previous_obst_step():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            reverse_obst_execution(run['state'])
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, run['state']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400


@app.post('/api/obst/build-tree')
def build_obst_tree():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            start_obst_tree_execution(run['state'])
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, run['state']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400


@app.post('/api/obst/tree-step')
def step_obst_tree():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            advance_obst_tree_execution(run['state'])
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, run['state']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        app.logger.exception('OBST tree construction error')
        return jsonify({'error': str(exc)}), 500


@app.post('/api/obst/tree-complete')
def complete_obst_tree():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            state = run['state']
            if not state['tree_started']:
                return jsonify({'error': 'Build the tree phase before completing it.'}), 400
            while not state['tree_completed']:
                advance_obst_tree_execution(state)
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, state))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        app.logger.exception('OBST tree construction error')
        return jsonify({'error': str(exc)}), 500


@app.post('/api/obst/tree-previous')
def previous_obst_tree_step():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            reverse_obst_tree_execution(run['state'])
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, run['state']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400


@app.post('/api/obst/reset')
def reset_obst():
    try:
        payload = get_json_payload()
        with execution_runs_lock:
            run, run_id = find_run(payload)
            if run is None:
                return jsonify({'error': 'This execution has expired or does not exist. Start a new run.'}), 404
            if 'records' in payload:
                records = validate_records(payload['records'])
                keys = [record['key'] for record in records]
                frequencies = [record['frequency'] for record in records]
            else:
                keys = run['state']['keys']
                frequencies = run['state']['frequencies']
            run['state'] = initialize_obst_execution(keys, frequencies)
            run['last_access'] = monotonic()
            return jsonify(execution_response(run_id, run['state']))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400


def can_parse_number(value):
    try:
        float(value)
        return True
    except ValueError:
        return False


@app.post('/api/search')
def search_key():
    if not request.is_json:
        return jsonify({'error': 'Expected an application/json request body.'}), 400
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify({'error': 'The request body must be a JSON object.'}), 400
    tree = payload.get('tree')
    target = str(payload.get('target', '')).strip()
    if not target:
        return jsonify({'error': 'Enter a key to search for.'}), 400
    if not isinstance(tree, dict) or 'key' not in tree:
        return jsonify({'error': 'Build a valid search tree before searching.'}), 400
    path, found = tree_search_path(tree, target)
    return jsonify({'target': target, 'path': path, 'found': found})


@app.errorhandler(HTTPException)
def handle_http_error(error):
    # Keep API 404/405 and malformed-request responses parseable by fetch clients.
    if request.path.startswith('/api/'):
        return jsonify({'error': error.description}), error.code or 500
    return error


@app.errorhandler(InternalServerError)
def handle_internal_server_error(error):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'An unexpected server error occurred.'}), 500
    return error


if __name__ == '__main__':
    app.run(debug=True)
