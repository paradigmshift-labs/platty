import { assertDisposableBackendTestDatabaseUrl } from './disposable-test-database-url';

describe('assertDisposableBackendTestDatabaseUrl', () => {
  it('accepts the disposable local backend test database URL', () => {
    expect(() =>
      assertDisposableBackendTestDatabaseUrl(
        'postgresql://platty:platty@localhost:55433/platty?schema=public',
        'backend test',
      ),
    ).not.toThrow();
  });

  it('rejects the default local database URL used for normal development', () => {
    expect(() =>
      assertDisposableBackendTestDatabaseUrl(
        'postgresql://platty:platty@localhost:5432/platty?schema=public',
        'backend test',
      ),
    ).toThrow('backend test DATABASE_URL must point to the disposable backend test database at localhost:55433/platty');
  });
});
