import { describe, expect, it } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { extractAst } from '@/pipeline_modules/build_graph/f2_extract_ast.js'
import type { CodeEdgeRaw, SourceFile } from '@/pipeline_modules/build_graph/types.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/entry.ts', repoId = 'r1') {
  return adapter.parseFile(content, filePath, repoId)
}

function nodeNames(result: ReturnType<typeof parse>) {
  return result.nodes.map((node) => node.name)
}

function edge(
  result: ReturnType<typeof parse>,
  relation: CodeEdgeRaw['relation'],
  sourceSuffix: string,
  targetSymbol: string,
) {
  return result.edges.find((item) =>
    item.relation === relation &&
    item.source_id.endsWith(sourceSuffix) &&
    item.target_symbol === targetSymbol
  )
}

describe('TypeScriptParserAdapter entry-relevant internal symbols', () => {
  it('captures local const handlers exported through an object', () => {
    const result = parse(`
const createPost = catchAsync(async (req, res) => {
  return PostService.createPost(req.body)
})

export const PostController = {
  createPost,
}
`)

    expect(result.nodes.find((node) => node.name === 'createPost')).toMatchObject({
      type: 'function',
      exported: true,
      is_async: true,
    })
    expect(result.nodes.find((node) => node.name === 'PostController')).toMatchObject({
      type: 'variable',
      exported: true,
    })
    expect(edge(result, 'contains', ':PostController', 'createPost')).toBeDefined()
    expect(edge(result, 'calls', ':createPost', 'createPost')).toBeDefined()
  })

  it('captures service functions hidden behind object exports', () => {
    const result = parse(`
const queryPosts = async (filter, options) => {
  return prisma.post.findMany({ where: filter, ...options })
}

export const PostService = {
  queryPosts,
}
`)

    expect(result.nodes.find((node) => node.name === 'queryPosts')).toMatchObject({
      type: 'function',
      exported: true,
    })
    expect(edge(result, 'contains', ':PostService', 'queryPosts')).toBeDefined()
    expect(edge(result, 'calls', ':queryPosts', 'findMany')).toBeDefined()
  })

  it('captures default singleton class implementations and methods', () => {
    const result = parse(`
class CourseRepo {
  getAllCourses(options) {
    return Course.findAll(options)
  }
}

export default new CourseRepo()
`)

    expect(result.nodes.find((node) => node.name === 'CourseRepo')).toMatchObject({
      type: 'class',
      exported: true,
      is_default_export: true,
    })
    expect(result.nodes.find((node) => node.name === 'CourseRepo.getAllCourses')).toMatchObject({
      type: 'method',
      exported: false,
    })
    expect(edge(result, 'contains', ':CourseRepo', 'getAllCourses')).toBeDefined()
  })

  it('captures class property route handlers and their service calls', () => {
    const result = parse(`
class AuthController {
  loginUser = asyncHandler(async (req, res) => {
    return this.authService.loginUser(req.body)
  })
}
`)

    expect(result.nodes.find((node) => node.name === 'AuthController')).toMatchObject({
      type: 'class',
      exported: false,
    })
    expect(result.nodes.find((node) => node.name === 'AuthController.loginUser')).toMatchObject({
      type: 'property',
      exported: false,
    })
    expect(edge(result, 'calls', ':AuthController.loginUser', 'loginUser')).toBeDefined()
  })

  it('captures CommonJS object exports and member assignments', () => {
    const objectExport = parse(`
function authenticate(req, res, next) {
  return next()
}

module.exports = {
  authenticate,
}
`, 'src/auth.js')

    expect(objectExport.nodes.find((node) => node.name === 'authenticate')).toMatchObject({
      type: 'function',
      exported: true,
    })
    expect(edge(objectExport, 'contains', 'src/auth.js', 'authenticate')).toBeDefined()

    const memberExport = parse(`
const restrict = (role) => (req, res, next) => next()
exports.restrict = restrict
`, 'src/auth.js')

    expect(memberExport.nodes.find((node) => node.name === 'restrict')).toMatchObject({
      type: 'function',
      exported: true,
    })
  })

  it('captures top-level helpers, constants, and type context used by entries', () => {
    const result = parse(`
const TODOS_KEY = 'todos'

interface HeroesService {
  findOne(data: HeroById): Observable<Hero>
}

type UserCreationObject = {
  email: string
}

function parsePostId(id, res) {
  return Number(id)
}

export function handler(req, res) {
  const postId = parsePostId(req.params.id, res)
  return localStorage.getItem(TODOS_KEY + postId)
}
`)

    expect(nodeNames(result)).toEqual(expect.arrayContaining([
      'TODOS_KEY',
      'HeroesService',
      'UserCreationObject',
      'parsePostId',
      'handler',
    ]))
    expect(edge(result, 'calls', ':handler', 'parsePostId')).toBeDefined()
  })

  it('captures screen components and local screen helpers', () => {
    const result = parse(`
const rgbDataURL = (r, g, b) => \`data:\${r}:\${g}:\${b}\`

const Color = () => <Image blurDataURL={rgbDataURL(2, 129, 210)} />

export default Color
`, 'app/color/page.tsx')

    expect(result.nodes.find((node) => node.name === 'rgbDataURL')).toMatchObject({
      type: 'function',
      exported: false,
    })
    expect(result.nodes.find((node) => node.name === 'Color')).toMatchObject({
      type: 'function',
      exported: true,
      is_default_export: true,
    })
    expect(edge(result, 'calls', ':Color', 'rgbDataURL')).toBeDefined()
  })

  it('keeps internal DB/client setup nodes when reachable code reads them', () => {
    const result = parse(`
const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' })

export class PrismaService extends PrismaClient {
  constructor() {
    super({ adapter })
  }
}
`)

    expect(result.nodes.find((node) => node.name === 'adapter')).toMatchObject({
      type: 'variable',
      exported: false,
    })
    expect(edge(result, 'calls', ':adapter', 'PrismaBetterSqlite3')).toBeDefined()
  })

  it('does not classify schema/table builder calls with callback arguments as functions', () => {
    const result = parse(`
export const password = z.string().refine((value) => value.match(/\\d/), 'message')

export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey(),
}, (todos) => ({
  nameIdx: uniqueIndex('nameIdx').on(todos.id),
}))
`)

    expect(result.nodes.find((node) => node.name === 'password')).toMatchObject({
      type: 'variable',
      exported: true,
    })
    expect(result.nodes.find((node) => node.name === 'todos')).toMatchObject({
      type: 'variable',
      exported: true,
    })
  })

  it('classifies known one-callback wrappers such as createParamDecorator as functions', () => {
    const result = parse(`
export const User = createParamDecorator((data, ctx) => {
  return ctx.switchToHttp().getRequest().user
})
`)

    expect(result.nodes.find((node) => node.name === 'User')).toMatchObject({
      type: 'function',
      exported: true,
    })
    expect(edge(result, 'calls', ':User', 'switchToHttp')).toBeDefined()
  })

  it('captures default-exported interfaces used as type context', () => {
    const result = parse(`
export default interface CustomResponse<T> {
  success: boolean
  data?: T
}
`)

    expect(result.nodes.find((node) => node.name === 'CustomResponse')).toMatchObject({
      type: 'interface',
      exported: true,
      is_default_export: true,
    })
  })

  it('parses MDX ESM route exports before markdown content', () => {
    const result = parse(`
import { Message } from './message'

export const meta = () => [{ title: 'MDX Route' }]

export const loader = () => ({ message: 'Loader data' })

# This is an MDX route

<Message />
`, 'app/routes/mdx/route.mdx')

    expect(result.nodes.find((node) => node.name === 'meta')).toMatchObject({
      type: 'function',
      exported: true,
    })
    expect(result.nodes.find((node) => node.name === 'loader')).toMatchObject({
      type: 'function',
      exported: true,
    })
  })
})

