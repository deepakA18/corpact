const abs = (x: bigint): bigint => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/**
 * Exact rational over BigInt, always normalized (den > 0, gcd = 1).
 *
 * Every ledger quantity, floor and USD amount is a Rational. JS `number` appears
 * only where the chain itself stores f64 (the Scaled UI multiplier), and is
 * lifted exactly via `fromFloat64` - every finite f64 is a dyadic rational.
 */
export class Rational {
  private constructor(
    readonly num: bigint,
    readonly den: bigint,
  ) {}

  static of(num: bigint, den: bigint = 1n): Rational {
    if (den === 0n) throw new RangeError('Rational denominator is zero');
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num, den);
    return g > 1n ? new Rational(num / g, den / g) : new Rational(num, den);
  }

  static readonly ZERO = Rational.of(0n);
  static readonly ONE = Rational.of(1n);

  /** Plain decimal text only ("1.3324612", "-2", "0.3"). No exponents, no separators. */
  static fromDecimal(text: string): Rational {
    const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!m) throw new SyntaxError(`Not a plain decimal: ${JSON.stringify(text)}`);
    const frac = m[3] ?? '';
    const magnitude = BigInt(m[2]! + frac);
    return Rational.of(m[1] ? -magnitude : magnitude, 10n ** BigInt(frac.length));
  }

  /** The exact value of a finite f64 - no decimal round trip. */
  static fromFloat64(value: number): Rational {
    if (!Number.isFinite(value)) throw new RangeError(`Non-finite float64: ${value}`);
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const hi = view.getUint32(0);
    const lo = view.getUint32(4);
    const exponent = (hi >>> 20) & 0x7ff;
    let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let shift: number;
    if (exponent === 0) {
      shift = -1074; // subnormal
    } else {
      mantissa |= 1n << 52n;
      shift = exponent - 1075;
    }
    const signed = hi >>> 31 === 1 ? -mantissa : mantissa;
    return shift >= 0 ? Rational.of(signed << BigInt(shift)) : Rational.of(signed, 1n << BigInt(-shift));
  }

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  mul(o: Rational): Rational {
    return Rational.of(this.num * o.num, this.den * o.den);
  }
  div(o: Rational): Rational {
    if (o.num === 0n) throw new RangeError('Division by zero');
    return Rational.of(this.num * o.den, this.den * o.num);
  }

  compare(o: Rational): -1 | 0 | 1 {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  eq(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }
  isZero(): boolean {
    return this.num === 0n;
  }
  isNegative(): boolean {
    return this.num < 0n;
  }
  abs(): Rational {
    return this.num < 0n ? Rational.of(-this.num, this.den) : this;
  }

  floor(): bigint {
    const q = this.num / this.den;
    return this.num < 0n && this.num % this.den !== 0n ? q - 1n : q;
  }
  ceil(): bigint {
    const q = this.num / this.den;
    return this.num > 0n && this.num % this.den !== 0n ? q + 1n : q;
  }

  static max(a: Rational, b: Rational): Rational {
    return a.compare(b) >= 0 ? a : b;
  }

  /** Lossy. For comparison against on-chain f64 and for display - never for ledger math. */
  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  /** Decimal rendering, rounded half away from zero. */
  toFixed(scale: number): string {
    const negative = this.num < 0n;
    const scaled = abs(this.num) * 10n ** BigInt(scale);
    let q = scaled / this.den;
    if (2n * (scaled % this.den) >= this.den) q += 1n;
    const digits = q.toString().padStart(scale + 1, '0');
    const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    return negative && q !== 0n ? `-${body}` : body;
  }

  /**
   * Exact decimal text, for denominators whose only prime factors are 2 and 5 -
   * every f64, and every product of f64s and decimal strings. Throws otherwise.
   */
  toTerminatingDecimal(): string {
    let rest = this.den;
    let twos = 0;
    let fives = 0;
    while (rest % 2n === 0n) {
      rest /= 2n;
      twos++;
    }
    while (rest % 5n === 0n) {
      rest /= 5n;
      fives++;
    }
    if (rest !== 1n) throw new RangeError(`${this.toString()} has no terminating decimal expansion`);
    const scale = Math.max(twos, fives);
    const scaled = abs(this.num) * (10n ** BigInt(scale) / this.den);
    const digits = scaled.toString().padStart(scale + 1, '0');
    const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    return this.num < 0n ? `-${body}` : body;
  }

  /** Exact, lossless serialization. */
  toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }
  toJSON(): string {
    return this.toString();
  }
}
