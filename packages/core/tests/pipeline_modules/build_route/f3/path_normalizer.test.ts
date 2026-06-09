import { describe, it, expect } from 'vitest'
import { normalize, join } from '@/pipeline_modules/build_route/f3/path_normalizer'

describe('pathNormalizer.normalize — spec §5.5 (S25~S30) + rule-engine.md §3.1', () => {
  describe('S25~S29 (spec scenarios)', () => {
    it('S25: /Orders/[id]/ → /orders/:id', () => {
      expect(normalize('/Orders/[id]/')).toBe('/orders/:id')
    })

    it('S26: /(auth)/login → /login (Next.js group 제거)', () => {
      expect(normalize('/(auth)/login')).toBe('/login')
    })

    it('S26b: 다중 group → 모두 제거', () => {
      expect(normalize('/(auth)/(public)/login')).toBe('/login')
    })

    it('S27: //api//users → /api/users (다중 슬래시)', () => {
      expect(normalize('//api//users')).toBe('/api/users')
    })

    it('S28: /users/{userId}/posts/{postId} → /users/:userId/posts/:postId', () => {
      expect(normalize('/users/{userId}/posts/{postId}')).toBe('/users/:userId/posts/:postId')
    })

    it('S29: empty → /', () => {
      expect(normalize('')).toBe('/')
    })
  })

  describe('§3.1 step 4: lowercase는 적용, :param 이름은 보존', () => {
    it(':UserId 는 보존된다', () => {
      expect(normalize('/users/:UserId')).toBe('/users/:UserId')
    })

    it('path segment 는 lowercase, :param 은 그대로', () => {
      expect(normalize('/Orders/:OrderId/Items')).toBe('/orders/:OrderId/items')
    })
  })

  describe('§3.1 step 5: 동적 segment 통일', () => {
    it('[id] (Next.js) → :id', () => {
      expect(normalize('/posts/[id]')).toBe('/posts/:id')
    })

    it('[postId] (Next.js) preserves parameter casing', () => {
      expect(normalize('/posts/[postId]')).toBe('/posts/:postId')
    })

    it('<id> (Vue) → :id', () => {
      expect(normalize('/posts/<id>')).toBe('/posts/:id')
    })

    it('{id} (OpenAPI) → :id', () => {
      expect(normalize('/posts/{id}')).toBe('/posts/:id')
    })

    it(':id (이미 정규화) → :id 그대로', () => {
      expect(normalize('/posts/:id')).toBe('/posts/:id')
    })
  })

  describe('§3.1 step 6: Next.js 규칙', () => {
    it('catch-all [...rest] → :rest*', () => {
      expect(normalize('/posts/[...slug]')).toBe('/posts/:slug*')
    })

    it('optional catch-all [[...rest]] → :rest?', () => {
      expect(normalize('/posts/[[...slug]]')).toBe('/posts/:slug?')
    })

    it('group 제거 후 슬래시 정리', () => {
      expect(normalize('/api/(internal)/health')).toBe('/api/health')
    })
  })

  describe('§3.1 step 2/3: 슬래시 처리', () => {
    it('backslash → forward slash', () => {
      expect(normalize('\\api\\users')).toBe('/api/users')
    })

    it('mixed slash → 단일 정규화', () => {
      expect(normalize('/api\\/users')).toBe('/api/users')
    })
  })

  describe('§3.1 step 7/8: trailing slash / empty', () => {
    it('trailing slash 제거', () => {
      expect(normalize('/api/')).toBe('/api')
    })

    it("'/' 자체는 유지", () => {
      expect(normalize('/')).toBe('/')
    })

    it('whitespace only → /', () => {
      expect(normalize('   ')).toBe('/')
    })

    it('group 만 있는 path → /', () => {
      expect(normalize('/(auth)')).toBe('/')
    })
  })

  describe('§3.1 step 1: trim', () => {
    it('양끝 공백 제거', () => {
      expect(normalize('  /api/users  ')).toBe('/api/users')
    })
  })
})

describe('pathNormalizer.join — rule-engine.md §3.2', () => {
  it('parent null → child 만 normalize', () => {
    expect(join(null, '/users')).toBe('/users')
  })

  it('parent undefined → child 만 normalize', () => {
    expect(join(undefined, '/Users')).toBe('/users')
  })

  it("parent '' → child 만 normalize", () => {
    expect(join('', '/users')).toBe('/users')
  })

  it("parent '/api', child '/list' → /api/list", () => {
    expect(join('/api', '/list')).toBe('/api/list')
  })

  it("parent '/api', child 'list' (no leading) → /api/list", () => {
    expect(join('/api', 'list')).toBe('/api/list')
  })

  it("parent '/api/' (trailing), child '/list' → /api/list", () => {
    expect(join('/api/', '/list')).toBe('/api/list')
  })

  it('다단 합성 + dynamic segment', () => {
    expect(join('/api/v1', '/users/[id]')).toBe('/api/v1/users/:id')
  })

  it('parent 와 child 모두 lowercase 적용', () => {
    expect(join('/API', '/Users')).toBe('/api/users')
  })

  it("child '/' 하나 → parent 그대로", () => {
    expect(join('/api', '/')).toBe('/api')
  })
})
