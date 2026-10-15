// sci-core fit — deterministic least-squares trend fitting, pure math.
// Four model kinds, each a straight line in its natural axis space:
//   linear       y = a + b·x          (straight on linear axes)
//   exponential  y = a·e^(b·x)        (straight on semilog-y)  → doubling time ln2/b
//   power        y = a·x^b            (straight on log-log)    → the scaling exponent
//   logarithmic  y = a + b·ln x       (straight on semilog-x)
// Fits are computed in the linearized space (the standard journal convention) and
// R² is reported for that regression. Same GOLD RULES: no Date, no random.

// Least squares on (u, v) with intercept. Throws if u has no variance.
function lsq(u, v, seriesName) {
  const n = u.length;
  const um = u.reduce((s, x) => s + x, 0) / n;
  const vm = v.reduce((s, x) => s + x, 0) / n;
  let suu = 0, suv = 0, svv = 0;
  for (let i = 0; i < n; i++) { const du = u[i] - um, dv = v[i] - vm; suu += du * du; suv += du * dv; svv += dv * dv; }
  if (suu === 0) throw new Error('sci-core: fit needs varying x values in series "' + seriesName + '"');
  const b = suv / suu;
  const a = vm - b * um;
  let ssRes = 0;
  for (let i = 0; i < n; i++) { const e = v[i] - (a + b * u[i]); ssRes += e * e; }
  const r2 = svv === 0 ? 1 : Math.max(0, 1 - ssRes / svv);
  return { a, b, r2 };
}

const FIT_KINDS = ['linear', 'exponential', 'power', 'logarithmic'];

// requireAll: values must all be > 0 for a ln() transform — fail loud with the fix.
function lnAll(vals, axisName, seriesName, kind) {
  return vals.map((v, i) => {
    if (!(v > 0)) throw new Error('sci-core: ' + kind + ' fit needs ' + axisName + ' > 0, but series "' +
      seriesName + '" point ' + i + ' has ' + axisName + ' = ' + v);
    return Math.log(v);
  });
}

// fitSeries(kind, x, y, name) → { kind, a, b, r2, predict(x) } in ORIGINAL units.
export function fitSeries(kind, x, y, name) {
  if (!FIT_KINDS.includes(kind)) {
    throw new Error('sci-core: unknown fit "' + kind + '". Valid: ' + FIT_KINDS.join(', ') + ' (or fit: true to match the scale)');
  }
  if (x.length < 2) throw new Error('sci-core: fit needs at least 2 points in series "' + name + '"');
  if (kind === 'linear') {
    const { a, b, r2 } = lsq(x, y, name);
    return { kind, a, b, r2, predict: (xv) => a + b * xv };
  }
  if (kind === 'logarithmic') {
    const { a, b, r2 } = lsq(lnAll(x, 'x', name, kind), y, name);
    return { kind, a, b, r2, predict: (xv) => a + b * Math.log(xv) };
  }
  if (kind === 'exponential') {
    const { a, b, r2 } = lsq(x, lnAll(y, 'y', name, kind), name);
    const A = Math.exp(a);
    return { kind, a: A, b, r2, predict: (xv) => A * Math.exp(b * xv) };
  }
  // power
  const { a, b, r2 } = lsq(lnAll(x, 'x', name, kind), lnAll(y, 'y', name, kind), name);
  const A = Math.exp(a);
  return { kind, a: A, b, r2, predict: (xv) => A * Math.pow(xv, b) };
}

// fit: true / 'auto' → the model that is a straight line on the chart's axes.
export function autoFitKind(logX, logY) {
  if (logX && logY) return 'power';
  if (logY) return 'exponential';
  if (logX) return 'logarithmic';
  return 'linear';
}

// Inverse standard-normal CDF (probit), Acklam's rational approximation —
// deterministic, |error| < 1.15e-9 over (0,1). The Q-Q plot's theoretical axis.
const IN_A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const IN_B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const IN_C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const IN_D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
export function invNorm(p) {
  if (!(p > 0) || !(p < 1)) throw new Error('sci-core: invNorm needs 0 < p < 1, got ' + p);
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((IN_C[0] * q + IN_C[1]) * q + IN_C[2]) * q + IN_C[3]) * q + IN_C[4]) * q + IN_C[5]) /
           ((((IN_D[0] * q + IN_D[1]) * q + IN_D[2]) * q + IN_D[3]) * q + 1);
  }
  if (p > 1 - pl) return -invNorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((IN_A[0] * r + IN_A[1]) * r + IN_A[2]) * r + IN_A[3]) * r + IN_A[4]) * r + IN_A[5]) * q /
         (((((IN_B[0] * r + IN_B[1]) * r + IN_B[2]) * r + IN_B[3]) * r + IN_B[4]) * r + 1);
}

// Deterministic 3-significant-digit formatting for annotations (no locale drift).
export function sig(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}
