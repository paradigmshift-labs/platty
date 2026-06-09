export const SCHEDULE_PACKAGE_DEFINITIONS = {
  nest_schedule: {
    packages: ['@nestjs/schedule'],
  },
  node_cron: {
    packages: ['node-cron'],
  },
  cron_package: {
    packages: ['cron'],
  },
  agenda: {
    packages: ['agenda'],
  },
  bree: {
    packages: ['bree'],
  },
  bull_repeat: {
    packages: ['bull', 'bullmq'],
  },
  // Spring scheduling (JVM): @Scheduled(cron=…/fixedRate=…). Annotation-driven, gated by the import.
  spring_scheduled: {
    packages: [
      'org.springframework.scheduling.annotation.Scheduled',
      'org.springframework.scheduling.annotation.EnableScheduling',
      'org.springframework.scheduling.annotation',
    ],
  },
} as const

export type ScheduleFamily = keyof typeof SCHEDULE_PACKAGE_DEFINITIONS
export type SchedulePackage =
  typeof SCHEDULE_PACKAGE_DEFINITIONS[ScheduleFamily]['packages'][number]

export const SCHEDULE_PACKAGE_SET = new Set(
  Object.values(SCHEDULE_PACKAGE_DEFINITIONS).flatMap((definition) => definition.packages),
)

export function scheduleFamilyForPackage(pkg: string | null | undefined): ScheduleFamily | null {
  if (!pkg) return null
  return (Object.entries(SCHEDULE_PACKAGE_DEFINITIONS) as Array<[ScheduleFamily, { packages: readonly string[] }]>)
    .find(([, definition]) => definition.packages.includes(pkg))
    ?.[0] ?? null
}

export function isScheduleFamilyPackage(
  pkg: string | null | undefined,
  family: ScheduleFamily,
): pkg is SchedulePackage {
  const packages = SCHEDULE_PACKAGE_DEFINITIONS[family].packages as readonly string[]
  return Boolean(pkg && packages.includes(pkg))
}
