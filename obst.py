"""Frequency-based Optimal Binary Search Tree using Dynamic Programming.

This simplified formulation handles successful searches only. The objective is
minimize sum(frequency[key] * depth(key)), with the root at depth 1.
"""

from copy import deepcopy


def initialize_obst_execution(keys, frequencies):
    """Initialize C(i,j) for keys with one-based positions i+1 through j.

    A subproblem C(i,j) contains keys[i:j]. Root choices are stored as the
    one-based k used by C(i,j) = min(C(i,k-1) + C(k,j)) + w(i,j).
    """
    n = len(keys)
    if n != len(frequencies):
        raise ValueError('keys and frequencies must have the same length')
    if n == 0:
        raise ValueError('At least one key is required')

    total_steps = sum(length * (n - length + 1) for length in range(2, n + 1))
    cost_table = [[None] * (n + 1) for _ in range(n + 1)]
    root_table = [[None] * (n + 1) for _ in range(n + 1)]
    for boundary in range(n + 1):
        cost_table[boundary][boundary] = 0
    for index, frequency in enumerate(frequencies):
        cost_table[index][index + 1] = frequency
        root_table[index][index + 1] = index + 1

    return {
        'keys': list(keys),
        'frequencies': list(frequencies),
        'cost_table': cost_table,
        'root_table': root_table,
        'interval_length': 2,
        'interval_start': 0,
        'candidate_root': 1,
        'best_cost': None,
        'best_root': None,
        'last_evaluation': None,
        'last_finalized': None,
        'evaluations': [],
        'steps_completed': 0,
        'total_steps': total_steps,
        'completed': total_steps == 0,
        'history': [],
        'tree_started': False,
        'tree_completed': False,
        'tree_queue': [],
        'tree_nodes': [],
        'tree_expansions': [],
        'tree_last_operation': None,
        'tree_steps': 0,
        'tree_history': [],
    }


def advance_obst_execution(state):
    """Evaluate exactly one root candidate and advance the execution cursor."""
    if state['completed']:
        return state

    state['history'].append({
        key: deepcopy(value)
        for key, value in state.items()
        if key != 'history'
    })

    i = state['interval_start']
    j = i + state['interval_length']
    root_k = state['candidate_root']
    root_index = root_k - 1
    frequencies = state['frequencies']
    keys = state['keys']

    left_cost = state['cost_table'][i][root_k - 1]
    right_cost = state['cost_table'][root_k][j]
    if left_cost is None or right_cost is None:
        state['history'].pop()
        raise RuntimeError('OBST dependency interval was not finalized.')

    interval_frequencies = frequencies[i:j]
    interval_frequency = sum(interval_frequencies)
    candidate_cost = left_cost + right_cost + interval_frequency
    improved = state['best_cost'] is None or candidate_cost < state['best_cost']
    if improved:
        state['best_cost'] = candidate_cost
        state['best_root'] = root_k

    state['steps_completed'] += 1
    finalized = root_k == j
    state['last_evaluation'] = {
        'i': i,
        'j': j,
        'length': state['interval_length'],
        'left_key': keys[i],
        'right_key': keys[j - 1],
        'root_index': root_index,
        'root_k': root_k,
        'root_key': keys[root_index],
        'left_cost': left_cost,
        'right_cost': right_cost,
        'interval_frequency': interval_frequency,
        'candidate_cost': candidate_cost,
        'improved': improved,
        'best_cost': state['best_cost'],
        'best_root': state['best_root'],
        'best_root_key': keys[state['best_root'] - 1],
        'best_root_index': state['best_root'] - 1,
        'finalized': False,
        'evaluated_candidates': None,
        'interval_frequency_terms': interval_frequencies,
    }
    state['evaluations'].append({
        'root_index': root_index,
        'root_k': root_k,
        'root_key': keys[root_index],
        'left_cost': left_cost,
        'right_cost': right_cost,
        'interval_frequency': interval_frequency,
        'candidate_cost': candidate_cost,
        'improved': improved,
    })
    state['last_evaluation']['evaluated_candidates'] = deepcopy(state['evaluations'])

    state['last_finalized'] = None
    if root_k == j:
        state['cost_table'][i][j] = state['best_cost']
        state['root_table'][i][j] = state['best_root']
        state['last_finalized'] = {
            'i': i,
            'j': j,
            'root_index': state['best_root'] - 1,
            'root_k': state['best_root'],
            'root_key': keys[state['best_root'] - 1],
            'cost': state['best_cost'],
        }
        state['last_evaluation']['finalized'] = True
        _advance_interval_cursor(state)
    else:
        state['candidate_root'] = root_k + 1

    return state


def _advance_interval_cursor(state):
    """Select the next interval in increasing-length, left-to-right order."""
    n = len(state['keys'])
    length = state['interval_length']
    start = state['interval_start'] + 1
    if start + length > n:
        length += 1
        start = 0

    if length > n:
        state['completed'] = True
        state['interval_length'] = n
        state['interval_start'] = 0
        state['candidate_root'] = None
        return

    state['interval_length'] = length
    state['interval_start'] = start
    state['candidate_root'] = start + 1
    state['best_cost'] = None
    state['best_root'] = None
    state['evaluations'] = []


