const DEFAULT_RECORDS = [
  { key: '101', frequency: 40 },
  { key: '105', frequency: 10 },
  { key: '110', frequency: 30 },
  { key: '115', frequency: 15 },
  { key: '120', frequency: 5 }
];
let executionState = null;
let currentResult = null;
let searchPath = [];
let searchFound = false;
let operationInProgress = false;
let treeCanvasRunId = null;

const $ = (id) => document.getElementById(id);

function renderInputRows(records = DEFAULT_RECORDS) {
  const container = $('records-input');
  const rows = records.map((record, index) => `
    <tr class="record-row">
      <th scope="row">${index + 1}</th>
      <td><input type="text" class="key-input" aria-label="Search key ${index + 1}" value="${escapeAttr(record.key)}" placeholder="e.g. 101"></td>
      <td><input type="number" class="frequency-input" aria-label="Frequency for key ${index + 1}" value="${escapeAttr(record.frequency)}" min="1" step="1" placeholder="Frequency"></td>
      <td><button type="button" class="remove-row" title="Remove row" aria-label="Remove row">×</button></td>
    </tr>`).join('');
  container.innerHTML = `<div class="records-table-wrap"><table class="records-table"><thead><tr><th>Index</th><th>Key</th><th>Frequency</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  container.querySelectorAll('.remove-row').forEach(button => {
    button.addEventListener('click', () => {
      if (container.querySelectorAll('.record-row').length === 1) {
        showError('Keep at least one key in the input.');
        return;
      }
      button.closest('tr').remove();
      renumberInputRows();
      clearError();
    });
  });
}

function renumberInputRows() {
  $('records-input').querySelectorAll('.record-row').forEach((row, index) => {
    row.querySelector('th').textContent = index + 1;
    row.querySelector('.key-input').setAttribute('aria-label', `Search key ${index + 1}`);
    row.querySelector('.frequency-input').setAttribute('aria-label', `Frequency for key ${index + 1}`);
  });
}

function escapeAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function readRecords() {
  return [...$('records-input').querySelectorAll('.record-row')].map(row => ({
    key: row.querySelector('.key-input').value.trim(),
    frequency: row.querySelector('.frequency-input').value.trim()
  }));
}

function showError(message) {
  $('error-message').textContent = message;
  $('error-message').hidden = false;
}
function clearError() { $('error-message').hidden = true; $('error-message').textContent = ''; }

async function readApiResponse(response, action) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${action} failed (HTTP ${response.status}): the server returned a non-JSON response. Check that the OBST app is running at this address.`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${action} failed: the server returned invalid JSON.`);
  }
  if (!response.ok) throw new Error(data.error || `${action} failed (HTTP ${response.status}).`);
  return data;
}

async function postJson(url, payload, action) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return readApiResponse(response, action);
}

async function initializeRun() {
  if (operationInProgress) return;
  operationInProgress = true;
  clearError();
  setOperationControls(true);
  try {
    const data = await postJson('/api/obst/initialize', { records: readRecords() }, 'Could not initialize the OBST run');
    renderInputRows(data.records);
    searchPath = [];
    searchFound = false;
    $('search-result').className = 'search-result muted';
    $('search-result').textContent = 'Finish tree construction to enable search.';
    applyExecutionState(data);
  } catch (error) {
    showError(error.message);
  } finally {
    operationInProgress = false;
    updateControls();
  }
}

async function runOperation(endpoint) {
  if (!executionState || operationInProgress) return;
  operationInProgress = true;
  clearError();
  setOperationControls(true);
  try {
    const data = await postJson(`/api/obst/${endpoint}`, { run_id: executionState.run_id }, 'Could not update the OBST run');
    applyExecutionState(data);
  } catch (error) {
    showError(error.message);
  } finally {
    operationInProgress = false;
    updateControls();
  }
}

async function completeTable() {
  if (!executionState || operationInProgress) return;
  operationInProgress = true;
  clearError();
  setOperationControls(true);
  try {
    while (executionState.active_interval) {
      const data = await postJson('/api/obst/step', { run_id: executionState.run_id }, 'Could not complete the OBST run');
      applyExecutionState(data);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    operationInProgress = false;
    updateControls();
  }
}

async function runTreeOperation(endpoint) {
  if (!executionState || operationInProgress) return;
  operationInProgress = true;
  clearError();
  setOperationControls(true);
  try {
    const data = await postJson(`/api/obst/${endpoint}`, { run_id: executionState.run_id }, 'Could not update tree construction');
    applyExecutionState(data);
  } catch (error) {
    showError(error.message);
  } finally {
    operationInProgress = false;
    updateControls();
  }
}

async function completeTree() {
  if (!executionState || operationInProgress) return;
  operationInProgress = true;
  clearError();
  setOperationControls(true);
  try {
    const data = await postJson('/api/obst/tree-complete', { run_id: executionState.run_id }, 'Could not complete tree construction');
    applyExecutionState(data);
  } catch (error) {
    showError(error.message);
  } finally {
    operationInProgress = false;
    updateControls();
  }
}

function setOperationControls(disabled) {
  $('next-step').disabled = disabled || !executionState?.active_interval || executionState?.tree_started;
  $('prev-step').disabled = disabled || !executionState?.can_previous || executionState?.tree_started;
  $('complete-table').disabled = disabled || !executionState?.active_interval;
  $('build-tree').disabled = disabled || !executionState?.table_completed || executionState.tree_started;
  $('prev-tree-step').disabled = disabled || !executionState?.tree_can_previous;
  $('next-tree-step').disabled = disabled || !executionState?.tree_started || executionState.tree_completed;
  $('complete-tree').disabled = disabled || !executionState?.tree_started || executionState.tree_completed;
  $('build-btn').disabled = disabled;
  $('reset-btn').disabled = disabled;
}

async function resetRun() {
  if (!executionState) {
    await initializeRun();
    return;
  }
  if (operationInProgress) return;
  operationInProgress = true;
  clearError();
  setOperationControls(true);
  try {
    const data = await postJson('/api/obst/reset', {
      run_id: executionState.run_id,
      records: readRecords()
    }, 'Could not restart the OBST run');
    renderInputRows(data.records);
    searchPath = [];
    searchFound = false;
    $('search-result').className = 'search-result muted';
    $('search-result').textContent = 'Finish the DP run to enable search on the optimal tree.';
    applyExecutionState(data);
  } catch (error) {
    showError(error.message);
  } finally {
    operationInProgress = false;
    updateControls();
  }
}

function applyExecutionState(state) {
  executionState = state;
  currentResult = state.completed ? state : null;
  if (!state.completed) {
    searchPath = [];
    searchFound = false;
    $('search-result').className = 'search-result muted';
    $('search-result').textContent = 'Finish tree construction to enable search.';
  }
  renderMetrics();
  renderMatrix();
  renderStep();
  renderTree();
  updateControls();
}

function updateControls() {
  $('prev-step').disabled = operationInProgress || !executionState || !executionState.can_previous || executionState.tree_started;
  $('next-step').disabled = operationInProgress || !executionState || !executionState.active_interval || executionState.tree_started;
  $('complete-table').disabled = operationInProgress || !executionState || !executionState.active_interval;
  $('build-tree').disabled = operationInProgress || !executionState?.table_completed || executionState.tree_started;
  $('prev-tree-step').disabled = operationInProgress || !executionState || !executionState.tree_can_previous;
  $('next-tree-step').disabled = operationInProgress || !executionState?.tree_started || executionState.tree_completed;
  $('complete-tree').disabled = operationInProgress || !executionState?.tree_started || executionState.tree_completed;
  $('next-step').textContent = executionState?.table_completed ? 'Table Complete' : 'Next Step →';
  $('next-tree-step').textContent = executionState?.tree_completed ? 'Tree Complete' : 'Next Tree Step →';
  $('build-btn').disabled = operationInProgress;
  $('reset-btn').disabled = operationInProgress;
  const searchEnabled = Boolean(currentResult);
  $('search-target').disabled = !searchEnabled;
  $('search-form').querySelector('button').disabled = !searchEnabled;
}

function renderMetrics() {
  $('key-count').textContent = executionState ? executionState.n : '—';
}

function renderMatrix() {
  if (!executionState) {
    $('cost-table').className = 'matrix-wrap empty-matrix';
    $('cost-table').textContent = 'The DP table will appear here.';
    return;
  }

  const n = executionState.n;
  const active = executionState.active_interval;
  const last = executionState.last_evaluation;
  const focus = active && (!last || active.i !== last.i || active.j !== last.j)
    ? active
    : last || active;
  let html = '<table class="dp-table"><thead><tr><th>i \\ j</th>';
  for (let j = 0; j <= n; j++) html += `<th>${j}</th>`;
  html += '</tr></thead><tbody>';
  for (let i = 0; i <= n; i++) {
    html += `<tr><th>${i}</th>`;
    for (let j = 0; j <= n; j++) {
      let cell = '';
      let classes = [];
      if (i === j) {
        cell = '0';
        classes.push('diagonal-cell');
      } else if (i < j && executionState.cost_table[i][j] !== null) {
        const rootK = executionState.root_table[i][j];
        cell = `<span class="cell-cost">${executionState.cost_table[i][j]}</span>`;
        if (j - i > 1 && rootK !== null) {
          cell += `<sup>${rootK}</sup>`;
        }
        classes.push('finalized-cell');
      }
      if (focus && focus.i === i && focus.j === j) classes.push('active-cell');
      html += `<td class="${classes.join(' ')}">${cell}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  $('cost-table').className = 'matrix-wrap';
  $('cost-table').innerHTML = html;
}

