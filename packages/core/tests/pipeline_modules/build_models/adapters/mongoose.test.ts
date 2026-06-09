import { describe, it, expect, beforeAll } from 'vitest'
import { MongooseAdapter } from '@/pipeline_modules/build_models/adapters/mongoose.js'
import type { SchemaChunk } from '@/pipeline_modules/build_models/types.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function chunk(content: string, path = 'models/user.ts'): SchemaChunk {
  return { files: [{ path, content }], orm: 'mongoose' }
}

function emptyCtx() {
  return { enumNames: new Set<string>(), modelNames: new Set<string>(), compositeTypeNames: new Set<string>() }
}

describe('MongooseAdapter', () => {
  let adapter: MongooseAdapter

  beforeAll(async () => {
    adapter = new MongooseAdapter()
    await adapter.ensureReady()
  })

  // ─── 기본 속성 ─────────────────────────────────────────────────────────────

  it('T-MG-01: orm/strategy 속성', () => {
    expect(adapter.orm).toBe('mongoose')
    expect(adapter.strategy).toBe('dsl-parse')
  })

  // ─── 기본 스키마 + model() 바인딩 ─────────────────────────────────────────

  it('T-MG-02: 기본 new Schema + model() 바인딩', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const userSchema = new Schema({
  name: String,
  age: Number,
})

export const User = model('User', userSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(1)
    const m = result[0]
    expect(m.name).toBe('User')
    expect(m.table_name).toBe('users')
    expect(m.fields).toHaveLength(2)
    expect(m.fields.find(f => f.name === 'name')).toMatchObject({ type: 'String', nullable: true })
    expect(m.fields.find(f => f.name === 'age')).toMatchObject({ type: 'Float', nullable: true })
  })

  // ─── 단순 타입 (String, Number, Boolean, Date) ─────────────────────────────

  it('T-MG-03: 단순 타입 매핑 — String/Number/Boolean/Date', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const postSchema = new Schema({
  title: String,
  views: Number,
  published: Boolean,
  createdAt: Date,
})

export const Post = model('Post', postSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(1)
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'title')).toMatchObject({ type: 'String' })
    expect(fields.find(f => f.name === 'views')).toMatchObject({ type: 'Float' })
    expect(fields.find(f => f.name === 'published')).toMatchObject({ type: 'Boolean' })
    expect(fields.find(f => f.name === 'createdAt')).toMatchObject({ type: 'DateTime' })
  })

  // ─── 객체 형식 ({ type, required }) ───────────────────────────────────────

  it('T-MG-04: 객체 형식 — required:true → nullable:false', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const productSchema = new Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String },
})