def reverse_obst_execution(state):
    """Restore the exact state immediately before the most recent candidate."""
    if not state['history']:
        return False

    history = state['history']
    previous = history.pop()
    state.clear()
    state.update(previous)
    state['history'] = history
    return True


def reconstruct_boundary_tree(keys, roots, i, j):
    """Reconstruct C(i,j) using one-based roots stored in the DP table."""
    if i == j:
        return None
    root_k = roots[i][j]
    root_index = root_k - 1
    return {
        'key': keys[root_index],
        'index': root_index,
        'left': reconstruct_boundary_tree(keys, roots, i, root_k - 1),
        'right': reconstruct_boundary_tree(keys, roots, root_k, j),
    }


def start_obst_tree_execution(state):
    """Start table-driven tree construction without revealing any nodes."""
    if not state['completed']:
        raise ValueError('Complete the DP table before building the tree.')
    if state['tree_started']:
        return

    _save_tree_snapshot(state)
    state['tree_started'] = True
    state['tree_queue'] = [{
        'i': 0,
        'j': len(state['keys']),
        'parent_index': None,
        'side': None,
        'depth': 0,
    }]


def advance_obst_tree_execution(state):
    """Reveal exactly one root selected by the completed root table."""
    if not state['tree_started']:
        raise ValueError('Build the tree phase after completing the DP table.')
    if state['tree_completed']:
        return

    _save_tree_snapshot(state)
    interval = state['tree_queue'].pop()
    i, j = interval['i'], interval['j']
    root_k = state['root_table'][i][j]
    if root_k is None:
        state['tree_history'].pop()
        raise RuntimeError(f'No selected root is available for C({i},{j}).')

    root_index = root_k - 1
    node = {
        'key': state['keys'][root_index],
        'frequency': state['frequencies'][root_index],
        'index': root_index,
        'root_k': root_k,
        'i': i,
        'j': j,
        'depth': interval['depth'],
        'parent_index': interval['parent_index'],
        'side': interval['side'],
    }
    state['tree_nodes'].append(node)

    children = []
    for side, child_i, child_j in (
        ('left', i, root_k - 1),
        ('right', root_k, j),
    ):
        empty = child_i == child_j
        child = {
            'i': child_i,
            'j': child_j,
            'parent_index': root_index,
            'side': side,
            'depth': interval['depth'] + 1,
            'empty': empty,
            'root_k': None if empty else state['root_table'][child_i][child_j],
            'root_index': None if empty else state['root_table'][child_i][child_j] - 1,
            'root_key': None if empty else state['keys'][state['root_table'][child_i][child_j] - 1],
        }
        children.append(child)
    state['tree_queue'].extend(
        child for child in reversed(children) if not child['empty']
    )

    operation = {'node': node, 'children': children, 'step': state['tree_steps'] + 1}
    state['tree_expansions'].append(operation)
    state['tree_last_operation'] = operation

    state['tree_steps'] += 1
    state['tree_completed'] = not state['tree_queue']


def reverse_obst_tree_execution(state):
    """Restore the state before the most recent tree-phase operation."""
    if not state['tree_history']:
        return False

    history = state['tree_history']
    previous = history.pop()
    for key, value in previous.items():
        state[key] = value
    state['tree_history'] = history
    return True


def _save_tree_snapshot(state):
    state['tree_history'].append({
        key: deepcopy(value)
        for key, value in state.items()
        if key != 'tree_history'
    })


def tree_from_progress(nodes):
    """Build a partial display tree from roots already revealed to the user."""
    by_index = {
        node['index']: {
            'key': node['key'],
            'index': node['index'],
            'frequency': node['frequency'],
            'left': None,
            'right': None,
        }
        for node in nodes
    }
    root = None
    for node in nodes:
        current = by_index[node['index']]
        parent_index = node['parent_index']
        if parent_index is None:
            root = current
        elif parent_index in by_index:
            by_index[parent_index][node['side']] = current
    return root


def build_obst(keys, frequencies):
    """Run the same boundary-index recurrence to completion in one call."""
    state = initialize_obst_execution(keys, frequencies)
    steps = []
    while not state['completed']:
        advance_obst_execution(state)
        if state['last_evaluation']['finalized']:
            steps.append(deepcopy(state['last_evaluation']))
    return {
        'cost_table': state['cost_table'],
        'root_table': state['root_table'],
        'steps': steps,
        'minimum_cost': state['cost_table'][0][len(keys)],
        'n': len(keys),
    }


def reconstruct_tree(keys, roots, i, j):
    """Compatibility name for boundary-index reconstruction of C(i,j)."""
    return reconstruct_boundary_tree(keys, roots, i, j)


def tree_search_path(tree, target):
    """Return the keys visited when searching the displayed tree.

    Numeric keys are compared numerically when target and node key are numeric;
    otherwise comparisons are case-insensitive lexical comparisons.
    """
    path = []
    node = tree
    while node:
        key = str(node['key'])
        path.append(key)
        comparison = compare_keys(target, key)
        if comparison == 0:
            return path, True
        node = node['left'] if comparison < 0 else node['right']
    return path, False


def compare_keys(a, b):
    try:
        af, bf = float(a), float(b)
        return (af > bf) - (af < bf)
    except ValueError:
        aa, bb = a.casefold(), b.casefold()
        return (aa > bb) - (aa < bb)