function renderStep() {
  const formulaHtml = `
    <div class="formula-box">
      <div class="formula-line"><strong>C(i,j) = min { C(i,k-1) + C(k,j) } + w(i,j)</strong><span>where i &lt; k ≤ j</span></div>
      <div class="formula-line"><strong>w(i,j) = f(i+1) + f(i+2) + … + f(j)</strong></div>
      <dl class="formula-definitions">
        <div><dt>C(i,j)</dt><dd>minimum weighted search cost for the interval</dd></div>
        <div><dt>k</dt><dd>candidate root index</dd></div>
        <div><dt>w(i,j)</dt><dd>sum of frequencies in the interval</dd></div>
        <div><dt>min</dt><dd>choose the smallest subtree cost, then add the interval weight</dd></div>
      </dl>
    </div>`;
  if (!executionState) {
    $('step-counter').textContent = 'No run yet';
    $('step-detail').className = 'step-detail';
    $('step-detail').innerHTML = `${formulaHtml}<div class="calculation-empty">Initialize to see the interval calculations.</div>`;
    return;
  }

  const { active_interval: active, last_evaluation: last } = executionState;
  $('step-counter').textContent = executionState.table_completed
    ? `Table complete · ${executionState.steps_completed} candidate evaluations`
    : `Step ${executionState.steps_completed} of ${executionState.total_steps}`;

  const focus = last || active;
  let html = formulaHtml;
  if (!focus) {
    html += '<div class="calculation-empty">The DP table is complete.</div>';
  } else {
    const i = focus.i, j = focus.j;
    const weightTerms = executionState.records.slice(i, j)
      .map((record, offset) => `f(${i + offset + 1})`)
      .join(' + ');
    const weightValues = executionState.records.slice(i, j)
      .map(record => record.frequency)
      .join(' + ');
    const weight = executionState.records.slice(i, j)
      .reduce((sum, record) => sum + Number(record.frequency), 0);
    const sameActiveInterval = active && active.i === i && active.j === j;
    const evaluations = sameActiveInterval
      ? executionState.evaluations
      : last?.i === i && last?.j === j ? last.evaluated_candidates || [] : [];
    const latestCandidate = last?.i === i && last?.j === j ? last.root_k : null;
    const selectedRoot = last?.i === i && last?.j === j ? last.best_root : null;
    html += `<div class="calculation-title">Interval <strong>C(${i},${j})</strong></div>`;
    html += `<section class="calculation-section"><h4>Interval Weight</h4>`;
    html += `<div class="calculation-formula">w(${i},${j}) = ${weightTerms}</div>`;
    html += `<div class="calculation-substitution">${weightTerms} = ${weightValues} = <strong>${weight}</strong></div></section>`;
    html += '<section class="calculation-section"><h4>Candidate Costs</h4>';
    if (evaluations.length) {
      html += '<div class="candidate-list">';
      evaluations.forEach((candidate, index) => {
        const subtreeCost = candidate.left_cost + candidate.right_cost;
        const classes = ['candidate-row'];
        if (!last?.finalized && candidate.root_k === latestCandidate) classes.push('current');
        if (last?.finalized && candidate.root_k === selectedRoot) classes.push('selected');
        else if (!last?.finalized && candidate.root_k === selectedRoot) classes.push('best-so-far');
        html += `<article class="${classes.join(' ')}">
          <div class="candidate-heading"><strong>Candidate ${index + 1}</strong><span>Root k = ${candidate.root_k}, key ${escapeHtml(candidate.root_key)}</span></div>
          <div class="candidate-formula">C(${i},${candidate.root_k - 1}) + C(${candidate.root_k},${j}) = ${candidate.left_cost} + ${candidate.right_cost} = <strong>${subtreeCost}</strong></div>
          <div class="candidate-total">Total cost = ${subtreeCost} + w(${i},${j}) = ${subtreeCost} + ${weight} = <strong>${candidate.candidate_cost}</strong></div>
        </article>`;
      });
      html += '</div>';
    } else {
      html += '<div class="calculation-empty">No candidates have been evaluated for this interval.</div>';
    }
    html += '</section>';
    if (last?.i === i && last?.j === j && evaluations.length) {
      const sums = evaluations.map(candidate => candidate.left_cost + candidate.right_cost);
      const minimumSubtreeCost = last.best_cost - weight;
      html += `<section class="minimum-summary"><h4>${last.finalized ? 'Minimum' : 'Minimum so far'}</h4>
        <div class="calculation-formula">C(${i},${j}) = min { ${sums.join(', ')} } + ${weight}</div>`;
      if (last.finalized) {
        html += `<div class="calculation-substitution">C(${i},${j}) = <strong>${minimumSubtreeCost}</strong> + ${weight} = <strong>${last.best_cost}</strong></div>
          <div class="decision-line"><strong>Selected Root:</strong> k = <strong>${last.best_root}</strong>, key <strong>${escapeHtml(last.best_root_key)}</strong>. This candidate has the smallest subtree cost.</div>
          <div class="final-cost">Final cell: C(${i},${j}) = <strong>${last.best_cost}<sup>${last.best_root}</sup></strong></div>`;
      } else {
        html += `<div class="calculation-substitution">Smallest evaluated subtree cost = <strong>${minimumSubtreeCost}</strong></div>
          <div class="decision-line"><strong>Best so far:</strong> k = <strong>${last.best_root}</strong>, key <strong>${escapeHtml(last.best_root_key)}</strong>.</div>`;
      }
      html += '</section>';
    }
  }
  if (executionState.table_completed) {
    html += `<div class="finalized-note">The full DP table is complete. Minimum weighted cost: <strong>${executionState.minimum_cost}</strong>. ${executionState.tree_started ? 'Tree construction is now a separate phase.' : 'Build Tree is now available; no tree nodes have been drawn yet.'}</div>`;
  }
  $('step-detail').className = 'step-detail';
  $('step-detail').innerHTML = html;
}

