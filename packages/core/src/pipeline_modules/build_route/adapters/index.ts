// 어댑터 REGISTRY — f2 loadAdapters 가 lookup 한다.
// 새 어댑터 추가 시 여기에 import + 키 추가.

import type { AdapterRegistry } from '../types.js'
import { nestjs } from './nestjs.js'
import { express } from './express.js'
import { fastify } from './fastify.js'
import { koa } from './koa.js'
import { hono } from './hono.js'
import { elysia } from './elysia.js'
import { nextjs } from './nextjs.js'
import { nuxt } from './nuxt.js'
import { sveltekit } from './sveltekit.js'
import { astro } from './astro.js'
import { react_router_v6 } from './react_router_v6.js'
import { flutter_gorouter } from './flutter_gorouter.js'
import { flutter_navigator } from './flutter_navigator.js'
import { flutter_getx } from './flutter_getx.js'
import { flutter_auto_route } from './flutter_auto_route.js'
import { flutter_beamer } from './flutter_beamer.js'
import { spring } from './spring.js'

export const REGISTRY: AdapterRegistry = {
  nestjs,
  express,
  fastify,
  koa,
  hono,
  elysia,
  nextjs,
  nuxt,
  sveltekit,
  astro,
  react_router_v6,
  flutter_gorouter,
  flutter_navigator,
  flutter_getx,
  flutter_auto_route,
  flutter_beamer,
  spring,
}
