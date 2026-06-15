/**
 * src/shared/script/expect.ts — the REAL chai BDD `expect` re-export plus the
 * `deepEqual` (deep-eql) helper. Exercises the full documented matcher surface
 * Postman/Newman scripts rely on, including .not negation.
 */
import { describe, it, expect as vi } from 'vitest'
import { expect, deepEqual } from '../../../src/shared/script/expect'

/** Helper: an assertion fn must throw an AssertionError. */
function throws(fn: () => void): void {
  vi(fn).toThrow()
}
/** Helper: an assertion fn must NOT throw. */
function passes(fn: () => void): void {
  vi(fn).not.toThrow()
}

describe('expect — equality', () => {
  it('equal / eql / deep.equal', () => {
    passes(() => expect(1).to.equal(1))
    passes(() => expect({ a: 1 }).to.eql({ a: 1 }))
    passes(() => expect({ a: { b: 2 } }).to.deep.equal({ a: { b: 2 } }))
    throws(() => expect(1).to.equal(2))
    throws(() => expect({ a: 1 }).to.equal({ a: 1 })) // strict identity fails
  })
})

describe('expect — type checks (a/an)', () => {
  it('a / an', () => {
    passes(() => expect('x').to.be.a('string'))
    passes(() => expect(5).to.be.an('number'))
    passes(() => expect([]).to.be.an('array'))
    passes(() => expect({}).to.be.an('object'))
    throws(() => expect('x').to.be.a('number'))
  })
})

describe('expect — include & members', () => {
  it('include (string + array + deep)', () => {
    passes(() => expect('hello world').to.include('world'))
    passes(() => expect([1, 2, 3]).to.include(2))
    passes(() => expect([{ a: 1 }]).to.deep.include({ a: 1 }))
    throws(() => expect([1, 2]).to.include(9))
  })
  it('members (ordered + deep)', () => {
    passes(() => expect([1, 2, 3]).to.have.members([3, 2, 1]))
    passes(() => expect([1, 2, 3]).to.have.ordered.members([1, 2, 3]))
    passes(() => expect([{ a: 1 }]).to.have.deep.members([{ a: 1 }]))
    throws(() => expect([1, 2, 3]).to.have.ordered.members([3, 2, 1]))
  })
})

describe('expect — keys', () => {
  it('keys + any.keys', () => {
    passes(() => expect({ a: 1, b: 2 }).to.have.keys('a', 'b'))
    passes(() => expect({ a: 1, b: 2 }).to.have.any.keys('a', 'z'))
    passes(() => expect({ a: 1, b: 2 }).to.include.keys('a'))
    throws(() => expect({ a: 1 }).to.have.keys('a', 'b'))
  })
})

describe('expect — property', () => {
  it('property + nested + own + value', () => {
    passes(() => expect({ a: 1 }).to.have.property('a'))
    passes(() => expect({ a: 1 }).to.have.property('a', 1))
    passes(() => expect({ a: { b: { c: 3 } } }).to.have.nested.property('a.b.c', 3))
    passes(() => expect({ a: 1 }).to.have.own.property('a'))
    throws(() => expect({ a: 1 }).to.have.property('a', 99))
  })
})

describe('expect — lengthOf', () => {
  it('lengthOf', () => {
    passes(() => expect([1, 2, 3]).to.have.lengthOf(3))
    passes(() => expect('abcd').to.have.lengthOf(4))
    throws(() => expect([1]).to.have.lengthOf(2))
  })
})

describe('expect — numeric comparisons', () => {
  it('above / below / within / closeTo', () => {
    passes(() => expect(5).to.be.above(3))
    passes(() => expect(5).to.be.below(9))
    passes(() => expect(5).to.be.within(1, 10))
    passes(() => expect(1.5).to.be.closeTo(1.45, 0.1))
    throws(() => expect(5).to.be.above(10))
    throws(() => expect(1.5).to.be.closeTo(2.0, 0.1))
  })
})

describe('expect — match / oneOf / instanceOf', () => {
  it('match', () => {
    passes(() => expect('abc123').to.match(/\d+/))
    throws(() => expect('abc').to.match(/\d+/))
  })
  it('oneOf', () => {
    passes(() => expect(2).to.be.oneOf([1, 2, 3]))
    throws(() => expect(9).to.be.oneOf([1, 2, 3]))
  })
  it('instanceOf', () => {
    passes(() => expect(new Date()).to.be.instanceOf(Date))
    passes(() => expect([]).to.be.instanceOf(Array))
    throws(() => expect({}).to.be.instanceOf(Date))
  })
})