function renderTree() {
  const canvas = $('tree-canvas');
  if (!executionState) {
    canvas.innerHTML = '<div class="tree-placeholder"><div class="placeholder-icon">⌘</div><strong>Your tree will appear here</strong><p>Initialize a run to start calculating.</p></div>';
    canvas.style.height = '';
    treeCanvasRunId = null;
    $('tree-caption').textContent = 'Waiting for the DP table';
    return;
  }

  const records = executionState.records;
  if (!executionState.tree_started) {
    canvas.innerHTML = '<div class="tree-placeholder"><div class="placeholder-icon">⌘</div><strong>Tree construction has not started</strong><p>Complete the entire DP table, then choose Build Tree.</p></div>';
    canvas.style.height = '';
    treeCanvasRunId = executionState.run_id;
    $('tree-caption').textContent = executionState.table_completed
      ? `DP table complete. Cost ${executionState.minimum_cost}; select Build Tree to reveal the stored roots.`
      : 'Tree remains hidden while the DP table is being filled.';
    return;
  }

  const namespace = 'http://www.w3.org/2000/svg';
  const width = Math.max(canvas.clientWidth, records.length * 92 + 100, 380);
  const height = Math.max(360, (records.length + 1) * 118);
  let svg = canvas.querySelector('svg');
  if (treeCanvasRunId !== executionState.run_id || !svg) {
    canvas.innerHTML = '';
    treeCanvasRunId = executionState.run_id;
    svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'OBST reconstructed from the completed DP table');
    svg.style.minWidth = `${width}px`;
    svg.style.height = `${height}px`;
    canvas.appendChild(svg);
    const rootInterval = executionState.tree_initial_interval;
    const waiting = document.createElementNS(namespace, 'text');
    waiting.setAttribute('class', 'tree-interval-label tree-root-interval');
    waiting.setAttribute('x', String(width / 2));
    waiting.setAttribute('y', '28');
    waiting.textContent = `r(${rootInterval.i},${rootInterval.j})`;
    svg.appendChild(waiting);
  }
  canvas.style.height = `${height}px`;

  const xForIndex = index => 48 + (index + 0.5) * ((width - 96) / records.length);
  const xForBoundary = boundary => 48 + boundary * ((width - 96) / records.length);
  const yForDepth = depth => 72 + depth * 108;
  const operations = executionState.tree_expansions || [];
  for (const group of [...svg.querySelectorAll('[data-tree-step]')]) {
    if (Number(group.getAttribute('data-tree-step')) > operations.length) group.remove();
  }
  for (const operation of operations) {
    if (svg.querySelector(`[data-tree-step="${operation.step}"]`)) continue;
    const group = document.createElementNS(namespace, 'g');
    group.setAttribute('data-tree-step', String(operation.step));
    const node = operation.node;
    const cx = xForIndex(node.index), cy = yForDepth(node.depth);
    const rootLabel = document.createElementNS(namespace, 'text');
    rootLabel.setAttribute('class', 'tree-interval-label tree-node-interval');
    rootLabel.setAttribute('x', String(cx));
    rootLabel.setAttribute('y', String(cy - 38));
    rootLabel.textContent = `r(${node.i},${node.j}) = ${node.root_k}`;
    group.appendChild(rootLabel);

    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('class', `tree-construction-node${node.depth === 0 ? ' global-root' : ''}`);
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '25');
    group.appendChild(circle);
    const rootNumber = document.createElementNS(namespace, 'text');
    rootNumber.setAttribute('class', 'tree-root-number');
    rootNumber.setAttribute('x', String(cx));
    rootNumber.setAttribute('y', String(cy + 1));
    rootNumber.textContent = String(node.root_k);
    group.appendChild(rootNumber);
    const keyLabel = document.createElementNS(namespace, 'text');
    keyLabel.setAttribute('class', 'tree-key-label');
    keyLabel.setAttribute('x', String(cx));
    keyLabel.setAttribute('y', String(cy + 43));
    keyLabel.textContent = `key ${node.key} · f=${node.frequency}`;
    group.appendChild(keyLabel);

    for (const child of operation.children) {
      const childX = child.empty ? xForBoundary(child.i) : xForIndex(child.root_index);
      const childY = yForDepth(child.depth);
      const branch = document.createElementNS(namespace, 'line');
      branch.setAttribute('class', `tree-edge tree-branch-${child.side}${child.empty ? ' empty-branch' : ''}`);
      branch.setAttribute('x1', String(cx));
      branch.setAttribute('y1', String(cy + 26));
      branch.setAttribute('x2', String(childX));
      branch.setAttribute('y2', String(childY - 26));
      group.appendChild(branch);
      const intervalLabel = document.createElementNS(namespace, 'text');
      intervalLabel.setAttribute('class', `tree-interval-label${child.empty ? ' empty-interval-label' : ''}`);
      intervalLabel.setAttribute('x', String((cx + childX) / 2));
      intervalLabel.setAttribute('y', String((cy + childY) / 2 - 4));
      intervalLabel.textContent = `r(${child.i},${child.j})`;
      group.appendChild(intervalLabel);
    }
    svg.appendChild(group);
  }
  for (const nodeGroup of svg.querySelectorAll('[data-tree-step]')) {
    const index = Number(nodeGroup.querySelector('.tree-root-number').textContent) - 1;
    const key = records[index].key;
    nodeGroup.classList.toggle('search-hit', searchFound && searchPath.at(-1) === key);
    nodeGroup.classList.toggle('search-visit', searchPath.includes(key) && !(searchFound && searchPath.at(-1) === key));
  }
  $('tree-caption').textContent = executionState.tree_completed
    ? `Optimal tree complete. Weighted cost: ${executionState.minimum_cost}; root: ${executionState.tree.key}.`
    : `Tree construction · ${executionState.tree_steps} of ${records.length} roots revealed · ${executionState.tree_queue_length} intervals remain.`;
}

