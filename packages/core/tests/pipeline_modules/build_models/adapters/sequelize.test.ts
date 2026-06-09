import { describe, it, expect, beforeAll } from 'vitest'
import { SequelizeAdapter } from '@/pipeline_modules/build_models/adapters/sequelize.js'
import type { SchemaChunk } from '@/pipeline_modules/build_models/types.js'

// helper
function chunk(content: string, path = 'models.ts'): SchemaChunk {
  return { files: [{ path, content }], orm: 'sequelize' }
}

describe('SequelizeAdapter', () => {
  let adapter: SequelizeAdapter

  beforeAll(async () => {
    adapter = new SequelizeAdapter()
    await adapter.ensureReady()
  })

  // ─── 기본 속성 ─────────────────────────────────────────────────────────────

  it('T-SA-01: orm/strategy 속성', () => {
    expect(adapter.orm).toBe('sequelize')
    expect(adapter.strategy).toBe('dsl-parse')
  })

  // ─── 패턴 A: sequelize.define() ────────────────────────────────────────────

  it('T-SA-02: define() 기본 파싱 — 단순 DataTypes', async () => {
    const content = `
const User = sequelize.define('User', {
  name: DataTypes.STRING,
  age: DataTypes.INTEGER,
  active: DataTypes.BOOLEAN,
})
`
    const ctx = adapter.collectNames([{ path: 'models.ts', content }])
    const result = await adapter.parseChunk(chunk(content), ctx)

    expect(result).toHaveLength(1)
    const m = result[0]
    expect(m.name).toBe('User')
    expect(m.table_name).toBe('user') // 기본값: 모델명 소문자 snake_case
    expect(m.fields.find(f => f.name === 'name')).toMatchObject({ type: 'String', nullable: true })
    expect(m.fields.find(f => f.name === 'age')).toMatchObject({ type: 'Int', nullable: true })
    expect(m.fields.find(f => f.name === 'active')).toMatchObject({ type: 'Boolean', nullable: true })
  })

  it('T-SA-03: define() tableName 옵션 — options 객체 우선', async () => {
    const content = `
const User = sequelize.define('User', {
  name: DataTypes.STRING,
}, { tableName: 'users' })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result[0].table_name).toBe('users')
  })

  it('T-SA-04: define() tableName 없을 때 — 모델명 소문자', async () => {
    const content = `
const Order = sequelize.define('Order', { id: DataTypes.INTEGER })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result[0].table_name).toBe('order')
  })

  it('T-SA-05: define() PascalCase 모델명 → snake_case 테이블명 자동 변환', async () => {
    const content = `
const UserProfile = sequelize.define('UserProfile', { id: DataTypes.INTEGER })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result[0].table_name).toBe('user_profile')
  })

  // ─── 패턴 B: Model.init() ─────────────────────────────────────────────────

  it('T-SA-06: Model.init() 기본 파싱', async () => {
    const content = `
class User extends Model {}
User.init({
  name: DataTypes.STRING,
  email: DataTypes.STRING,
}, { sequelize, tableName: 'users' })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result).toHaveLength(1)
    const m = result[0]
    expect(m.name).toBe('User')
    expect(m.table_name).toBe('users')
    expect(m.fields.find(f => f.name === 'name')).toMatchObject({ type: 'String' })
    expect(m.fields.find(f => f.name === 'email')).toMatchObject({ type: 'String' })
  })

  it('T-SA-07: Model.init() tableName 없을 때 — 클래스명 snake_case', async () => {
    const content = `
class BlogPost extends Model {}
BlogPost.init({ title: DataTypes.STRING }, { sequelize })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result[0].name).toBe('BlogPost')
    expect(result[0].table_name).toBe('blog_post')
  })

  // ─── DataTypes 타입 매핑 ────────────────────────────────────────────────────

  it('T-SA-08: DataTypes 단순 타입 매핑 확인', async () => {
    const content = `
const Types = sequelize.define('Types', {
  str:      DataTypes.STRING,
  txt:      DataTypes.TEXT,
  cit:      DataTypes.CITEXT,
  uuid:     DataTypes.UUID,
  blob:     DataTypes.BLOB,
  num:      DataTypes.INTEGER,
  bignum:   DataTypes.BIGINT,
  small:    DataTypes.SMALLINT,
  flt:      DataTypes.FLOAT,
  dbl:      DataTypes.DOUBLE,
  dec:      DataTypes.DECIMAL,
  bool:     DataTypes.BOOLEAN,
  dt:       DataTypes.DATE,
  dateonly: DataTypes.DATEONLY,
  time:     DataTypes.TIME,
  jsn:      DataTypes.JSON,
  jsnb:     DataTypes.JSONB,
  enm:      DataTypes.ENUM,
  arr:      DataTypes.ARRAY,
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    const fields = result[0].fields
    const getType = (name: string) => fields.find(f => f.name === name)?.type

    expect(getType('str')).toBe('String')
    expect(getType('txt')).toBe('String')
    expect(getType('cit')).toBe('String')
    expect(getType('uuid')).toBe('String')
    expect(getType('blob')).toBe('String')
    expect(getType('num')).toBe('Int')
    expect(getType('bignum')).toBe('Int')
    expect(getType('small')).toBe('Int')
    expect(getType('flt')).toBe('Float')
    expect(getType('dbl')).toBe('Float')
    expect(getType('dec')).toBe('Float')
    expect(getType('bool')).toBe('Boolean')
    expect(getType('dt')).toBe('DateTime')
    expect(getType('dateonly')).toBe('DateTime')
    expect(getType('time')).toBe('DateTime')
    expect(getType('jsn')).toBe('Json')
    expect(getType('jsnb')).toBe('Json')
    expect(getType('enm')).toBe('String')
    expect(getType('arr')).toBe('String')
  })

  it('T-SA-09: DataTypes 호출형 (STRING(100), INTEGER(11)) 파싱', async () => {
    const content = `
const Product = sequelize.define('Product', {
  name:  DataTypes.STRING(100),
  code:  DataTypes.CHAR(10),
  price: DataTypes.DECIMAL(10, 2),
  qty:   DataTypes.INTEGER(11),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'name')?.type).toBe('String')
    expect(fields.find(f => f.name === 'code')?.type).toBe('String')
    expect(fields.find(f => f.name === 'price')?.type).toBe('Float')
    expect(fields.find(f => f.name === 'qty')?.type).toBe('Int')
  })

  // ─── 객체 형식 필드 — allowNull / primaryKey / unique / defaultValue ────────

  it('T-SA-10: 객체 형식 — allowNull:false → nullable:false', async () => {
    const content = `
const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, allowNull: false },
  bio:   { type: DataTypes.TEXT },
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'email')).toMatchObject({ nullable: false })
    expect(fields.find(f => f.name === 'bio')).toMatchObject({ nullable: true })
  })

  it('T-SA-11: 객체 형식 — primaryKey:true → primary:true, nullable:false', async () => {
    const content = `
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING },
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'id')).toMatchObject({ primary: true, nullable: false })
    expect(fields.find(f => f.name === 'name')).toMatchObject({ primary: false })
  })

  it('T-SA-12: 객체 형식 — unique:true → unique:true', async () => {
    const content = `
const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, unique: true },
  name:  { type: DataTypes.STRING },
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'email')?.unique).toBe(true)
    expect(fields.find(f => f.name === 'name')?.unique).toBe(false)
  })

  it('T-SA-13: 객체 형식 — defaultValue 추출 (따옴표 제거)', async () => {
    const content = `
const Config = sequelize.define('Config', {
  role:  { type: DataTypes.STRING, defaultValue: 'user' },
  score: { type: DataTypes.INTEGER, defaultValue: 0 },
  flag:  { type: DataTypes.BOOLEAN, defaultValue: false },
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'role')?.default).toBe('user')
    expect(fields.find(f => f.name === 'score')?.default).toBe('0')
    expect(fields.find(f => f.name === 'flag')?.default).toBe('false')
  })

  it('T-SA-22: sequelize-typescript @Table + @Column decorators', async () => {
    const content = `
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({})
export class Photo extends Model {
  @Column
  name!: string

  @Column
  views!: number

  @Column(DataType.BOOLEAN)
  isPublished!: boolean
}
`
    const result = await adapter.parseChunk(chunk(content, 'src/photo/photo.entity.ts'), adapter.collectNames([{ path: 'src/photo/photo.entity.ts', content }]))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Photo',
      table_name: 'photo',
      source_file: 'src/photo/photo.entity.ts',
    })
    expect(result[0].fields.find(f => f.name === 'name')).toMatchObject({ type: 'String', nullable: true })
    expect(result[0].fields.find(f => f.name === 'views')).toMatchObject({ type: 'Float', nullable: true })
    expect(result[0].fields.find(f => f.name === 'isPublished')).toMatchObject({ type: 'Boolean', nullable: true })
  })

  it('T-SA-23: sequelize-typescript decorator options', async () => {
    const content = `
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'photos' })
export class Photo extends Model {
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  name!: string

  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id!: number
}
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result[0].table_name).toBe('photos')
    expect(result[0].fields.find(f => f.name === 'name')).toMatchObject({
      type: 'String',
      nullable: false,
      unique: true,
    })
    expect(result[0].fields.find(f => f.name === 'id')).toMatchObject({
      type: 'Int',
      nullable: false,
      primary: true,
    })
  })

  it('T-SA-14: autoIncrement:true → primary:true (암묵적 PK)', async () => {
    const content = `
const Item = sequelize.define('Item', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result[0].fields[0]).toMatchObject({ primary: true, nullable: false })
  })

  // ─── 복수 모델 ────────────────────────────────────────────────────────────

  it('T-SA-15: 복수 모델 파일 — define + init 혼용', async () => {
    const content = `
const User = sequelize.define('User', {
  name: DataTypes.STRING,
}, { tableName: 'users' })

class Post extends Model {}
Post.init({
  title: DataTypes.STRING,
  body:  DataTypes.TEXT,
}, { sequelize, tableName: 'posts' })

const Comment = sequelize.define('Comment', {
  text: DataTypes.TEXT,
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result).toHaveLength(3)
    const names = result.map(m => m.name).sort()
    expect(names).toEqual(['Comment', 'Post', 'User'])
  })

  // ─── 빈 필드 객체 ─────────────────────────────────────────────────────────

  it('T-SA-16: 빈 필드 객체', async () => {
    const content = `
const Empty = sequelize.define('Empty', {})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
  })

  // ─── relations — association 호출 ─────────────────────────────────────────

  it('T-SA-17: relations — hasMany/belongsTo association 호출 파싱', async () => {
    const content = `
const User = sequelize.define('User', { id: DataTypes.INTEGER })
const Post = sequelize.define('Post', { userId: DataTypes.INTEGER })

User.hasMany(Post, { foreignKey: 'userId', as: 'posts' })
Post.belongsTo(User, { foreignKey: 'userId', as: 'author' })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result.find(model => model.name === 'User')?.relations).toEqual([
      expect.objectContaining({
        name: 'posts',
        target_model: 'Post',
        type: 'oneToMany',
        fk_fields: ['userId'],
      }),
    ])
    expect(result.find(model => model.name === 'Post')?.relations).toEqual([
      expect.objectContaining({
        name: 'author',
        target_model: 'User',
        type: 'manyToOne',
        fk_fields: ['userId'],
      }),
    ])
  })

  // ─── collectNames / prepareChunks ────────────────────────────────────────

  it('T-SA-18: collectNames — modelNames 반환', () => {
    const content = `
const Alpha = sequelize.define('Alpha', { id: DataTypes.INTEGER })
class Beta extends Model {}
Beta.init({ id: DataTypes.INTEGER }, { sequelize })
`
    const ctx = adapter.collectNames([{ path: 'models.ts', content }])
    expect(ctx.modelNames.has('Alpha')).toBe(true)
    expect(ctx.modelNames.has('Beta')).toBe(true)
    expect(ctx.enumNames.size).toBe(0)
    expect(ctx.compositeTypeNames.size).toBe(0)
  })

  it('T-SA-19: prepareChunks — 단일 청크 반환', () => {
    const files = [
      { path: 'a.ts', content: '' },
      { path: 'b.ts', content: '' },
    ]
    const chunks = adapter.prepareChunks(files)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].files).toEqual(files)
  })

  // ─── source_file / line_start 기록 ────────────────────────────────────────

  it('T-SA-20: source_file / line_start 기록', async () => {
    const content = `
const User = sequelize.define('User', {
  name: DataTypes.STRING,
})
`
    const result = await adapter.parseChunk(chunk(content, 'src/models/user.ts'), adapter.collectNames([{ path: 'src/models/user.ts', content }]))
    expect(result[0].source_file).toBe('src/models/user.ts')
    expect(result[0].line_start).toBeGreaterThan(0)
  })

  // ─── 혼합 필드 형식 (단순 + 객체) ────────────────────────────────────────

  it('T-SA-21: 단순 DataTypes와 객체 형식 혼용', async () => {
    const content = `
class Order extends Model {}
Order.init({
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code:   DataTypes.STRING,
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
  total:  DataTypes.DECIMAL,
}, { sequelize, tableName: 'orders' })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'models.ts', content }]))
    expect(result).toHaveLength(1)
    const m = result[0]
    expect(m.table_name).toBe('orders')
    expect(m.fields.find(f => f.name === 'id')).toMatchObject({ primary: true, nullable: false, type: 'Int' })
    expect(m.fields.find(f => f.name === 'code')).toMatchObject({ type: 'String', nullable: true })
    expect(m.fields.find(f => f.name === 'status')).toMatchObject({ type: 'String', nullable: false, default: 'pending' })
    expect(m.fields.find(f => f.name === 'total')).toMatchObject({ type: 'Float' })
  })
})
