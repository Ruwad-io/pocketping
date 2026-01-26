import { prisma } from '@/lib/db'

export default async function Home() {
  // Get or create the default project
  let project = await prisma.project.findFirst()

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: 'My Project',
      },
    })
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1rem' }}>PocketPing Community Edition</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>API Keys</h2>
        <p style={{ marginBottom: '1rem', color: '#666' }}>
          Use these keys to connect your widget and backend.
        </p>

        <div style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          <strong>Public Key (for widget):</strong>
          <code style={{ display: 'block', marginTop: '0.5rem', wordBreak: 'break-all' }}>
            {project.publicKey}
          </code>
        </div>

        <div style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '8px' }}>
          <strong>Secret Key (for backend):</strong>
          <code style={{ display: 'block', marginTop: '0.5rem', wordBreak: 'break-all' }}>
            {project.secretKey}
          </code>
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Widget Integration</h2>
        <p style={{ marginBottom: '1rem', color: '#666' }}>
          Add this script to your website to enable the chat widget.
        </p>

        <pre style={{ background: '#1a1a1a', color: '#fff', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
{`<script
  src="${process.env.NEXT_PUBLIC_WIDGET_URL || 'https://cdn.pocketping.io/widget.js'}"
  data-api-key="${project.publicKey}"
  data-api-url="${process.env.NEXT_PUBLIC_API_URL || ''}"
></script>`}
        </pre>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>API Endpoints</h2>

        <ul style={{ marginLeft: '1.5rem', lineHeight: '1.8' }}>
          <li><code>POST /api/widget/init</code> - Initialize session</li>
          <li><code>POST /api/widget/messages</code> - Send message</li>
          <li><code>GET /api/widget/messages</code> - Get messages</li>
          <li><code>POST /api/widget/identify</code> - Update visitor info</li>
          <li><code>GET /api/widget/stream</code> - SSE real-time updates</li>
        </ul>
      </section>

      <section>
        <h2 style={{ marginBottom: '0.5rem' }}>Bridge Configuration</h2>
        <p style={{ color: '#666' }}>
          Configure your bridges via environment variables. See the README for details.
        </p>
      </section>
    </main>
  )
}