async function runSearch(event) {
  event.preventDefault();
  if (!currentResult) {
    $('search-result').className = 'search-result failure';
    $('search-result').textContent = 'Complete tree construction before searching.';
    return;
  }
  const target = $('search-target').value.trim();
  if (!target) return;
  try {
    const data = await postJson('/api/search', { tree: currentResult.tree, target }, 'Search failed');
    searchPath = data.path;
    searchFound = data.found;
    $('search-result').className = `search-result ${data.found ? 'success' : 'failure'}`;
    const chips = data.path.map(key => `<span class="path-chip">${escapeHtml(key)}</span>`).join(' → ');
    $('search-result').innerHTML = `${data.found ? 'Key found' : 'Key not found'} after ${data.path.length} comparison(s).<br>Path: ${chips}`;
    renderTree();
  } catch (error) {
    $('search-result').className = 'search-result failure';
    $('search-result').textContent = error.message;
  }
}

function uploadCSV(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = String(reader.result).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const rows = lines.map((line, index) => {
        const parts = line.split(',').map(part => part.trim().replace(/^"|"$/g, ''));
        if (index === 0 && /key/i.test(parts[0]) && /freq/i.test(parts[1] || '')) return null;
        if (parts.length < 2) throw new Error(`Line ${index + 1} must contain key,frequency.`);
        return { key: parts[0], frequency: parts[1] };
      }).filter(Boolean);
      if (!rows.length) throw new Error('No records found in the CSV file.');
      renderInputRows(rows);
      clearError();
    } catch (error) { showError(error.message); }
  };
  reader.readAsText(file);
}

$('add-row-btn').addEventListener('click', () => {
  const records = readRecords();
  records.push({ key: '', frequency: '' });
  renderInputRows(records);
  clearError();
});
$('sample-btn').addEventListener('click', () => { renderInputRows(DEFAULT_RECORDS); clearError(); });
$('build-btn').addEventListener('click', initializeRun);
$('prev-step').addEventListener('click', () => runOperation('previous'));
$('next-step').addEventListener('click', () => runOperation('step'));
$('complete-table').addEventListener('click', completeTable);
$('build-tree').addEventListener('click', () => runTreeOperation('build-tree'));
$('prev-tree-step').addEventListener('click', () => runTreeOperation('tree-previous'));
$('next-tree-step').addEventListener('click', () => runTreeOperation('tree-step'));
$('complete-tree').addEventListener('click', completeTree);
$('search-form').addEventListener('submit', runSearch);
$('reset-btn').addEventListener('click', resetRun);
$('csv-upload').addEventListener('change', event => uploadCSV(event.target.files[0]));
window.addEventListener('resize', () => { if (executionState) renderTree(); });
renderInputRows(DEFAULT_RECORDS);
renderStep();
