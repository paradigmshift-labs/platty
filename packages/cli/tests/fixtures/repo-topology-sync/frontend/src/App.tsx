export function App() {
  async function createUser() {
    await fetch('/api/users', { method: 'POST' })
    await fetch('/api/roles', { method: 'POST' })
  }

  return (
    <main>
      <h1>User admin</h1>
      <button onClick={createUser}>Create user</button>
    </main>
  )
}
