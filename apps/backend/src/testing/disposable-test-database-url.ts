export function assertDisposableBackendTestDatabaseUrl(rawDatabaseUrl: string, suiteName: string): void {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error(`${suiteName} DATABASE_URL must be a valid URL`);
  }

  const isAllowedHost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  const isAllowedPort = parsedUrl.port === '55433';
  const isAllowedDatabase = parsedUrl.pathname === '/platty';

  if (!isAllowedHost || !isAllowedPort || !isAllowedDatabase) {
    throw new Error(
      `${suiteName} DATABASE_URL must point to the disposable backend test database at localhost:55433/platty`,
    );
  }
}