describe('expect — throw', () => {
  it('throw (plain + message match + type)', () => {
    passes(() =>
      expect(() => {
        throw new Error('boom')
      }).to.throw(),
    )
    passes(() =>
      expect(() => {
        throw new Error('boom happened')
      }).to.throw('boom'),
    )
    passes(() =>
      expect(() => {
        throw new Error('boom')
      }).to.throw(/bo+m/),
    )
    passes(() =>
      expect(() => {
        throw new TypeError('bad type')
      }).to.throw(TypeError),
    )
    throws(() =>
      expect(() => {
        /* no throw */
      }).to.throw(),
    )
  })
})

describe('expect — satisfy', () => {
  it('satisfy', () => {
    passes(() => expect(10).to.satisfy((n: number) => n % 2 === 0))
    throws(() => expect(7).to.satisfy((n: number) => n % 2 === 0))
  })
})

describe('expect — truthiness & nullishness', () => {
  it('ok / true / false / null / undefined / NaN / exist / empty', () => {
    passes(() => expect(1).to.be.ok)
    passes(() => expect(true).to.be.true)
    passes(() => expect(false).to.be.false)
    passes(() => expect(null).to.be.null)
    passes(() => expect(undefined).to.be.undefined)
    passes(() => expect(NaN).to.be.NaN)
    passes(() => expect('x').to.exist)
    passes(() => expect([]).to.be.empty)
    passes(() => expect({}).to.be.empty)
    passes(() => expect('').to.be.empty)
    throws(() => expect(0).to.be.ok)
    throws(() => expect(null).to.exist)
    throws(() => expect([1]).to.be.empty)
  })
})

describe('expect — object state & number state', () => {
  it('sealed / frozen / extensible / finite', () => {
    passes(() => expect(Object.freeze({})).to.be.frozen)
    passes(() => expect(Object.seal({})).to.be.sealed)
    passes(() => expect({}).to.be.extensible)
    passes(() => expect(42).to.be.finite)
    throws(() => expect({}).to.be.frozen)
    throws(() => expect(Infinity).to.be.finite)
  })
})

describe('expect — change / increase / decrease / by', () => {
  it('change + by', () => {
    const obj = { v: 1 }
    passes(() =>
      expect(() => {
        obj.v += 5
      })
        .to.change(obj, 'v')
        .by(5),
    )
  })
  it('increase + by', () => {
    const obj = { v: 1 }
    passes(() =>
      expect(() => {
        obj.v += 2
      })
        .to.increase(obj, 'v')
        .by(2),
    )
  })
  it('decrease + by', () => {
    const obj = { v: 10 }
    passes(() =>
      expect(() => {
        obj.v -= 3
      })
        .to.decrease(obj, 'v')
        .by(3),
    )
  })
})

describe('expect — negation (.not)', () => {
  it('.not.equal / include / property / be.* / match', () => {
    passes(() => expect(1).to.not.equal(2))
    passes(() => expect([1, 2]).to.not.include(9))
    passes(() => expect({ a: 1 }).to.not.have.property('z'))
    passes(() => expect(5).to.not.be.below(1))
    passes(() => expect('abc').to.not.match(/\d/))
    passes(() => expect(null).to.not.exist)
    throws(() => expect(1).to.not.equal(1))
    throws(() => expect([1, 2]).to.not.include(1))
  })
})

describe('expect.fail', () => {
  it('throws with the given message', () => {
    vi(() => expect.fail('custom failure')).toThrow('custom failure')
    vi(() => expect.fail()).toThrow()
  })
})

describe('deepEqual (deep-eql)', () => {
  it('true for structurally equal, false otherwise', () => {
    vi(deepEqual({ a: [1, 2], b: { c: 3 } }, { a: [1, 2], b: { c: 3 } })).toBe(true)
    vi(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    vi(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    vi(deepEqual(1, '1')).toBe(false)
    vi(deepEqual(null, undefined)).toBe(false)
  })
})