export const Product = model('Product', productSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'name')).toMatchObject({ type: 'String', nullable: false })
    expect(fields.find(f => f.name === 'price')).toMatchObject({ type: 'Float', nullable: false })
    expect(fields.find(f => f.name === 'description')).toMatchObject({ type: 'String', nullable: true })
  })

  // ─── unique/default 옵션 ───────────────────────────────────────────────────

  it('T-MG-05: unique/default 옵션', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const userSchema = new Schema({
  email: { type: String, unique: true },
  role: { type: String, default: 'user' },
  score: { type: Number, default: 0 },
})

export const User = model('User', userSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'email')).toMatchObject({ type: 'String', unique: true })
    expect(fields.find(f => f.name === 'role')).toMatchObject({ type: 'String', default: 'user' })
    expect(fields.find(f => f.name === 'score')).toMatchObject({ type: 'Float', default: '0' })
  })

  // ─── ObjectId 타입 ─────────────────────────────────────────────────────────

  it('T-MG-06: Schema.Types.ObjectId → String', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const commentSchema = new Schema({
  authorId: { type: Schema.Types.ObjectId, ref: 'User' },
  postId: { type: Schema.Types.ObjectId, required: true },
})

export const Comment = model('Comment', commentSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'authorId')).toMatchObject({ type: 'String', nullable: true })
    expect(fields.find(f => f.name === 'postId')).toMatchObject({ type: 'String', nullable: false })
  })

  // ─── 배열 필드 ────────────────────────────────────────────────────────────

  it('T-MG-07: 배열 단순 타입 — [String]', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const articleSchema = new Schema({
  tags: [String],
  scores: [Number],
})

export const Article = model('Article', articleSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'tags')).toMatchObject({ type: 'String' })
    expect(fields.find(f => f.name === 'scores')).toMatchObject({ type: 'Float' })
  })

  // ─── mongoose.model() 형식 ─────────────────────────────────────────────────

  it('T-MG-08: mongoose.model() 형식', async () => {
    const content = `
import mongoose from 'mongoose'
const { Schema } = mongoose

const categorySchema = new Schema({
  name: String,
  slug: { type: String, unique: true },
})

export const Category = mongoose.model('Category', categorySchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Category')
    expect(result[0].table_name).toBe('categorys')
    expect(result[0].fields.find(f => f.name === 'slug')).toMatchObject({ unique: true })
  })

  // ─── mongoose.Schema 형식 ──────────────────────────────────────────────────

  it('T-MG-09: new mongoose.Schema({}) 형식', async () => {
    const content = `
import mongoose from 'mongoose'

const tagSchema = new mongoose.Schema({
  label: String,
  color: { type: String, default: 'blue' },
})

export const Tag = mongoose.model('Tag', tagSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Tag')
    expect(result[0].fields.find(f => f.name === 'color')).toMatchObject({ default: 'blue' })
  })

  // ─── model<T>() 제네릭 형식 ───────────────────────────────────────────────

  it('T-MG-10: model<IUser>() 제네릭 형식', async () => {
    const content = `
import { Schema, model } from 'mongoose'

interface IUser {
  username: string
  email: string
}

const userSchema = new Schema<IUser>({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
})

export const User = model<IUser>('User', userSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('User')
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'username')).toMatchObject({ type: 'String', nullable: false })
    expect(fields.find(f => f.name === 'email')).toMatchObject({ type: 'String', nullable: false, unique: true })
  })

  // ─── 복수 모델 ────────────────────────────────────────────────────────────

  it('T-MG-11: 한 파일에 복수 모델', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const userSchema = new Schema({ name: String })
const postSchema = new Schema({ title: String })
const commentSchema = new Schema({ body: String })

export const User = model('User', userSchema)
export const Post = model('Post', postSchema)
export const Comment = model('Comment', commentSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(3)
    expect(result.map(m => m.name).sort()).toEqual(['Comment', 'Post', 'User'])
  })

  // ─── schema 없이 model만 있는 경우 ────────────────────────────────────────

  it('T-MG-12: schema 없이 model만 있으면 빈 결과', async () => {
    const content = `
import { model } from 'mongoose'

// schemaVar 없이 직접 model 호출 (pattern: model('User', undeclaredVar))
export const User = model('User', externalSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(0)
  })

  // ─── schema 있지만 model 없는 경우 ────────────────────────────────────────

  it('T-MG-13: model 없이 schema만 있으면 빈 결과', async () => {
    const content = `
import { Schema } from 'mongoose'

const orphanSchema = new Schema({
  name: String,
})
// model() 호출 없음
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result).toHaveLength(0)
  })

  // ─── Mixed / Schema.Types.Mixed → Json ────────────────────────────────────

  it('T-MG-14: Schema.Types.Mixed → Json', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const logSchema = new Schema({
  meta: Schema.Types.Mixed,
  extra: { type: Schema.Types.Mixed },
})

export const Log = model('Log', logSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'meta')).toMatchObject({ type: 'Json' })
    expect(fields.find(f => f.name === 'extra')).toMatchObject({ type: 'Json' })
  })

  // ─── 배열 객체 형식 ───────────────────────────────────────────────────────

  it('T-MG-15: 배열 객체 형식 — [{ type: String }]', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const profileSchema = new Schema({
  aliases: [{ type: String }],
  ratings: [{ type: Number }],
})

export const Profile = model('Profile', profileSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'aliases')).toMatchObject({ type: 'String' })
    expect(fields.find(f => f.name === 'ratings')).toMatchObject({ type: 'Float' })
  })

  // ─── mongoose.Types.ObjectId 형식 ─────────────────────────────────────────

  it('T-MG-16: mongoose.Types.ObjectId → String', async () => {
    const content = `
import mongoose from 'mongoose'

const followSchema = new mongoose.Schema({
  followerId: { type: mongoose.Types.ObjectId, required: true },
  followeeId: { type: mongoose.Types.ObjectId, required: true },
})

export const Follow = mongoose.model('Follow', followSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'followerId')).toMatchObject({ type: 'String', nullable: false })
    expect(fields.find(f => f.name === 'followeeId')).toMatchObject({ type: 'String', nullable: false })
  })

  // ─── source_file / line_start 기록 ────────────────────────────────────────

  it('T-MG-17: source_file / line_start 기록', async () => {
    const content = `
import { Schema, model } from 'mongoose'

const itemSchema = new Schema({ label: String })
export const Item = model('Item', itemSchema)
`
    const result = await adapter.parseChunk(
      { files: [{ path: 'models/item.ts', content }], orm: 'mongoose' },
      emptyCtx(),
    )
    expect(result[0].source_file).toBe('models/item.ts')
    expect(result[0].line_start).toBeGreaterThan(0)
  })

  // ─── collectNames ─────────────────────────────────────────────────────────

  it('T-MG-18: collectNames — modelNames 반환', () => {
    const content = `
import { Schema, model } from 'mongoose'
const userSchema = new Schema({ name: String })
const postSchema = new Schema({ title: String })
export const User = model('User', userSchema)
export const Post = model('Post', postSchema)
`
    const ctx = adapter.collectNames([{ path: 'models.ts', content }])
    expect(ctx.modelNames.has('User')).toBe(true)
    expect(ctx.modelNames.has('Post')).toBe(true)
    expect(ctx.enumNames.size).toBe(0)
  })

  // ─── prepareChunks ────────────────────────────────────────────────────────

  it('T-MG-19: prepareChunks — 단일 청크 반환', () => {
    const files = [
      { path: 'models/user.ts', content: '' },
      { path: 'models/post.ts', content: '' },
    ]
    const chunks = adapter.prepareChunks(files)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].files).toEqual(files)
  })

  // ─── 테이블명 소문자 복수화 ───────────────────────────────────────────────

  it('T-MG-20: table_name = modelName.toLowerCase() + "s"', async () => {
    const content = `
import { Schema, model } from 'mongoose'
const orderItemSchema = new Schema({ qty: Number })
export const OrderItem = model('OrderItem', orderItemSchema)
`
    const result = await adapter.parseChunk(chunk(content), emptyCtx())
    expect(result[0].table_name).toBe('orderitems')
  })

  it('T-MG-21: NestJS @Schema + @Prop + SchemaFactory.createForClass', async () => {
    const content = `
import { Document, Types } from 'mongoose'
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'

@Schema()
export class Cat extends Document<Types.ObjectId> {
  @Prop()
  name: string

  @Prop()
  age: number

  @Prop({ type: String, required: true, unique: true })
  breed: string

  @Prop({
    type: [{ type: Types.ObjectId, ref: Cat.name }],
    default: [],
  })
  kitten: Types.ObjectId[]
}

export const CatSchema = SchemaFactory.createForClass(Cat)
`
    const result = await adapter.parseChunk(chunk(content, 'src/cats/schemas/cat.schema.ts'), emptyCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Cat',
      table_name: 'cats',
      source_file: 'src/cats/schemas/cat.schema.ts',
    })
    expect(result[0].fields.find(f => f.name === 'name')).toMatchObject({ type: 'String', nullable: true })
    expect(result[0].fields.find(f => f.name === 'age')).toMatchObject({ type: 'Float', nullable: true })
    expect(result[0].fields.find(f => f.name === 'breed')).toMatchObject({
      type: 'String',
      nullable: false,
      unique: true,
    })
    expect(result[0].fields.find(f => f.name === 'kitten')).toMatchObject({
      type: 'String',
      default: '[]',
    })
  })

  it('T-MG-22: NestJS @Schema options do not confuse class body parsing', async () => {
    const content = `
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'

@Schema({ discriminatorKey: 'kind' })
export class Event {
  @Prop({
    type: String,
    required: true,
  })
  kind: string

  @Prop({ type: Date, required: true })
  time: Date
}

export const EventSchema = SchemaFactory.createForClass(Event)
`
    const result = await adapter.parseChunk(chunk(content, 'src/event/schemas/event.schema.ts'), emptyCtx())
    expect(result).toHaveLength(1)
    expect(result[0].fields.find(f => f.name === 'kind')).toMatchObject({ type: 'String', nullable: false })
    expect(result[0].fields.find(f => f.name === 'time')).toMatchObject({ type: 'DateTime', nullable: false })
  })

  it('T-MG-23: exported Schema variable without colocated model binding infers model name', async () => {
    const content = `
import * as mongoose from 'mongoose'

export const CatSchema = new mongoose.Schema({
  name: String,
  age: Number,
  breed: String,
})
`
    const result = await adapter.parseChunk(chunk(content, 'src/cats/schemas/cat.schema.ts'), emptyCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Cat',
      table_name: 'cats',
      source_file: 'src/cats/schemas/cat.schema.ts',
    })
    expect(result[0].fields.map(f => [f.name, f.type])).toEqual([
      ['name', 'String'],
      ['age', 'Float'],
      ['breed', 'String'],
    ])
  })
})
