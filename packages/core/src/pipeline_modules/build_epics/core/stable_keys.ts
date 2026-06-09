import type { ConfirmedEpic, ReviewableEpic } from './types.js'

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'epic'
}

export function routeNamespace(path: string): string {
  const first = path.replace(/^\/+/, '').split('/').find((part) => part && !part.startsWith(':'))
  return first ? slug(first) : 'root'
}

export function makeEpicStableKey(epic: Pick<ReviewableEpic | ConfirmedEpic, 'apiLinks' | 'screenLinks' | 'eventLinks' | 'scheduleLinks' | 'name' | 'tempEpicId'>): string {
  const apiIds = epic.apiLinks.map((link) => link.apiDocId).sort()
  if (apiIds.length > 0) return `api:${apiIds.join('+')}`
  const eventIds = epic.eventLinks.map((link) => link.eventDocId).sort()
  if (eventIds.length > 0) return `event:${eventIds.join('+')}`
  const scheduleIds = epic.scheduleLinks.map((link) => link.scheduleDocId).sort()
  if (scheduleIds.length > 0) return `schedule:${scheduleIds.join('+')}`
  const screenIds = epic.screenLinks.map((link) => link.screenDocId).sort()
  if (screenIds.length > 0) return `screen:${screenIds.join('+')}`
  return `manual:${slug(epic.name || epic.tempEpicId)}`
}

export function abbrFromName(name: string): string {
  const words = name.match(/[a-zA-Z0-9]+/g) ?? ['EPIC']
  const acronym = words.map((word) => word[0]).join('').slice(0, 8).toUpperCase()
  /* v8 ignore next -- regex fallback always yields a non-empty fallback word */
  return acronym || 'EPIC'
}
