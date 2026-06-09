// RED SPEC (describe.skip) — absorbed from pre-refactor build_graph resolution WIP.
// Un-skip + make GREEN when re-implementing resolution on the refactored engine.
// Reference impl: ~/main-wip-backup/source.patch ; design: specs/static_analysis_strategy/ideal_architecture_reverse_design.md
/**
 * Module-level function declaration materialization.
 *
 * Generic rule (no fixture/repo branching): a top-level `function foo(...) {}`
 * declaration in a CommonJS module must produce a `function` code node, even
 * when the function is only referenced later as a callback/middleware argument.
 *
 * Downstream rationale: build_docs traversal resolves callback targetIds to a
 * callable function node body — if module-level function declarations are not
 * materialized, those edges dangle.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'index.js') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('module-level function declaration nodes', () => {
  it('materializes top-level function declarations used as middleware args', () => {
    const r = parse(`
'use strict'
var express = require('../..');
var User = require('./user');
var app = express();

function count(req, res, next) {
  User.count(function(err, count){
    if (err) return next(err);
    req.count = count;
    next();
  })
}

function users(req, res, next) {
  User.all(function(err, users){
    if (err) return next(err);
    req.users = users;
    next();
  })
}

app.get('/middleware', count, users, function (req, res) {
  res.render('index', { title: 'Users' });
});

function count2(req, res, next) {
  User.count(function(err, count){
    if (err) return next(err);
    res.locals.count = count;
    next();
  })
}

function users2(req, res, next) {
  User.all(function(err, users){
    if (err) return next(err);
    res.locals.users = users;
    next();
  })
}

app.get('/middleware-locals', count2, users2, function (req, res) {
  res.render('index', { title: 'Users' });
});
`)
    const fnNames = new Set(
      r.nodes.filter((n) => n.type === 'function').map((n) => n.name),
    )
    for (const name of ['count', 'users', 'count2', 'users2']) {
      expect(fnNames.has(name)).toBe(true)
    }
  })
})
