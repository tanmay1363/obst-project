# Intelligent Search Index Optimizer — Frequency-Based OBST

A Flask web app demonstrating a successful-search-only Optimal Binary Search Tree using Dynamic Programming. The left side contains the editable input and progressive tree construction; the right side contains the DP trace, single cost table, summary metrics, and lookup controls.

## Requirements
- Python 3.10 or newer
- pip

## Run on Windows (VS Code terminal)

```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000` in your browser. If that port is occupied, run the app on port 5001:

```powershell
python -m flask --app app run --host 127.0.0.1 --port 5001 --no-debugger --no-reload
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal, then activate again. Alternatively, install dependencies with `.venv\Scripts\python -m pip install -r requirements.txt` and run `.venv\Scripts\python app.py` without activating.

## Input
Enter unique keys and positive integer search frequencies, or upload a CSV with headers `key,frequency`. Numeric keys are sorted numerically; other keys are sorted case-insensitively. Keep at most 15 keys for a readable tree.

## Algorithm
The UI and incremental engine use boundary indices `0..n`: `C(i,j)` contains the sorted keys at one-based positions `i+1` through `j` (the Python slice `keys[i:j]`). Thus `C(i,i)=0` is an empty interval, and a single key has cost `C(i,i+1)=f(i+1)`. The successful-search recurrence is:

`C(i,j) = min { C(i,k-1) + C(k,j) } + w(i,j)` for `i < k <= j`, where `w(i,j) = Σ f(t)` for `t=i+1..j`.

The root table stores the selected one-based root index `k`; the single DP grid displays that index as a superscript beside each finalized nontrivial cost. Candidate roots are tested in increasing `k` order.

For keys `10, 20, 30, 40` with frequencies `4, 2, 6, 3`, the recurrence gives `C(0,2)=8`, `C(1,3)=10`, `C(2,4)=12`, `C(0,3)=20`, `C(1,4)=16`, and `C(0,4)=26`. In particular, `C(1,4)=14` would not satisfy this recurrence: its interval weight is `11`, and its minimum candidate sum is `5`, for a cost of `16`.

The DP grid has boundary indices `0..n` on both axes. Empty intervals fill its main diagonal, single-key intervals are initialized next to the diagonal, and remaining cells are calculated in increasing interval length and left-to-right diagonal order. Root choices remain internal and are annotated in the finalized cost cell. The minimum weighted cost equals the sum of each key's frequency times its depth (root depth is 1). Average successful-search comparisons are `minimum_cost / sum(frequencies)`.

## Interactive execution
Choose **Initialize** to validate and sort the input and initialize the diagonal and single-key cells. It does not evaluate any interval with two or more keys. The calculation trace displays the recurrence and its terms, the actual interval weight, each evaluated candidate's subtree and total cost, and the minimum/selected root when the interval is finalized. Each **Next Step** evaluates exactly one candidate root, in increasing interval-length and left-to-right diagonal order. An interval is written to the single DP grid only after all its roots have been evaluated. **Previous Step** restores the prior DP snapshot, and **Complete Table** performs the remaining candidate evaluations without drawing a tree. Only after the full table is complete can **Build Tree** start the separate tree phase. Each **Next Tree Step** reads the next selected root from the completed table in recursive preorder (left interval before right interval), adds that node and the labels/branches for both child intervals, and preserves already drawn SVG elements. Empty child intervals are shown as labels but do not produce nodes. **Previous Tree Step** reverses exactly the most recent expansion, and **Complete Tree** applies the remaining expansions in the same order. Search is enabled after all nodes have been placed. **Reset** starts both phases over using the current input rows.

The execution API is `POST /api/obst/initialize`, `/api/obst/step`, `/api/obst/previous`, `/api/obst/reset`, `/api/obst/build-tree`, `/api/obst/tree-step`, `/api/obst/tree-complete`, and `/api/obst/tree-previous`. Each run receives its own opaque ID and server-side state; inactive runs expire after one hour. As with the development server, execution state is in memory and is cleared when the Flask process restarts.

## Scope and limitations
This version omits unsuccessful-search gap frequencies. Classical OBST formulations may include probabilities/frequencies for unsuccessful searches; that extension requires a corresponding recurrence and input model. This app uses the O(n^3)-time, O(n^2)-space interval DP algorithm.
