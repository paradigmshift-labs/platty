import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { createProject, listProjects, resolveProjectSelector } from '../src/project_service.js'

describe('project_service', () => {
  it('creates and resolves projects by id, name, and slug', () => {
    const client = createTestPlattyDb()
    const project = createProject(client.db, { name: 'My App', description: 'demo' })

    expect(project.name).toBe('My App')
    expect(project.description).toBe('demo')
    expect(listProjects(client.db)).toHaveLength(1)
    expect(resolveProjectSelector(client.db, project.id).project?.id).toBe(project.id)
    expect(resolveProjectSelector(client.db, 'My App').project?.id).toBe(project.id)
    expect(resolveProjectSelector(client.db, 'my-app').project?.id).toBe(project.id)

    client.close()
  })
})