describe('extractAst integration for entry-relevant internal symbols', () => {
  it('merges parser nodes for route -> controller -> service local declarations without fixture pipeline', async () => {
    const files: SourceFile[] = [
      {
        path: 'src/post.controller.ts',
        isTest: false,
        content: `
const createPost = async (req, res) => {
  return PostService.createPost(req.body)
}

export const PostController = { createPost }
`,
      },
      {
        path: 'src/post.service.ts',
        isTest: false,
        content: `
type CreatePostData = { title: string }

const createPost = async (data: CreatePostData) => {
  return prisma.post.create({ data })
}

export const PostService = { createPost }
`,
      },
    ]

    const result = await extractAst(files, 'r1', adapter)
    const names = result.nodes.map((node) => `${node.file_path}:${node.name}`)

    expect(names).toEqual(expect.arrayContaining([
      'src/post.controller.ts:createPost',
      'src/post.controller.ts:PostController',
      'src/post.service.ts:CreatePostData',
      'src/post.service.ts:createPost',
      'src/post.service.ts:PostService',
    ]))
    expect(result.edges.some((item) =>
      item.relation === 'contains' &&
      item.source_id === 'r1:src/post.controller.ts:PostController' &&
      item.target_symbol === 'createPost'
    )).toBe(true)
  })
})
