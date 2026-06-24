// OPR (Offensive Power Rating) via least squares — the standard definition:
// each alliance's score is modeled as the sum of its teams' contributions, and
// OPR is the least-squares solution. Solved per event (small systems), then
// aggregated to a season value. Computed on no-penalty scores so the components
// (auto + teleop) are clean.

export type Triple = [number, number, number]; // [totalNp, auto, teleop]

export interface AllianceObs {
  teams: number[];
  v: Triple;
}

/** Solve A·X = B for X, where A is k×k and B is k×m (Gaussian elimination,
 *  partial pivoting). Returns null if A is singular. Mutates copies only. */
function solveLinearMulti(A: number[][], B: number[][]): number[][] | null {
  const k = A.length;
  const m = B[0]?.length ?? 0;
  // Augmented copy.
  const M: number[][] = A.map((row, i) => [...row, ...B[i]]);
  for (let col = 0; col < k; col++) {
    // Pivot.
    let piv = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    // Eliminate.
    const pivVal = M[col][col];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r][col] / pivVal;
      if (f === 0) continue;
      for (let c = col; c < k + m; c++) M[r][c] -= f * M[col][c];
    }
  }
  const X: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) row.push(M[i][k + j] / M[i][i]);
    X.push(row);
  }
  return X;
}

/** OPR for a single event. Returns team → [totalNp, auto, teleop] OPR. */
export function solveEventOpr(obs: AllianceObs[]): Map<number, Triple> {
  const idx = new Map<number, number>();
  for (const o of obs) for (const t of o.teams) if (!idx.has(t)) idx.set(t, idx.size);
  const k = idx.size;
  const result = new Map<number, Triple>();
  if (k === 0 || obs.length < 2) return result;

  const ATA: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const ATb: number[][] = Array.from({ length: k }, () => [0, 0, 0]);
  for (const o of obs) {
    const ids = o.teams.map((t) => idx.get(t)!);
    for (const a of ids) {
      ATb[a][0] += o.v[0];
      ATb[a][1] += o.v[1];
      ATb[a][2] += o.v[2];
      for (const b of ids) ATA[a][b] += 1;
    }
  }
  // Ridge term for numerical stability / under-determined events.
  for (let i = 0; i < k; i++) ATA[i][i] += 1e-6;

  const X = solveLinearMulti(ATA, ATb);
  if (!X) return result;
  for (const [team, i] of idx) result.set(team, [X[i][0], X[i][1], X[i][2]]);
  return result;
}
